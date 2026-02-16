use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

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

    Ok(())
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
) -> Result<RpcResponse, String> {
    ensure_sidecar_started(&app, state, provider.clone(), model.clone()).await?;

    let id = crypto_random_uuid();
    let command = RpcCommand {
        id: Some(id),
        r#type: "create_session".to_string(),
        session_id: None,
        cwd: Some(project_dir),
        message: None,
        provider,
        model_id: model,
        streaming_behavior: None,
    };

    let response = send_command_with_response(state, command, 10).await?;

    let mut state_guard = state.lock().await;
    cache_session_from_create_response(&mut state_guard, &response);

    Ok(response)
}

#[tauri::command]
pub async fn create_agent(
    app: AppHandle,
    state: State<'_, Arc<Mutex<SidecarState>>>,
    project_dir: String,
    provider: Option<String>,
    model: Option<String>,
) -> Result<RpcResponse, String> {
    create_session_internal(app, state.inner(), project_dir, provider, model).await
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
    };

    send_command_with_response(state.inner(), cmd, 5).await
}

