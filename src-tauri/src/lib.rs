use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::sync::{mpsc, Mutex, oneshot};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcCommand {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcResponse {
    pub id: Option<String>,
    pub r#type: String,
    pub command: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// Pending RPC requests waiting for response
struct PendingRequest {
    sender: oneshot::Sender<RpcResponse>,
}

// Holds the child process handle for sending commands
struct SidecarState {
    child: Option<Arc<Mutex<tauri_plugin_shell::process::CommandChild>>>,
    pending_requests: HashMap<String, PendingRequest>,
    response_tx: Option<mpsc::Sender<(String, RpcResponse)>>,
}

impl SidecarState {
    fn new() -> Self {
        Self {
            child: None,
            pending_requests: HashMap::new(),
            response_tx: None,
        }
    }
}

/// Start the pi-agent sidecar and stream events to the frontend
#[tauri::command]
async fn start_agent_session(
    app: AppHandle,
    state: State<'_, Arc<Mutex<SidecarState>>>,
    provider: Option<String>,
    model: Option<String>,
) -> Result<(), String> {
    let mut state_guard = state.lock().await;
    
    // If already running, return error
    if state_guard.child.is_some() {
        return Err("Agent session already running".to_string());
    }

    // Build args for sidecar
    // Note: we don't use --no-extensions so that globally installed extensions
    // like pi-cline-free-models can provide custom providers
    let mut args = vec![
        "--mode".to_string(),
        "rpc".to_string(),
        "--no-session".to_string(),
        "--no-skills".to_string(),
    ];

    // Add provider if specified
    if let Some(provider) = provider {
        args.push("--provider".to_string());
        args.push(provider);
    }

    // Add model if specified
    if let Some(model) = model {
        args.push("--model".to_string());
        args.push(model);
    }

    eprintln!("Sidecar args: {:?}", args);

    // Get the sidecar command - the working directory doesn't matter as much now
    // since the sidecar binary will find assets relative to its own location
    let sidecar_command = app
        .shell()
        .sidecar("pi-agent")
        .map_err(|e| format!("Failed to create sidecar: {}", e))?
        .args(args);

    // Spawn the sidecar
    let (mut rx, child) = sidecar_command
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    eprintln!("Sidecar spawned successfully");

    // Create a channel for RPC responses
    let (response_tx, mut response_rx) = mpsc::channel::<(String, RpcResponse)>(100);
    state_guard.response_tx = Some(response_tx);
    
    // Store the child in state wrapped in Arc<Mutex<>>
    let child_arc = Arc::new(Mutex::new(child));
    state_guard.child = Some(child_arc.clone());
    
    // Drop the lock so other commands can use the state
    drop(state_guard);
    
    // Clone state for the response handler
    let state_for_handler = state.inner().clone();

    // Spawn task to handle RPC responses
    tauri::async_runtime::spawn(async move {
        while let Some((id, response)) = response_rx.recv().await {
            let mut state_guard = state_for_handler.lock().await;
            if let Some(pending) = state_guard.pending_requests.remove(&id) {
                let _ = pending.sender.send(response);
            }
        }
    });
    
    // Clone state for the event handler
    let state_for_events = state.inner().clone();

    // Spawn task to handle incoming events
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line = String::from_utf8_lossy(&line);
                    
                    // Try to parse as RPC response
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                        if json.get("type").and_then(|t| t.as_str()) == Some("response") {
                            // This is an RPC response - route it to the pending request
                            if let Ok(response) = serde_json::from_value::<RpcResponse>(json.clone()) {
                                if let Some(ref id) = response.id {
                                    let state_guard = state_for_events.lock().await;
                                    if let Some(ref tx) = state_guard.response_tx {
                                        let _ = tx.try_send((id.clone(), response));
                                    }
                                }
                                continue; // Don't emit this as an agent event
                            }
                        }
                        
                        // Suppress logging for message_update types to reduce noise
                        let should_log = json.get("type").and_then(|t| t.as_str()) != Some("message_update");
                        if should_log {
                            eprintln!("Sidecar stdout: {}", line);
                        }
                    }
                    
                    if let Err(e) = app_clone.emit("agent-event", line.to_string()) {
                        eprintln!("Failed to emit agent event: {}", e);
                    }
                }
                CommandEvent::Stderr(line) => {
                    let line = String::from_utf8_lossy(&line);
                    eprintln!("Sidecar stderr: {}", line);
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("Sidecar terminated with code: {:?}", payload.code);
                    let _ = app_clone.emit("agent-terminated", payload.code);
                    break;
                }
                CommandEvent::Error(e) => {
                    eprintln!("Sidecar error: {}", e);
                    let _ = app_clone.emit("agent-error", e);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Send a prompt to the agent
#[tauri::command]
async fn send_prompt(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    prompt: String,
) -> Result<(), String> {
    let state_guard = state.lock().await;
    
    let child = state_guard
        .child
        .as_ref()
        .ok_or("Agent session not started")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "prompt".to_string(),
        message: Some(prompt),
    };

    let json = serde_json::to_string(&cmd)
        .map_err(|e| format!("Failed to serialize command: {}", e))?;

    // Write to child's stdin
    let mut child_guard = child.lock().await;
    child_guard
        .write(json.as_bytes())
        .map_err(|e| format!("Failed to write to sidecar: {}", e))?;
    child_guard
        .write(b"\n")
        .map_err(|e| format!("Failed to write newline to sidecar: {}", e))?;

    Ok(())
}

/// Abort the current agent operation
#[tauri::command]
async fn abort_agent(state: State<'_, Arc<Mutex<SidecarState>>>) -> Result<(), String> {
    let state_guard = state.lock().await;
    
    let child = state_guard
        .child
        .as_ref()
        .ok_or("Agent session not started")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "abort".to_string(),
        message: None,
    };

    let json = serde_json::to_string(&cmd)
        .map_err(|e| format!("Failed to serialize abort command: {}", e))?;

    // Write to child's stdin
    let mut child_guard = child.lock().await;
    child_guard
        .write(json.as_bytes())
        .map_err(|e| format!("Failed to write abort to sidecar: {}", e))?;
    child_guard
        .write(b"\n")
        .map_err(|e| format!("Failed to write newline to sidecar: {}", e))?;

    Ok(())
}

/// Create a new session
#[tauri::command]
async fn new_session(state: State<'_, Arc<Mutex<SidecarState>>>) -> Result<RpcResponse, String> {
    let id = crypto_random_uuid();
    let (tx, rx) = oneshot::channel();
    
    // Clone the child Arc first, then store the pending request
    let child_arc: Arc<Mutex<tauri_plugin_shell::process::CommandChild>>;
    {
        let mut state_guard = state.lock().await;
        
        child_arc = state_guard
            .child
            .as_ref()
            .ok_or("Agent session not started")?
            .clone();

        // Store the pending request
        state_guard.pending_requests.insert(
            id.clone(),
            PendingRequest { sender: tx },
        );
    }

    // Now send the command using the cloned Arc
    let cmd = RpcCommand {
        id: Some(id.clone()),
        r#type: "new_session".to_string(),
        message: None,
    };

    let json = serde_json::to_string(&cmd)
        .map_err(|e| format!("Failed to serialize command: {}", e))?;

    // Write to child's stdin
    let mut child_guard = child_arc.lock().await;
    child_guard
        .write(json.as_bytes())
        .map_err(|e| format!("Failed to write to sidecar: {}", e))?;
    child_guard
        .write(b"\n")
        .map_err(|e| format!("Failed to write newline to sidecar: {}", e))?;

    // Wait for the response with timeout
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        rx
    ).await
    .map_err(|_| "Timeout waiting for response")?
    .map_err(|_| "Response channel closed")?;
    
    Ok(response)
}

/// Get messages from the current session
#[tauri::command]
async fn get_messages(state: State<'_, Arc<Mutex<SidecarState>>>) -> Result<RpcResponse, String> {
    let id = crypto_random_uuid();
    let (tx, rx) = oneshot::channel();
    
    // Clone the child Arc first, then store the pending request
    let child_arc: Arc<Mutex<tauri_plugin_shell::process::CommandChild>>;
    {
        let mut state_guard = state.lock().await;
        
        child_arc = state_guard
            .child
            .as_ref()
            .ok_or("Agent session not started")?
            .clone();

        // Store the pending request
        state_guard.pending_requests.insert(
            id.clone(),
            PendingRequest { sender: tx },
        );
    }

    // Now send the command using the cloned Arc
    let cmd = RpcCommand {
        id: Some(id.clone()),
        r#type: "get_messages".to_string(),
        message: None,
    };

    let json = serde_json::to_string(&cmd)
        .map_err(|e| format!("Failed to serialize command: {}", e))?;

    // Write to child's stdin
    let mut child_guard = child_arc.lock().await;
    child_guard
        .write(json.as_bytes())
        .map_err(|e| format!("Failed to write to sidecar: {}", e))?;
    child_guard
        .write(b"\n")
        .map_err(|e| format!("Failed to write newline to sidecar: {}", e))?;

    // Wait for the response with timeout
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        rx
    ).await
    .map_err(|_| "Timeout waiting for response")?
    .map_err(|_| "Response channel closed")?;
    
    Ok(response)
}

fn crypto_random_uuid() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let counter = COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        counter >> 32,
        (counter >> 16) & 0xffff,
        (counter >> 8) & 0xffff,
        counter & 0xffff,
        counter
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sidecar_state = Arc::new(Mutex::new(SidecarState::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(sidecar_state)
        .invoke_handler(tauri::generate_handler![
            start_agent_session,
            send_prompt,
            abort_agent,
            new_session,
            get_messages
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
