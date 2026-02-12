use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

use crate::state::SidecarState;
use crate::types::{RpcCommand, RpcResponse};

pub struct SidecarManager;

impl SidecarManager {
    pub fn build_sidecar_command(
        app: &AppHandle,
        provider: Option<String>,
        model: Option<String>,
    ) -> Result<tauri_plugin_shell::process::Command, String> {
        let mut args = vec![
            "--mode".to_string(),
            "rpc".to_string(),
            "--no-session".to_string(),
            "--no-skills".to_string(),
        ];

        if let Some(provider) = provider {
            args.push("--provider".to_string());
            args.push(provider);
        }

        if let Some(model) = model {
            args.push("--model".to_string());
            args.push(model);
        }

        eprintln!("Sidecar args: {:?}", args);

        Ok(app.shell()
            .sidecar("pi-agent")
            .map_err(|e| format!("Failed to create sidecar: {}", e))?
            .args(args))
    }

    pub async fn spawn_sidecar(
        command: tauri_plugin_shell::process::Command,
    ) -> Result<
        (
            tokio::sync::mpsc::Receiver<CommandEvent>,
            tauri_plugin_shell::process::CommandChild,
        ),
        String,
    > {
        command
            .spawn()
            .map_err(|e| format!("Failed to spawn sidecar: {}", e))
    }
}

pub struct EventHandler;

impl EventHandler {
    pub fn spawn_response_handler(
        state: Arc<Mutex<SidecarState>>,
        mut response_rx: tokio::sync::mpsc::Receiver<(String, RpcResponse)>,
    ) {
        tauri::async_runtime::spawn(async move {
            while let Some((id, response)) = response_rx.recv().await {
                let mut state_guard = state.lock().await;
                if let Some(pending) = state_guard.pending_requests.remove(&id) {
                    let _ = pending.sender.send(response);
                }
            }
        });
    }

    pub fn spawn_event_listener(
        app: AppHandle,
        state: Arc<Mutex<SidecarState>>,
        mut event_rx: tokio::sync::mpsc::Receiver<CommandEvent>,
    ) {
        let app_clone = app.clone();

        tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                Self::handle_event(&app_clone, &state, event).await;
            }
        });
    }

    async fn handle_event(
        app: &AppHandle,
        state: &Arc<Mutex<SidecarState>>,
        event: CommandEvent,
    ) -> bool {
        match event {
            CommandEvent::Stdout(line) => {
                Self::handle_stdout(app, state, line).await;
                true
            }
            CommandEvent::Stderr(line) => {
                let line = String::from_utf8_lossy(&line);
                eprintln!("Sidecar stderr: {}", line);
                true
            }
            CommandEvent::Terminated(payload) => {
                eprintln!("Sidecar terminated with code: {:?}", payload.code);
                let _ = app.emit("agent-terminated", payload.code);
                false
            }
            CommandEvent::Error(e) => {
                eprintln!("Sidecar error: {}", e);
                let _ = app.emit("agent-error", e);
                false
            }
            _ => true,
        }
    }

    async fn handle_stdout(
        app: &AppHandle,
        state: &Arc<Mutex<SidecarState>>,
        line: Vec<u8>,
    ) {
        let line = String::from_utf8_lossy(&line);

        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
            if json.get("type").and_then(|t| t.as_str()) == Some("response") {
                if let Ok(response) = serde_json::from_value::<RpcResponse>(json.clone()) {
                    if let Some(ref id) = response.id {
                        let state_guard = state.lock().await;
                        if let Some(ref tx) = state_guard.response_tx {
                            let _ = tx.try_send((id.clone(), response));
                        }
                    }
                    return;
                }
            }

            let should_log = json.get("type").and_then(|t| t.as_str()) != Some("message_update");
            if should_log {
                eprintln!("Sidecar stdout: {}", line);
            }
        }

        if let Err(e) = app.emit("agent-event", line.to_string()) {
            eprintln!("Failed to emit agent event: {}", e);
        }
    }
}

pub struct RpcClient;

impl RpcClient {
    pub async fn send_command(
        state: &Arc<Mutex<SidecarState>>,
        command: RpcCommand,
    ) -> Result<(), String> {
        let child_arc = {
            let state_guard = state.lock().await;
            state_guard
                .child
                .as_ref()
                .ok_or("Agent session not started")?
                .clone()
        };

        let json = serde_json::to_string(&command)
            .map_err(|e| format!("Failed to serialize command: {}", e))?;

        let mut child_guard = child_arc.lock().await;
        child_guard
            .write(json.as_bytes())
            .map_err(|e| format!("Failed to write to sidecar: {}", e))?;
        child_guard
            .write(b"\n")
            .map_err(|e| format!("Failed to write newline to sidecar: {}", e))?;

        Ok(())
    }

    pub async fn send_command_with_response(
        state: &Arc<Mutex<SidecarState>>,
        command: RpcCommand,
        id: String,
        timeout_secs: u64,
    ) -> Result<RpcResponse, String> {
        let (tx, rx) = tokio::sync::oneshot::channel();

        let child_arc = {
            let mut state_guard = state.lock().await;

            let child_arc = state_guard
                .child
                .as_ref()
                .ok_or("Agent session not started")?
                .clone();

            state_guard
                .pending_requests
                .insert(id.clone(), crate::state::PendingRequest { sender: tx });

            child_arc
        };

        let json = serde_json::to_string(&command)
            .map_err(|e| format!("Failed to serialize command: {}", e))?;

        let mut child_guard = child_arc.lock().await;
        child_guard
            .write(json.as_bytes())
            .map_err(|e| format!("Failed to write to sidecar: {}", e))?;
        child_guard
            .write(b"\n")
            .map_err(|e| format!("Failed to write newline to sidecar: {}", e))?;

        drop(child_guard);

        let response = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            rx,
        )
        .await
        .map_err(|_| "Timeout waiting for response")?
        .map_err(|_| "Response channel closed")?;

        Ok(response)
    }
}
