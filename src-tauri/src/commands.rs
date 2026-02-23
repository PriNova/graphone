use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
#[cfg(target_os = "linux")]
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

#[cfg(target_os = "linux")]
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
#[cfg(target_os = "linux")]
use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

use crate::logger;
use crate::sidecar::{EventHandler, RpcClient, SidecarManager};
use crate::state::SidecarState;
use crate::types::{RpcCommand, RpcImageAttachment, RpcResponse};
use crate::utils::crypto_random_uuid;

#[derive(Debug, Clone, Serialize)]
pub struct EnabledModelsResponse {
    /// Effective enabledModels patterns as stored in the selected settings file.
    ///
    /// Semantics (matching pi): an empty list means "no scoping" (all models enabled).
    pub patterns: Vec<String>,
    /// Whether the enabledModels key exists in the selected settings file.
    pub defined: bool,
    /// Where the effective setting came from: "project", "global", or "none".
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSessionSummary {
    /// Session id as stored in the JSONL session header.
    pub session_id: String,
    /// Session creation timestamp from the session header (ISO string), when available.
    pub timestamp: Option<String>,
    /// First user message found in the session file.
    pub first_user_message: Option<String>,
    /// Where the session file was discovered from: "global" or "local".
    pub source: String,
    /// Absolute path to the backing session JSONL file.
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionScopeHistory {
    /// Project scope (cwd) from the session header.
    pub scope: String,
    /// Persisted sessions discovered for this scope.
    pub sessions: Vec<PersistedSessionSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionProjectScopesResponse {
    /// Unique project folders (session cwd values) discovered from persisted session files.
    pub scopes: Vec<String>,
    /// Persisted session files grouped by project scope.
    pub histories: Vec<SessionScopeHistory>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectSessionResponse {
    pub deleted: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionRootSource {
    Global,
    Local,
}

impl SessionRootSource {
    fn as_str(self) -> &'static str {
        match self {
            SessionRootSource::Global => "global",
            SessionRootSource::Local => "local",
        }
    }
}

#[derive(Debug, Clone)]
struct SessionRoot {
    path: PathBuf,
    source: SessionRootSource,
}

#[derive(Debug, Clone)]
struct SessionFileHeader {
    session_id: String,
    scope: String,
    timestamp: Option<String>,
    first_user_message: Option<String>,
}

#[derive(Debug, Clone)]
struct SessionHistoryInternal {
    session_id: String,
    timestamp: Option<String>,
    first_user_message: Option<String>,
    source: SessionRootSource,
    file_path: String,
    sort_key: String,
}

const SIDECAR_READY_TIMEOUT_SECS: u64 = 20;
const SIDECAR_READY_ATTEMPTS: usize = 3;
const SIDECAR_READY_RETRY_DELAY_MS: u64 = 500;
const CREATE_SESSION_TIMEOUT_SECS: u64 = 20;
const CREATE_SESSION_ATTEMPTS: usize = 3;
const CREATE_SESSION_RETRY_DELAY_MS: u64 = 600;

fn global_settings_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".pi").join("agent").join("settings.json"))
}

fn project_settings_path(project_dir: Option<&str>) -> Option<PathBuf> {
    if let Some(dir) = project_dir {
        return Some(PathBuf::from(dir).join(".pi").join("settings.json"));
    }

    std::env::current_dir()
        .ok()
        .map(|cwd| cwd.join(".pi").join("settings.json"))
}

fn expand_tilde(path: &str) -> PathBuf {
    if path == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(path));
    }

    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }

    PathBuf::from(path)
}

fn local_session_roots_for_scope(scope: &str) -> Vec<SessionRoot> {
    let base = PathBuf::from(scope);
    vec![
        SessionRoot {
            path: base.join(".pi").join("sessions"),
            source: SessionRootSource::Local,
        },
        SessionRoot {
            path: base.join(".pi").join("agent").join("sessions"),
            source: SessionRootSource::Local,
        },
    ]
}

fn candidate_session_roots() -> Vec<SessionRoot> {
    let mut roots = Vec::new();

    if let Some(home) = dirs::home_dir() {
        // Legacy/current location used by pi-coding-agent.
        roots.push(SessionRoot {
            path: home.join(".pi").join("agent").join("sessions"),
            source: SessionRootSource::Global,
        });

        // Alternate path used by some installations.
        roots.push(SessionRoot {
            path: home.join(".pi").join("sessions"),
            source: SessionRootSource::Global,
        });
    }

    // Respect explicit config override used by pi-coding-agent when present.
    if let Ok(agent_dir) = std::env::var("PI_CODING_AGENT_DIR") {
        roots.push(SessionRoot {
            path: expand_tilde(&agent_dir).join("sessions"),
            source: SessionRootSource::Global,
        });
    }

    // Local/project-level roots for the current app cwd.
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(SessionRoot {
            path: cwd.join(".pi").join("sessions"),
            source: SessionRootSource::Local,
        });
        roots.push(SessionRoot {
            path: cwd.join(".pi").join("agent").join("sessions"),
            source: SessionRootSource::Local,
        });
    }

    let mut dedup = HashMap::<String, SessionRoot>::new();
    for root in roots {
        let key = root.path.to_string_lossy().to_string();
        match dedup.get(&key) {
            Some(existing) if existing.source == SessionRootSource::Local => {}
            _ => {
                dedup.insert(key, root);
            }
        }
    }

    dedup.into_values().collect::<Vec<_>>()
}

fn extract_text_from_message_content(content: &serde_json::Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
        return None;
    }

    let blocks = content.as_array()?;
    let mut parts = Vec::new();

    for block in blocks {
        if block.get("type").and_then(|v| v.as_str()) != Some("text") {
            continue;
        }

        let Some(text) = block.get("text").and_then(|v| v.as_str()) else {
            continue;
        };

        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }

        parts.push(trimmed.to_string());
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    }
}

fn extract_first_user_message(entry: &serde_json::Value) -> Option<String> {
    if entry.get("type").and_then(|v| v.as_str()) != Some("message") {
        return None;
    }

    let message = entry.get("message")?;
    if message.get("role").and_then(|v| v.as_str()) != Some("user") {
        return None;
    }

    let content = message.get("content")?;
    extract_text_from_message_content(content)
}

/// Normalize a path for comparison: trim whitespace and remove trailing slashes.
fn normalize_path_for_comparison(path: &str) -> String {
    let trimmed = path.trim();
    trimmed
        .trim_end_matches(|c| c == '/' || c == '\\')
        .to_string()
}

fn canonicalize_if_exists(path: &Path) -> Option<PathBuf> {
    if !path.exists() {
        return None;
    }

    std::fs::canonicalize(path).ok()
}

fn path_is_within_root(path: &Path, root: &Path) -> bool {
    let Some(path_canonical) = canonicalize_if_exists(path) else {
        return false;
    };

    let Some(root_canonical) = canonicalize_if_exists(root) else {
        return false;
    };

    path_canonical.starts_with(root_canonical)
}

fn extract_session_header_from_file(path: &Path) -> Option<SessionFileHeader> {
    let file = std::fs::File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut line = String::new();

    loop {
        line.clear();
        let bytes = reader.read_line(&mut line).ok()?;
        if bytes == 0 {
            return None;
        }

        if !line.trim().is_empty() {
            break;
        }
    }

    let header = serde_json::from_str::<serde_json::Value>(line.trim()).ok()?;
    if header.get("type").and_then(|v| v.as_str()) != Some("session") {
        return None;
    }

    let scope = normalize_path_for_comparison(header.get("cwd").and_then(|v| v.as_str())?);
    if scope.is_empty() {
        return None;
    }

    let session_id = header
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .and_then(|stem| stem.split('_').next_back())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })?;

    let timestamp = header
        .get("timestamp")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let mut first_user_message = None;

    loop {
        line.clear();
        let bytes = reader.read_line(&mut line).ok()?;
        if bytes == 0 {
            break;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Ok(entry) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };

        if let Some(message) = extract_first_user_message(&entry) {
            first_user_message = Some(message);
            break;
        }
    }

    Some(SessionFileHeader {
        session_id,
        scope,
        timestamp,
        first_user_message,
    })
}

fn collect_session_files_from_root(root: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();

        // Support flat custom directories where session files are directly in the root.
        if path.is_file() {
            if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
                files.push(path);
            }
            continue;
        }

        if !path.is_dir() {
            continue;
        }

        let Ok(nested) = std::fs::read_dir(path) else {
            continue;
        };

        for file in nested.flatten() {
            let session_file = file.path();
            if session_file.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                continue;
            }
            files.push(session_file);
        }
    }
}

fn build_session_sort_key(path: &Path, timestamp: Option<&str>) -> String {
    if let Some(ts) = timestamp {
        return ts.to_string();
    }

    let modified_millis = std::fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    format!("{modified_millis:020}")
}

fn load_session_scope_histories() -> Vec<SessionScopeHistory> {
    let mut pending_roots = candidate_session_roots();
    let mut seen_roots = HashSet::<String>::new();
    let mut discovered_scopes = HashSet::<String>::new();

    let mut file_sources = BTreeMap::<String, (PathBuf, SessionRootSource)>::new();
    let mut header_cache = HashMap::<String, SessionFileHeader>::new();

    while let Some(root) = pending_roots.pop() {
        let root_key = root.path.to_string_lossy().to_string();
        if !seen_roots.insert(root_key) {
            continue;
        }

        let mut session_files = Vec::new();
        collect_session_files_from_root(&root.path, &mut session_files);

        for session_file in session_files {
            let file_key = session_file.to_string_lossy().to_string();

            match file_sources.get(&file_key) {
                Some((_, existing_source)) if *existing_source == SessionRootSource::Local => {}
                _ => {
                    file_sources.insert(file_key.clone(), (session_file.clone(), root.source));
                }
            }

            if let Some(header) = extract_session_header_from_file(&session_file) {
                header_cache.insert(file_key.clone(), header.clone());

                if discovered_scopes.insert(header.scope.clone()) {
                    pending_roots.extend(local_session_roots_for_scope(&header.scope));
                }
            }
        }
    }

    let mut grouped = BTreeMap::<String, Vec<SessionHistoryInternal>>::new();

    for (file_key, (path, source)) in file_sources.into_iter() {
        let Some(header) = header_cache
            .get(&file_key)
            .cloned()
            .or_else(|| extract_session_header_from_file(&path))
        else {
            continue;
        };

        let scope = header.scope;
        let history = SessionHistoryInternal {
            session_id: header.session_id,
            timestamp: header.timestamp.clone(),
            first_user_message: header.first_user_message.clone(),
            source,
            file_path: path.to_string_lossy().to_string(),
            sort_key: build_session_sort_key(&path, header.timestamp.as_deref()),
        };

        grouped.entry(scope).or_default().push(history);
    }

    grouped
        .into_iter()
        .map(|(scope, mut sessions)| {
            sessions.sort_by(|a, b| {
                b.sort_key
                    .cmp(&a.sort_key)
                    .then_with(|| a.session_id.cmp(&b.session_id))
            });

            SessionScopeHistory {
                scope,
                sessions: sessions
                    .into_iter()
                    .map(|session| PersistedSessionSummary {
                        session_id: session.session_id,
                        timestamp: session.timestamp,
                        first_user_message: session.first_user_message,
                        source: session.source.as_str().to_string(),
                        file_path: session.file_path,
                    })
                    .collect::<Vec<_>>(),
            }
        })
        .collect::<Vec<_>>()
}

/// List unique project folders discovered from persisted pi session files, along
/// with grouped history entries from global + local session stores.
#[tauri::command]
pub fn list_session_project_scopes() -> SessionProjectScopesResponse {
    let histories = load_session_scope_histories();
    let scopes = histories
        .iter()
        .map(|history| history.scope.clone())
        .collect::<Vec<_>>();

    SessionProjectScopesResponse { scopes, histories }
}

/// Encode a cwd path into the directory name format used by pi-mono.
/// Format: `--<encoded-path>--` where the path has leading slashes removed
/// and all slashes, backslashes, and colons replaced with dashes.
fn encode_scope_dir_name(cwd: &str) -> String {
    let normalized = cwd
        .trim()
        .trim_start_matches(|c| c == '/' || c == '\\')
        .replace(|c| c == '/' || c == '\\' || c == ':', "-");
    format!("--{}--", normalized)
}

/// Delete all session files and the scope directory for a given project scope.
///
/// Finds all JSONL session files whose header cwd matches the project_dir,
/// deletes them from disk, and also removes the scope's session directory.
/// Returns the count of deleted files.
#[tauri::command]
pub fn delete_project_scope(project_dir: String) -> Result<usize, String> {
    let normalized_scope = normalize_path_for_comparison(&project_dir);
    if normalized_scope.is_empty() {
        return Err("project_dir cannot be empty".to_string());
    }

    let mut roots = candidate_session_roots();
    roots.extend(local_session_roots_for_scope(&normalized_scope));

    let mut seen_roots = HashSet::<String>::new();
    let mut deleted_count = 0;

    // First pass: delete individual JSONL files by matching header cwd
    for root in roots {
        let root_key = root.path.to_string_lossy().to_string();
        if !seen_roots.insert(root_key) {
            continue;
        }

        let mut session_files = Vec::new();
        collect_session_files_from_root(&root.path, &mut session_files);

        for session_file in session_files {
            if let Some(header) = extract_session_header_from_file(&session_file) {
                let header_scope = normalize_path_for_comparison(&header.scope);
                if header_scope == normalized_scope {
                    match std::fs::remove_file(&session_file) {
                        Ok(()) => {
                            logger::log(format!(
                                "Deleted session file for scope '{}': {}",
                                normalized_scope,
                                session_file.display()
                            ));
                            deleted_count += 1;
                        }
                        Err(e) => {
                            logger::log(format!(
                                "Failed to delete session file {}: {}",
                                session_file.display(),
                                e
                            ));
                        }
                    }
                }
            }
        }
    }

    // Second pass: delete scope directories under global session roots
    // pi-mono encodes the cwd into a directory name like `--home-user-project--`
    let encoded_dir_name = encode_scope_dir_name(&normalized_scope);

    if let Some(home) = dirs::home_dir() {
        let global_session_roots = vec![
            home.join(".pi").join("agent").join("sessions"),
            home.join(".pi").join("sessions"),
        ];

        for sessions_root in global_session_roots {
            let scope_dir = sessions_root.join(&encoded_dir_name);
            if scope_dir.exists() && scope_dir.is_dir() {
                match std::fs::remove_dir_all(&scope_dir) {
                    Ok(()) => {
                        logger::log(format!(
                            "Deleted scope directory for '{}': {}",
                            normalized_scope,
                            scope_dir.display()
                        ));
                    }
                    Err(e) => {
                        logger::log(format!(
                            "Failed to delete scope directory {}: {}",
                            scope_dir.display(),
                            e
                        ));
                    }
                }
            }
        }
    }

    // Also delete encoded local scope directories if they exist.
    // Important: do NOT remove the whole local sessions root, because it may
    // contain other scope directories.
    for local_root in local_session_roots_for_scope(&normalized_scope) {
        let scope_dir = local_root.path.join(&encoded_dir_name);
        if scope_dir.exists() && scope_dir.is_dir() {
            match std::fs::remove_dir_all(&scope_dir) {
                Ok(()) => {
                    logger::log(format!(
                        "Deleted local encoded scope directory for '{}': {}",
                        normalized_scope,
                        scope_dir.display()
                    ));
                }
                Err(e) => {
                    logger::log(format!(
                        "Failed to delete local encoded scope directory {}: {}",
                        scope_dir.display(),
                        e
                    ));
                }
            }
        }
    }

    Ok(deleted_count)
}

/// Delete a single persisted session file for a project scope.
///
/// Validates that the provided file is a JSONL session file under known session
/// roots, and that its parsed header matches the provided scope + session id.
#[tauri::command]
pub fn delete_project_session(
    project_dir: String,
    session_id: String,
    file_path: String,
) -> Result<DeleteProjectSessionResponse, String> {
    let normalized_scope = normalize_path_for_comparison(&project_dir);
    if normalized_scope.is_empty() {
        return Err("project_dir cannot be empty".to_string());
    }

    let normalized_session_id = session_id.trim().to_string();
    if normalized_session_id.is_empty() {
        return Err("session_id cannot be empty".to_string());
    }

    let normalized_file_path = file_path.trim();
    if normalized_file_path.is_empty() {
        return Err("file_path cannot be empty".to_string());
    }

    let target_path = PathBuf::from(normalized_file_path);

    // Idempotent success: file already gone.
    if !target_path.exists() {
        return Ok(DeleteProjectSessionResponse { deleted: false });
    }

    if target_path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
        return Err("file_path must point to a .jsonl session file".to_string());
    }

    let mut roots = candidate_session_roots();
    roots.extend(local_session_roots_for_scope(&normalized_scope));

    let mut seen_roots = HashSet::<String>::new();
    let is_under_known_root = roots.into_iter().any(|root| {
        let root_key = root.path.to_string_lossy().to_string();
        if !seen_roots.insert(root_key) {
            return false;
        }

        path_is_within_root(&target_path, &root.path)
    });

    if !is_under_known_root {
        return Err("file_path is outside known session roots".to_string());
    }

    let Some(header) = extract_session_header_from_file(&target_path) else {
        return Err("file_path is not a valid session file".to_string());
    };

    if normalize_path_for_comparison(&header.scope) != normalized_scope {
        return Err("session scope mismatch for provided project_dir".to_string());
    }

    if header.session_id.trim() != normalized_session_id {
        return Err("session id mismatch for provided file_path".to_string());
    }

    std::fs::remove_file(&target_path).map_err(|e| {
        format!(
            "Failed to delete session file {}: {e}",
            target_path.display()
        )
    })?;

    logger::log(format!(
        "Deleted single session file for scope '{}': {}",
        normalized_scope,
        target_path.display()
    ));

    // Opportunistic cleanup: if this was under an encoded scope dir and it is
    // now empty, remove that directory.
    let encoded_dir_name = encode_scope_dir_name(&normalized_scope);
    if let Some(parent) = target_path.parent() {
        let parent_name_matches = parent
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name == encoded_dir_name)
            .unwrap_or(false);

        if parent_name_matches {
            let is_empty = std::fs::read_dir(parent)
                .map(|mut entries| entries.next().is_none())
                .unwrap_or(false);

            if is_empty {
                if let Err(error) = std::fs::remove_dir(parent) {
                    logger::log(format!(
                        "Failed to remove empty scope directory {}: {}",
                        parent.display(),
                        error
                    ));
                }
            }
        }
    }

    Ok(DeleteProjectSessionResponse { deleted: true })
}

/// Get the current working directory (the directory in which the app executes).
#[tauri::command]
pub fn get_working_directory() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to determine current working directory: {e}"))
}

#[cfg(target_os = "linux")]
fn is_wsl_environment() -> bool {
    if std::env::var_os("WSL_DISTRO_NAME").is_some() || std::env::var_os("WSL_INTEROP").is_some() {
        return true;
    }

    std::fs::read_to_string("/proc/version")
        .map(|version| version.to_lowercase().contains("microsoft"))
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn open_external_url_linux(url: &str) -> Result<(), String> {
    let mut candidates: Vec<(String, Vec<String>)> = Vec::new();

    if is_wsl_environment() {
        candidates.push((
            "cmd.exe".to_string(),
            vec![
                "/C".to_string(),
                "start".to_string(),
                "".to_string(),
                format!("\"{}\"", url.replace('"', "%22")),
            ],
        ));

        candidates.push((
            "powershell.exe".to_string(),
            vec![
                "-NoProfile".to_string(),
                "-NonInteractive".to_string(),
                "-Command".to_string(),
                format!("Start-Process '{}'", url.replace('\'', "''")),
            ],
        ));

        candidates.push(("explorer.exe".to_string(), vec![url.to_string()]));
        candidates.push(("wslview".to_string(), vec![url.to_string()]));
    }

    candidates.push(("xdg-open".to_string(), vec![url.to_string()]));
    candidates.push(("gio".to_string(), vec!["open".to_string(), url.to_string()]));

    let mut failures: Vec<String> = Vec::new();

    for (program, args) in candidates {
        match Command::new(&program)
            .args(args.iter())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
        {
            Ok(status) if status.success() => {
                logger::log(format!("Opened OAuth URL with {}", program));
                return Ok(());
            }
            Ok(status) => {
                failures.push(format!("{} exited with status {}", program, status));
            }
            Err(error) => {
                failures.push(format!("{} failed: {}", program, error));
            }
        }
    }

    Err(format!(
        "Failed to open external URL on Linux. Attempts: {}",
        failures.join(" | ")
    ))
}

/// Open an external URL in the system browser.
///
/// - Windows/macOS: use Tauri's opener plugin.
/// - Linux native: try opener first, then fall back to command-based open.
/// - Linux/WSL: prefer command-based open first (cmd.exe/powershell/explorer/wslview)
///   to reliably target the host browser.
#[tauri::command]
pub fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL cannot be empty".to_string());
    }

    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("Only http:// and https:// URLs are supported".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        if is_wsl_environment() {
            logger::log("WSL detected: using WSL-aware URL opener path".to_string());
            return open_external_url_linux(trimmed);
        }

        match app.opener().open_url(trimmed, None::<&str>) {
            Ok(()) => {
                logger::log("Opened OAuth URL with tauri opener plugin".to_string());
                Ok(())
            }
            Err(opener_error) => {
                logger::log(format!(
                    "tauri opener failed on Linux ({}), trying command fallback",
                    opener_error
                ));
                open_external_url_linux(trimmed)
            }
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        app.opener()
            .open_url(trimmed, None::<&str>)
            .map_err(|error| format!("Failed to open external URL via tauri opener: {}", error))
    }
}

fn read_enabled_models_from_settings(path: &Path) -> (bool, Vec<String>) {
    if !path.exists() {
        return (false, Vec::new());
    }

    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            logger::log(format!(
                "Failed to read settings file {}: {}",
                path.display(),
                e
            ));
            return (false, Vec::new());
        }
    };

    let settings = match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(v) => v,
        Err(e) => {
            logger::log(format!(
                "Failed to parse settings file {} as JSON: {}",
                path.display(),
                e
            ));
            return (false, Vec::new());
        }
    };

    let Some(obj) = settings.as_object() else {
        return (false, Vec::new());
    };

    let Some(enabled_models) = obj.get("enabledModels") else {
        return (false, Vec::new());
    };

    if enabled_models.is_null() {
        // Explicit null means "defined, but no scoping".
        return (true, Vec::new());
    }

    let Some(arr) = enabled_models.as_array() else {
        logger::log(format!(
            "enabledModels in {} is not an array; ignoring",
            path.display()
        ));
        return (false, Vec::new());
    };

    let patterns = arr
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .collect::<Vec<String>>();

    (true, patterns)
}

fn write_enabled_models_to_settings(path: &Path, patterns: &[String]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create settings directory {}: {}",
                parent.display(),
                e
            )
        })?;
    }

    let mut root: serde_json::Value = if path.exists() {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if !root.is_object() {
        root = serde_json::json!({});
    }

    let arr = patterns
        .iter()
        .map(|s| serde_json::Value::String(s.clone()))
        .collect::<Vec<_>>();

    root["enabledModels"] = serde_json::Value::Array(arr);

    let serialized = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    std::fs::write(path, format!("{}\n", serialized))
        .map_err(|e| format!("Failed to write settings file {}: {}", path.display(), e))?;

    Ok(())
}

fn load_enabled_models(project_dir: Option<&str>) -> EnabledModelsResponse {
    let project_path = project_settings_path(project_dir);
    if let Some(project_path) = project_path.as_ref() {
        let (defined, patterns) = read_enabled_models_from_settings(project_path);
        if defined {
            return EnabledModelsResponse {
                patterns,
                defined,
                source: "project".to_string(),
            };
        }
    }

    let global_path = global_settings_path();
    if let Some(global_path) = global_path.as_ref() {
        let (defined, patterns) = read_enabled_models_from_settings(global_path);
        if defined {
            return EnabledModelsResponse {
                patterns,
                defined,
                source: "global".to_string(),
            };
        }
    }

    EnabledModelsResponse {
        patterns: Vec::new(),
        defined: false,
        source: "none".to_string(),
    }
}

/// Get enabledModels patterns from pi settings.
///
/// Precedence: project settings (`<projectDir>/.pi/settings.json`) override global settings (`~/.pi/agent/settings.json`).
#[tauri::command]
pub fn get_enabled_models(project_dir: Option<String>) -> EnabledModelsResponse {
    load_enabled_models(project_dir.as_deref())
}

/// Persist enabledModels patterns to a pi settings file.
///
/// - patterns: the enabledModels array to write. Empty means "no scoping" (all models enabled).
/// - scope: "auto" (default), "project", or "global".
#[tauri::command]
pub fn set_enabled_models(
    patterns: Vec<String>,
    scope: Option<String>,
    project_dir: Option<String>,
) -> Result<EnabledModelsResponse, String> {
    let scope = scope.unwrap_or_else(|| "auto".to_string());

    let project_path = project_settings_path(project_dir.as_deref());
    let global_path = global_settings_path();

    let target_path: PathBuf = match scope.as_str() {
        "project" => {
            project_path.ok_or_else(|| "Failed to determine project settings path".to_string())?
        }
        "global" => {
            global_path.ok_or_else(|| "Failed to determine global settings path".to_string())?
        }
        "auto" => {
            if let Some(p) = project_path.as_ref() {
                if p.exists() {
                    p.clone()
                } else {
                    global_path
                        .ok_or_else(|| "Failed to determine global settings path".to_string())?
                }
            } else {
                global_path.ok_or_else(|| "Failed to determine global settings path".to_string())?
            }
        }
        other => {
            return Err(format!(
                "Invalid scope '{}'. Expected 'auto', 'project', or 'global'",
                other
            ));
        }
    };

    write_enabled_models_to_settings(&target_path, &patterns)?;

    Ok(load_enabled_models(project_dir.as_deref()))
}

async fn ensure_sidecar_started(
    app: &AppHandle,
    state: &Arc<Mutex<SidecarState>>,
    provider: Option<String>,
    model: Option<String>,
) -> Result<(), String> {
    let has_child = {
        let state_guard = state.lock().await;
        state_guard.child.is_some()
    };

    if has_child {
        return Ok(());
    }

    let mut state_guard = state.lock().await;
    if state_guard.child.is_some() {
        return Ok(());
    }

    let sidecar_command = SidecarManager::build_sidecar_command(app, provider, model)?;
    let (event_rx, child) = SidecarManager::spawn_sidecar(sidecar_command).await?;

    logger::log("Sidecar spawned successfully");

    let (response_tx, response_rx) = tokio::sync::mpsc::channel::<(String, RpcResponse)>(100);
    state_guard.response_tx = Some(response_tx);

    let child_arc = Arc::new(Mutex::new(child));
    state_guard.child = Some(child_arc);

    drop(state_guard);

    EventHandler::spawn_response_handler(state.clone(), response_rx);
    EventHandler::spawn_event_listener(app.clone(), state.clone(), event_rx);

    wait_for_sidecar_ready(state, SIDECAR_READY_ATTEMPTS, SIDECAR_READY_TIMEOUT_SECS).await
}

async fn wait_for_sidecar_ready(
    state: &Arc<Mutex<SidecarState>>,
    attempts: usize,
    timeout_secs: u64,
) -> Result<(), String> {
    let mut last_error = String::from("unknown sidecar readiness failure");

    for attempt in 1..=attempts {
        let cmd = RpcCommand {
            id: Some(crypto_random_uuid()),
            r#type: "ping".to_string(),
            session_id: None,
            cwd: None,
            message: None,
            provider: None,
            model_id: None,
            streaming_behavior: None,
            session_file: None,
            level: None,
            images: None,
        };

        match send_command_with_response(state, cmd, timeout_secs).await {
            Ok(response) if response.success => return Ok(()),
            Ok(response) => {
                last_error = response
                    .error
                    .unwrap_or_else(|| "Sidecar readiness ping failed".to_string());
            }
            Err(error) => {
                last_error = error;
            }
        }

        if attempt < attempts {
            sleep(Duration::from_millis(SIDECAR_READY_RETRY_DELAY_MS)).await;
        }
    }

    Err(format!(
        "Sidecar failed readiness check after {} attempts: {}",
        attempts, last_error
    ))
}

fn is_timeout_error(error: &str) -> bool {
    error.contains("Timeout waiting for response")
}

async fn send_command_with_response(
    state: &Arc<Mutex<SidecarState>>,
    command: RpcCommand,
    timeout_secs: u64,
) -> Result<RpcResponse, String> {
    let id = command
        .id
        .clone()
        .ok_or_else(|| "Command id is required for response correlation".to_string())?;
    RpcClient::send_command_with_response(state, command, id, timeout_secs).await
}

fn require_session_id(session_id: String, command: &str) -> Result<String, String> {
    let trimmed = session_id.trim().to_string();
    if trimmed.is_empty() {
        return Err(format!("sessionId is required for {}", command));
    }

    Ok(trimmed)
}

fn cache_session_from_create_response(state: &mut SidecarState, response: &RpcResponse) {
    if !response.success {
        return;
    }

    let Some(data) = response.data.as_ref() else {
        return;
    };

    let Some(session_id) = data.get("sessionId").and_then(|v| v.as_str()) else {
        return;
    };

    let Some(cwd) = data.get("cwd").and_then(|v| v.as_str()) else {
        return;
    };

    state
        .session_cwds
        .insert(session_id.to_string(), cwd.to_string());
}

fn cache_sessions_from_list_response(state: &mut SidecarState, response: &RpcResponse) {
    if !response.success {
        return;
    }

    let Some(data) = response.data.as_ref() else {
        return;
    };

    let Some(sessions) = data.get("sessions").and_then(|value| value.as_array()) else {
        return;
    };

    let mut next = std::collections::HashMap::new();

    for session in sessions {
        let Some(session_id) = session.get("sessionId").and_then(|v| v.as_str()) else {
            continue;
        };

        let Some(cwd) = session.get("cwd").and_then(|v| v.as_str()) else {
            continue;
        };

        next.insert(session_id.to_string(), cwd.to_string());
    }

    state.session_cwds = next;
}

async fn create_session_internal(
    app: AppHandle,
    state: &Arc<Mutex<SidecarState>>,
    project_dir: String,
    provider: Option<String>,
    model: Option<String>,
    session_file: Option<String>,
) -> Result<RpcResponse, String> {
    ensure_sidecar_started(&app, state, provider.clone(), model.clone()).await?;

    let requested_session_id = crypto_random_uuid();
    let mut last_error = "Failed to create session".to_string();

    for attempt in 1..=CREATE_SESSION_ATTEMPTS {
        let command = RpcCommand {
            id: Some(crypto_random_uuid()),
            r#type: "create_session".to_string(),
            session_id: Some(requested_session_id.clone()),
            cwd: Some(project_dir.clone()),
            message: None,
            provider: provider.clone(),
            model_id: model.clone(),
            streaming_behavior: None,
            session_file: session_file.clone(),
            level: None,
            images: None,
        };

        match send_command_with_response(state, command, CREATE_SESSION_TIMEOUT_SECS).await {
            Ok(response) => {
                let mut state_guard = state.lock().await;
                cache_session_from_create_response(&mut state_guard, &response);
                return Ok(response);
            }
            Err(error) => {
                last_error = error;

                let should_retry =
                    is_timeout_error(&last_error) && attempt < CREATE_SESSION_ATTEMPTS;
                if should_retry {
                    logger::log(format!(
                        "create_session timed out (attempt {}/{}), retrying with same sessionId {}",
                        attempt, CREATE_SESSION_ATTEMPTS, requested_session_id
                    ));
                    sleep(Duration::from_millis(CREATE_SESSION_RETRY_DELAY_MS)).await;
                    continue;
                }

                return Err(last_error);
            }
        }
    }

    Err(last_error)
}

#[tauri::command]
pub async fn create_agent(
    app: AppHandle,
    state: State<'_, Arc<Mutex<SidecarState>>>,
    project_dir: String,
    provider: Option<String>,
    model: Option<String>,
    session_file: Option<String>,
) -> Result<RpcResponse, String> {
    create_session_internal(
        app,
        state.inner(),
        project_dir,
        provider,
        model,
        session_file,
    )
    .await
}

#[tauri::command]
pub async fn close_agent(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let id = crypto_random_uuid();

    let command = RpcCommand {
        id: Some(id),
        r#type: "close_session".to_string(),
        session_id: Some(session_id.clone()),
        cwd: None,
        message: None,
        provider: None,
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    let response = send_command_with_response(state.inner(), command, 5).await?;

    if response.success {
        let mut state_guard = state.lock().await;
        state_guard.session_cwds.remove(&session_id);
    }

    Ok(response)
}

#[tauri::command]
pub async fn list_agents(
    state: State<'_, Arc<Mutex<SidecarState>>>,
) -> Result<RpcResponse, String> {
    let has_child = {
        let state_guard = state.lock().await;
        state_guard.child.is_some()
    };

    if !has_child {
        return Ok(RpcResponse {
            id: None,
            r#type: "response".to_string(),
            command: "list_sessions".to_string(),
            success: true,
            data: Some(serde_json::json!({ "sessions": [] })),
            error: None,
        });
    }

    let id = crypto_random_uuid();

    let command = RpcCommand {
        id: Some(id),
        r#type: "list_sessions".to_string(),
        session_id: None,
        cwd: None,
        message: None,
        provider: None,
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    let response = send_command_with_response(state.inner(), command, 5).await?;

    let mut state_guard = state.lock().await;
    cache_sessions_from_list_response(&mut state_guard, &response);

    Ok(response)
}

#[cfg(target_os = "linux")]
fn run_command_stdout(command: &str, args: &[&str]) -> Option<Vec<u8>> {
    let output = Command::new(command).args(args).output().ok()?;
    if !output.status.success() || output.stdout.is_empty() {
        return None;
    }

    Some(output.stdout)
}

#[cfg(target_os = "linux")]
fn normalize_image_mime_type(mime_type: &str) -> String {
    mime_type
        .split(';')
        .next()
        .unwrap_or(mime_type)
        .trim()
        .to_lowercase()
}

#[cfg(target_os = "linux")]
fn pick_preferred_image_mime_type(types: &[String]) -> Option<String> {
    const PREFERRED_TYPES: [&str; 6] = [
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "image/bmp",
        "image/x-ms-bmp",
    ];

    for preferred in PREFERRED_TYPES {
        if let Some(found) = types
            .iter()
            .find(|mime| normalize_image_mime_type(mime) == preferred)
        {
            return Some(found.clone());
        }
    }

    types
        .iter()
        .find(|mime| normalize_image_mime_type(mime).starts_with("image/"))
        .cloned()
}

#[cfg(target_os = "linux")]
fn read_clipboard_image_linux() -> Option<RpcImageAttachment> {
    let mime_types = run_command_stdout("wl-paste", &["--list-types"])
        .and_then(|output| String::from_utf8(output).ok())
        .map(|text| {
            text.lines()
                .map(|line| line.trim().to_string())
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if let Some(selected_type) = pick_preferred_image_mime_type(&mime_types) {
        if let Some(bytes) = run_command_stdout(
            "wl-paste",
            &["--type", selected_type.as_str(), "--no-newline"],
        ) {
            return Some(RpcImageAttachment {
                r#type: "image".to_string(),
                data: BASE64_STANDARD.encode(bytes),
                mime_type: normalize_image_mime_type(&selected_type),
            });
        }
    }

    let target_types =
        run_command_stdout("xclip", &["-selection", "clipboard", "-t", "TARGETS", "-o"])
            .and_then(|output| String::from_utf8(output).ok())
            .map(|text| {
                text.lines()
                    .map(|line| line.trim().to_string())
                    .filter(|line| !line.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

    let fallback_types = if target_types.is_empty() {
        vec![
            "image/png".to_string(),
            "image/jpeg".to_string(),
            "image/webp".to_string(),
            "image/gif".to_string(),
            "image/bmp".to_string(),
            "image/x-ms-bmp".to_string(),
        ]
    } else {
        target_types
    };

    for mime_type in fallback_types {
        if !normalize_image_mime_type(&mime_type).starts_with("image/") {
            continue;
        }

        if let Some(bytes) = run_command_stdout(
            "xclip",
            &["-selection", "clipboard", "-t", mime_type.as_str(), "-o"],
        ) {
            return Some(RpcImageAttachment {
                r#type: "image".to_string(),
                data: BASE64_STANDARD.encode(bytes),
                mime_type: normalize_image_mime_type(&mime_type),
            });
        }
    }

    None
}

/// Best-effort native clipboard image read.
/// Primarily used as a fallback on Linux/WSLg when WebView clipboard events
/// do not expose image items reliably.
#[tauri::command]
pub async fn read_clipboard_image() -> Result<Option<RpcImageAttachment>, String> {
    #[cfg(target_os = "linux")]
    {
        return Ok(read_clipboard_image_linux());
    }

    #[cfg(not(target_os = "linux"))]
    {
        Ok(None)
    }
}

/// Send a prompt to the agent
#[tauri::command]
pub async fn send_prompt(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    prompt: String,
    session_id: String,
    images: Option<Vec<RpcImageAttachment>>,
) -> Result<(), String> {
    let session_id = require_session_id(session_id, "prompt")?;

    let images = images
        .map(|attachments| {
            attachments
                .into_iter()
                .filter(|attachment| {
                    attachment.r#type == "image"
                        && !attachment.data.is_empty()
                        && attachment.mime_type.starts_with("image/")
                })
                .collect::<Vec<_>>()
        })
        .filter(|attachments| !attachments.is_empty());

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "prompt".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: Some(prompt),
        provider: None,
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images,
    };

    RpcClient::send_command(state.inner(), cmd).await
}

/// Abort the current agent operation
#[tauri::command]
pub async fn abort_agent(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<(), String> {
    let session_id = require_session_id(session_id, "abort")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "abort".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: None,
        provider: None,
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    RpcClient::send_command(state.inner(), cmd).await
}

/// Create a new session
#[tauri::command]
pub async fn new_session(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "new_session")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "new_session".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: None,
        provider: None,
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    send_command_with_response(state.inner(), cmd, 5).await
}

/// Get messages from the current session
#[tauri::command]
pub async fn get_messages(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "get_messages")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "get_messages".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: None,
        provider: None,
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    send_command_with_response(state.inner(), cmd, 5).await
}

/// Get current session state (including selected model/provider)
#[tauri::command]
pub async fn get_state(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "get_state")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "get_state".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: None,
        provider: None,
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    send_command_with_response(state.inner(), cmd, 5).await
}

/// Get available models (filtered by configured auth)
#[tauri::command]
pub async fn get_available_models(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "get_available_models")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "get_available_models".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: None,
        provider: None,
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    let mut response = send_command_with_response(state.inner(), cmd, 5).await?;

    // Keep IPC payload compact for webview transport reliability.
    // Host already returns compact models, but we defensively normalize here.
    if response.success {
        if let Some(data) = response.data.take() {
            let compact_models = data
                .get("models")
                .and_then(|models| models.as_array())
                .map(|models| {
                    models
                        .iter()
                        .filter_map(|model| {
                            let provider = model.get("provider")?.as_str()?;
                            let id = model.get("id")?.as_str()?;
                            let name = model.get("name").and_then(|v| v.as_str()).unwrap_or(id);
                            let supports_image_input = model
                                .get("supportsImageInput")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);

                            Some(serde_json::json!({
                                "provider": provider,
                                "id": id,
                                "name": name,
                                "supportsImageInput": supports_image_input,
                            }))
                        })
                        .collect::<Vec<serde_json::Value>>()
                })
                .unwrap_or_default();

            response.data = Some(serde_json::json!({ "models": compact_models }));
        }
    }

    Ok(response)
}

/// Get OAuth providers and current login status.
#[tauri::command]
pub async fn get_oauth_providers(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "get_oauth_providers")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "oauth_list_providers".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: None,
        provider: None,
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    send_command_with_response(state.inner(), cmd, 5).await
}

/// Start OAuth login flow for a provider.
#[tauri::command]
pub async fn start_oauth_login(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    provider: String,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "start_oauth_login")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "oauth_start_login".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: None,
        provider: Some(provider),
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    send_command_with_response(state.inner(), cmd, 5).await
}

/// Poll current OAuth login flow state and updates.
#[tauri::command]
pub async fn poll_oauth_login(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "poll_oauth_login")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "oauth_poll_login".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: None,
        provider: None,
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    send_command_with_response(state.inner(), cmd, 5).await
}

/// Submit user input for the active OAuth login step.
#[tauri::command]
pub async fn submit_oauth_login_input(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
    input: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "submit_oauth_login_input")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "oauth_submit_login_input".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: Some(input),
        provider: None,
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    send_command_with_response(state.inner(), cmd, 5).await
}

/// Cancel the active OAuth login flow (if any).
#[tauri::command]
pub async fn cancel_oauth_login(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "cancel_oauth_login")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "oauth_cancel_login".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: None,
        provider: None,
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    send_command_with_response(state.inner(), cmd, 5).await
}

/// Logout from an OAuth provider.
#[tauri::command]
pub async fn logout_oauth_provider(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    provider: String,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "logout_oauth_provider")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "oauth_logout".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: None,
        provider: Some(provider),
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    send_command_with_response(state.inner(), cmd, 5).await
}

/// Set active model by provider and model id
#[tauri::command]
pub async fn set_model(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    provider: String,
    model_id: String,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "set_model")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "set_model".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: None,
        provider: Some(provider),
        model_id: Some(model_id),
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    send_command_with_response(state.inner(), cmd, 5).await
}

/// Set thinking level for the active session model.
#[tauri::command]
pub async fn set_thinking_level(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    level: String,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "set_thinking_level")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "set_thinking_level".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: None,
        provider: None,
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: Some(level),
        images: None,
    };

    send_command_with_response(state.inner(), cmd, 5).await
}

/// Cycle to next model
#[tauri::command]
pub async fn cycle_model(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "cycle_model")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "cycle_model".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: None,
        provider: None,
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    send_command_with_response(state.inner(), cmd, 5).await
}
