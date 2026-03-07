use std::collections::HashSet;
use std::sync::Arc;

use tauri::AppHandle;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

use crate::logger;
use crate::sidecar::{EventHandler, RpcClient, SidecarManager};
use crate::state::SidecarState;
use crate::types::{RpcCommand, RpcResponse};
use crate::utils::crypto_random_uuid;

const SIDECAR_READY_TIMEOUT_SECS: u64 = 20;
const SIDECAR_READY_ATTEMPTS: usize = 3;
const SIDECAR_READY_RETRY_DELAY_MS: u64 = 500;
const CREATE_SESSION_TIMEOUT_SECS: u64 = 20;
const CREATE_SESSION_ATTEMPTS: usize = 3;
const CREATE_SESSION_RETRY_DELAY_MS: u64 = 600;
const SHUTDOWN_LIST_TIMEOUT_SECS: u64 = 2;
const SHUTDOWN_ABORT_TIMEOUT_SECS: u64 = 2;
const SHUTDOWN_TIMEOUT_SECS: u64 = 3;

pub async fn ensure_sidecar_started(
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

pub async fn send_command_with_response(
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

fn extract_session_ids_from_list_response(response: &RpcResponse) -> Vec<String> {
    let Some(data) = response.data.as_ref() else {
        return Vec::new();
    };

    let Some(sessions) = data.get("sessions").and_then(|value| value.as_array()) else {
        return Vec::new();
    };

    let mut seen = HashSet::<String>::new();
    let mut session_ids = Vec::new();

    for session in sessions {
        let Some(session_id) = session.get("sessionId").and_then(|v| v.as_str()) else {
            continue;
        };

        if session_id.trim().is_empty() {
            continue;
        }

        if seen.insert(session_id.to_string()) {
            session_ids.push(session_id.to_string());
        }
    }

    session_ids
}

fn force_kill_process_by_pid(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let status = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .map_err(|error| format!("Failed to invoke taskkill for {}: {}", pid, error))?;

        if status.success() {
            return Ok(());
        }

        return Err(format!(
            "taskkill failed for {} with status {}",
            pid, status
        ));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let term_status = std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .map_err(|error| format!("Failed to invoke kill -TERM for {}: {}", pid, error))?;

        if term_status.success() {
            return Ok(());
        }

        let kill_status = std::process::Command::new("kill")
            .args(["-KILL", &pid.to_string()])
            .status()
            .map_err(|error| format!("Failed to invoke kill -KILL for {}: {}", pid, error))?;

        if kill_status.success() {
            return Ok(());
        }

        Err(format!(
            "kill -TERM/-KILL failed for {} (TERM={}, KILL={})",
            pid, term_status, kill_status
        ))
    }
}

async fn force_kill_sidecar_child(
    child_arc: Arc<Mutex<tauri_plugin_shell::process::CommandChild>>,
) -> Result<(), String> {
    let pid = {
        let child_guard = child_arc.lock().await;
        child_guard.pid()
    };

    match Arc::try_unwrap(child_arc) {
        Ok(child_mutex) => {
            let child = child_mutex.into_inner();
            child
                .kill()
                .map_err(|error| format!("Failed to force-kill sidecar process {}: {}", pid, error))
        }
        Err(_) => force_kill_process_by_pid(pid),
    }
}

pub async fn shutdown_sidecar_gracefully(state: &Arc<Mutex<SidecarState>>) -> Result<(), String> {
    logger::log("shutdown requested");

    let has_child = {
        let state_guard = state.lock().await;
        state_guard.child.is_some()
    };

    if !has_child {
        return Ok(());
    }

    let list_command = RpcCommand {
        id: Some(crypto_random_uuid()),
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

    let list_response =
        send_command_with_response(state, list_command, SHUTDOWN_LIST_TIMEOUT_SECS).await;

    let mut session_ids = match list_response {
        Ok(response) if response.success => extract_session_ids_from_list_response(&response),
        _ => {
            let state_guard = state.lock().await;
            state_guard.session_cwds.keys().cloned().collect::<Vec<_>>()
        }
    };

    session_ids.sort();
    session_ids.dedup();

    logger::log(format!("aborting {} sessions", session_ids.len()));

    for session_id in session_ids {
        let abort_command = RpcCommand {
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

        let _ = send_command_with_response(state, abort_command, SHUTDOWN_ABORT_TIMEOUT_SECS).await;
    }

    let shutdown_command = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "shutdown".to_string(),
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

    let shutdown_succeeded =
        match send_command_with_response(state, shutdown_command, SHUTDOWN_TIMEOUT_SECS).await {
            Ok(response) => response.success,
            Err(_) => false,
        };

    let mut child_arc = {
        let mut state_guard = state.lock().await;
        state_guard.child.take()
    };

    let result = if shutdown_succeeded {
        logger::log("sidecar shutdown complete");
        Ok(())
    } else {
        logger::log("forced sidecar kill");

        if let Some(sidecar_child) = child_arc.take() {
            force_kill_sidecar_child(sidecar_child).await
        } else {
            Err("Sidecar child handle missing during forced kill".to_string())
        }
    };

    let mut state_guard = state.lock().await;
    state_guard.child = None;
    state_guard.pending_requests.clear();
    state_guard.response_tx = None;
    state_guard.session_cwds.clear();

    result
}

pub async fn create_session_internal(
    app: AppHandle,
    state: &Arc<Mutex<SidecarState>>,
    project_dir: String,
    provider: Option<String>,
    model: Option<String>,
    session_file: Option<String>,
) -> Result<RpcResponse, String> {
    ensure_sidecar_started(&app, state, provider.clone(), model.clone()).await?;

    // Keep one internal session id for the full create/retry flow so retries
    // correlate to the same runtime session in the sidecar.
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

pub async fn close_agent(
    state: &Arc<Mutex<SidecarState>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let command = RpcCommand {
        id: Some(crypto_random_uuid()),
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

    let response = send_command_with_response(state, command, 5).await?;

    if response.success {
        let mut state_guard = state.lock().await;
        state_guard.session_cwds.remove(&session_id);
    }

    Ok(response)
}

pub async fn list_agents(state: &Arc<Mutex<SidecarState>>) -> Result<RpcResponse, String> {
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

    let command = RpcCommand {
        id: Some(crypto_random_uuid()),
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

    let response = send_command_with_response(state, command, 5).await?;

    let mut state_guard = state.lock().await;
    cache_sessions_from_list_response(&mut state_guard, &response);

    Ok(response)
}
