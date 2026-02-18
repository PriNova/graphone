use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

use crate::logger;
use crate::sidecar::{EventHandler, RpcClient, SidecarManager};
use crate::state::SidecarState;
use crate::types::RpcCommand;
use crate::types::RpcResponse;
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

    let scope = header
        .get("cwd")
        .and_then(|v| v.as_str())?
        .trim()
        .to_string();
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

/// Get the current working directory (the directory in which the app executes).
#[tauri::command]
pub fn get_working_directory() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to determine current working directory: {e}"))
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
    };

    let response = send_command_with_response(state.inner(), command, 5).await?;

    let mut state_guard = state.lock().await;
    cache_sessions_from_list_response(&mut state_guard, &response);

    Ok(response)
}

/// Send a prompt to the agent
#[tauri::command]
pub async fn send_prompt(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    prompt: String,
    session_id: String,
) -> Result<(), String> {
    let session_id = require_session_id(session_id, "prompt")?;

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

                            Some(serde_json::json!({
                                "provider": provider,
                                "id": id,
                                "name": name,
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
    };

    send_command_with_response(state.inner(), cmd, 5).await
}
