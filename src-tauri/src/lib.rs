use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcPromptCommand {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub r#type: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcAbortCommand {
    pub r#type: String,
}

// Holds the child process handle for sending commands
struct SidecarState {
    child: Option<Arc<Mutex<tauri_plugin_shell::process::CommandChild>>>,
}

impl SidecarState {
    fn new() -> Self {
        Self { child: None }
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

    // Store the child in state wrapped in Arc<Mutex<>>
    let child_arc = Arc::new(Mutex::new(child));
    state_guard.child = Some(child_arc.clone());
    
    // Drop the lock so other commands can use the state
    drop(state_guard);

    // Spawn task to handle incoming events
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line = String::from_utf8_lossy(&line);
                    // Suppress logging for message_update types to reduce noise
                    let should_log = match serde_json::from_str::<serde_json::Value>(&line) {
                        Ok(json) => json.get("type").and_then(|t| t.as_str()) != Some("message_update"),
                        Err(_) => true,
                    };
                    if should_log {
                        eprintln!("Sidecar stdout: {}", line);
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

    let cmd = RpcPromptCommand {
        id: Some(crypto_random_uuid()),
        r#type: "prompt".to_string(),
        message: prompt,
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

    let cmd = RpcAbortCommand {
        r#type: "abort".to_string(),
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
            abort_agent
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
