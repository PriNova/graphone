use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

use crate::logger;
use crate::sidecar::{EventHandler, RpcClient, SidecarManager};
use crate::state::SidecarState;
use crate::types::{RpcCommand, RpcResponse};
use crate::utils::crypto_random_uuid;

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
