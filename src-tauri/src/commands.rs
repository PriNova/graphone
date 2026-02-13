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
    };

    RpcClient::send_command_with_response(state.inner(), cmd, id, 5).await
}
