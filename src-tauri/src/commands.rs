use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

use crate::logger;
use crate::models_static;
use crate::sidecar::{EventHandler, RpcClient, SidecarManager};
use crate::state::SidecarState;
use crate::types::{RpcCommand, RpcResponse};
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

fn project_settings_path() -> Option<PathBuf> {
    std::env::current_dir()
        .ok()
        .map(|cwd| cwd.join(".pi").join("settings.json"))
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
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create settings directory {}: {}", parent.display(), e))?;
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

    let serialized =
        serde_json::to_string_pretty(&root).map_err(|e| format!("Failed to serialize settings: {}", e))?;

    std::fs::write(path, format!("{}\n", serialized))
        .map_err(|e| format!("Failed to write settings file {}: {}", path.display(), e))?;

    Ok(())
}

fn load_enabled_models() -> EnabledModelsResponse {
    let project_path = project_settings_path();
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
/// Precedence: project settings (./.pi/settings.json) override global settings (~/.pi/agent/settings.json).
#[tauri::command]
pub fn get_enabled_models() -> EnabledModelsResponse {
    load_enabled_models()
}

/// Persist enabledModels patterns to a pi settings file.
///
/// - patterns: the enabledModels array to write. Empty means "no scoping" (all models enabled).
/// - scope: "auto" (default), "project", or "global".
#[tauri::command]
pub fn set_enabled_models(patterns: Vec<String>, scope: Option<String>) -> Result<EnabledModelsResponse, String> {
    let scope = scope.unwrap_or_else(|| "auto".to_string());

    let project_path = project_settings_path();
    let global_path = global_settings_path();

    let target_path: PathBuf = match scope.as_str() {
        "project" => project_path.ok_or_else(|| "Failed to determine project settings path".to_string())?,
        "global" => global_path.ok_or_else(|| "Failed to determine global settings path".to_string())?,
        "auto" => {
            if let Some(p) = project_path.as_ref() {
                if p.exists() {
                    p.clone()
                } else {
                    global_path.ok_or_else(|| "Failed to determine global settings path".to_string())?
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

    Ok(load_enabled_models())
}

/// Start the pi-agent sidecar and stream events to the frontend
#[tauri::command]
pub async fn start_agent_session(
    app: AppHandle,
    state: State<'_, Arc<Mutex<SidecarState>>>,
    provider: Option<String>,
    model: Option<String>,
) -> Result<(), String> {
    let mut state_guard = state.lock().await;

    if state_guard.child.is_some() {
        logger::log("Agent session already running, reusing existing session");
        return Ok(());
    }

    let sidecar_command = SidecarManager::build_sidecar_command(&app, provider, model)?;

    let (event_rx, child) = SidecarManager::spawn_sidecar(sidecar_command).await?;

    logger::log("Sidecar spawned successfully");

    let (response_tx, response_rx) = tokio::sync::mpsc::channel::<(String, RpcResponse)>(100);
    state_guard.response_tx = Some(response_tx);

    let child_arc = Arc::new(Mutex::new(child));
    state_guard.child = Some(child_arc.clone());

    drop(state_guard);

    let state_for_handler = state.inner().clone();
    EventHandler::spawn_response_handler(state_for_handler, response_rx);

    let state_for_events = state.inner().clone();
    EventHandler::spawn_event_listener(app, state_for_events, event_rx);

    Ok(())
}

/// Send a prompt to the agent
#[tauri::command]
pub async fn send_prompt(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    prompt: String,
) -> Result<(), String> {
    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "prompt".to_string(),
        message: Some(prompt),
        provider: None,
        model_id: None,
    };

    RpcClient::send_command(state.inner(), cmd).await
}

/// Abort the current agent operation
#[tauri::command]
pub async fn abort_agent(state: State<'_, Arc<Mutex<SidecarState>>>) -> Result<(), String> {
    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "abort".to_string(),
        message: None,
        provider: None,
        model_id: None,
    };

    RpcClient::send_command(state.inner(), cmd).await
}

/// Create a new session
#[tauri::command]
pub async fn new_session(
    state: State<'_, Arc<Mutex<SidecarState>>>,
) -> Result<RpcResponse, String> {
    let id = crypto_random_uuid();

    let cmd = RpcCommand {
        id: Some(id.clone()),
        r#type: "new_session".to_string(),
        message: None,
        provider: None,
        model_id: None,
    };

    RpcClient::send_command_with_response(state.inner(), cmd, id, 5).await
}

/// Get messages from the current session
#[tauri::command]
pub async fn get_messages(
    state: State<'_, Arc<Mutex<SidecarState>>>,
) -> Result<RpcResponse, String> {
    let id = crypto_random_uuid();

    let cmd = RpcCommand {
        id: Some(id.clone()),
        r#type: "get_messages".to_string(),
        message: None,
        provider: None,
        model_id: None,
    };

    RpcClient::send_command_with_response(state.inner(), cmd, id, 5).await
}

/// Get current session state (including selected model/provider)
#[tauri::command]
pub async fn get_state(state: State<'_, Arc<Mutex<SidecarState>>>) -> Result<RpcResponse, String> {
    let id = crypto_random_uuid();

    let cmd = RpcCommand {
        id: Some(id.clone()),
        r#type: "get_state".to_string(),
        message: None,
        provider: None,
        model_id: None,
    };

    RpcClient::send_command_with_response(state.inner(), cmd, id, 5).await
}

/// Get available models (filtered by configured auth)
#[tauri::command]
pub async fn get_available_models(
    state: State<'_, Arc<Mutex<SidecarState>>>,
) -> Result<RpcResponse, String> {
    let id = crypto_random_uuid();

    let cmd = RpcCommand {
        id: Some(id.clone()),
        r#type: "get_available_models".to_string(),
        message: None,
        provider: None,
        model_id: None,
    };

    // Model registry enumeration returns ALL available models (66KB+ JSON payload).
    // On Linux, the pipe buffer is 64KB, so the response gets truncated and times out.
    // Use a short timeout and rely on cycle_model fallback for model enumeration.
    let mut response = RpcClient::send_command_with_response(state.inner(), cmd, id, 3).await?;

    // Keep IPC payload compact for webview transport reliability.
    // Sidecar returns full model objects; frontend only needs provider/id/name.
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
) -> Result<RpcResponse, String> {
    let id = crypto_random_uuid();

    let cmd = RpcCommand {
        id: Some(id.clone()),
        r#type: "set_model".to_string(),
        message: None,
        provider: Some(provider),
        model_id: Some(model_id),
    };

    RpcClient::send_command_with_response(state.inner(), cmd, id, 5).await
}

/// Cycle to next model
#[tauri::command]
pub async fn cycle_model(
    state: State<'_, Arc<Mutex<SidecarState>>>,
) -> Result<RpcResponse, String> {
    let id = crypto_random_uuid();

    let cmd = RpcCommand {
        id: Some(id.clone()),
        r#type: "cycle_model".to_string(),
        message: None,
        provider: None,
        model_id: None,
    };

    RpcClient::send_command_with_response(state.inner(), cmd, id, 5).await
}

/// Get static model list from embedded data (bypasses sidecar IPC)
/// This returns a compact model list without requiring the sidecar to be running,
/// avoiding the 64KB pipe buffer limit issue on Linux.
#[tauri::command]
pub fn get_static_models() -> Vec<models_static::StaticModel> {
    models_static::get_static_models().to_vec()
}
