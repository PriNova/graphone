use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::logger;

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

fn candidate_session_roots(seed_scopes: &[String]) -> Vec<SessionRoot> {
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

    for scope in seed_scopes {
        let normalized = normalize_path_for_comparison(scope);
        if normalized.is_empty() {
            continue;
        }
        roots.extend(local_session_roots_for_scope(&normalized));
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

fn load_session_scope_histories(seed_scopes: &[String]) -> Vec<SessionScopeHistory> {
    let mut pending_roots = candidate_session_roots(seed_scopes);
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

    for (file_key, (path, source)) in file_sources {
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
///
/// `seed_scopes` lets the UI explicitly seed local project roots (for example,
/// the last selected scope) without relying on the app process cwd.
pub fn list_session_project_scopes(
    seed_scopes: Option<Vec<String>>,
) -> SessionProjectScopesResponse {
    let seed_scopes = seed_scopes.unwrap_or_default();
    let histories = load_session_scope_histories(&seed_scopes);
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
pub fn delete_project_scope(project_dir: String) -> Result<usize, String> {
    let normalized_scope = normalize_path_for_comparison(&project_dir);
    if normalized_scope.is_empty() {
        return Err("project_dir cannot be empty".to_string());
    }

    let mut roots = candidate_session_roots(&[]);
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

    let mut roots = candidate_session_roots(&[]);
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
