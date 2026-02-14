use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

use crate::logger;
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
            // Ensure model cycling scope is not constrained by persisted settings.
            // This keeps Graphone model fallback enumeration consistent across platforms.
            "--models".to_string(),
            "*".to_string(),
        ];

        if let Some(provider) = provider {
            args.push("--provider".to_string());
            args.push(provider);
        }

        if let Some(model) = model {
            args.push("--model".to_string());
            args.push(model);
        }

        logger::log(format!("Sidecar args: {:?}", args));

        Ok(app
            .shell()
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
            let mut stdout_buffer: Vec<u8> = Vec::new();
            let mut stderr_buffer: Vec<u8> = Vec::new();
            let mut pending_json: Option<String> = None;

            while let Some(event) = event_rx.recv().await {
                let should_continue = Self::handle_event(
                    &app_clone,
                    &state,
                    event,
                    &mut stdout_buffer,
                    &mut pending_json,
                    &mut stderr_buffer,
                )
                .await;

                if !should_continue {
                    break;
                }
            }

            Self::flush_stdout_buffer(&app_clone, &state, &mut stdout_buffer, &mut pending_json).await;
            Self::flush_stderr_buffer(&mut stderr_buffer);

            if let Some(remaining) = pending_json {
                logger::log(format!(
                    "Dropping unterminated JSON fragment from sidecar stdout (len={})",
                    remaining.len()
                ));
            }
        });
    }

    async fn handle_event(
        app: &AppHandle,
        state: &Arc<Mutex<SidecarState>>,
        event: CommandEvent,
        stdout_buffer: &mut Vec<u8>,
        pending_json: &mut Option<String>,
        stderr_buffer: &mut Vec<u8>,
    ) -> bool {
        match event {
            CommandEvent::Stdout(chunk) => {
                Self::handle_stdout(app, state, chunk, stdout_buffer, pending_json).await;
                true
            }
            CommandEvent::Stderr(chunk) => {
                Self::handle_stderr(chunk, stderr_buffer);
                true
            }
            CommandEvent::Terminated(payload) => {
                Self::flush_stdout_buffer(app, state, stdout_buffer, pending_json).await;
                Self::flush_stderr_buffer(stderr_buffer);
                logger::log(format!("Sidecar terminated with code: {:?}", payload.code));
                let _ = app.emit("agent-terminated", payload.code);
                false
            }
            CommandEvent::Error(e) => {
                Self::flush_stdout_buffer(app, state, stdout_buffer, pending_json).await;
                Self::flush_stderr_buffer(stderr_buffer);
                logger::log(format!("Sidecar error: {}", e));
                let _ = app.emit("agent-error", e);
                false
            }
            _ => true,
        }
    }

    async fn handle_stdout(
        app: &AppHandle,
        state: &Arc<Mutex<SidecarState>>,
        chunk: Vec<u8>,
        buffer: &mut Vec<u8>,
        pending_json: &mut Option<String>,
    ) {
        // If there's pending incomplete JSON from previous chunks, prepend it to the new chunk
        if let Some(partial) = pending_json.take() {
            // Convert partial to bytes and prepend to current chunk
            let mut combined = partial.into_bytes();
            combined.extend_from_slice(&chunk);
            // Process the combined data
            buffer.extend_from_slice(&combined);
        } else {
            // Accumulate all bytes into buffer
            buffer.extend_from_slice(&chunk);
        }
        
        // Try to extract and process complete JSON objects from the buffer
        // We don't clear the buffer - we keep any unprocessed data for the next chunk
        Self::process_json_buffer(app, state, buffer, pending_json).await;
    }

    /// Process the accumulated buffer, extracting complete JSON objects
    async fn process_json_buffer(
        app: &AppHandle,
        state: &Arc<Mutex<SidecarState>>,
        buffer: &mut Vec<u8>,
        pending_json: &mut Option<String>,
    ) {
        // Convert current buffer to string for processing
        let buffer_str = Self::decode_utf8_lossy(std::mem::take(buffer));
        
        if buffer_str.trim().is_empty() {
            return;
        }

        // Try to extract complete JSON objects from the accumulated data
        // We need to handle the case where multiple JSON objects are concatenated
        let mut start_idx = 0;
        
        while start_idx < buffer_str.len() {
            // Skip non-JSON content to find the next JSON object
            let json_start = buffer_str[start_idx..].find('{').map(|i| start_idx + i);
            
            if let Some(start) = json_start {
                // Try to find a complete JSON object starting from this position
                if let Some((json_end, complete_json)) = Self::extract_complete_json(&buffer_str[start..]) {
                    let raw = complete_json.clone();
                    
                    if let Some(json) = Self::parse_json_line(&complete_json) {
                        Self::handle_parsed_json(app, state, raw, json).await;
                    }
                    
                    start_idx = start + json_end;
                } else {
                    // Incomplete JSON - buffer the remaining data for next chunk
                    let remaining = &buffer_str[start..];
                    if !remaining.trim().is_empty() {
                        if let Some(partial) = pending_json.as_mut() {
                            partial.push_str(remaining);
                        } else {
                            *pending_json = Some(remaining.to_string());
                        }
                    }
                    // Keep any remaining content in buffer for next time
                    if start > 0 {
                        buffer.extend_from_slice(buffer_str[..start].as_bytes());
                    }
                    return;
                }
            } else {
                // No JSON found - log as non-JSON output
                let remaining = &buffer_str[start_idx..];
                if !remaining.trim().is_empty() {
                    logger::log(format!(
                        "Sidecar stdout non-JSON (len={}): {}",
                        remaining.len(),
                        Self::shorten_for_log(remaining, 400)
                    ));
                }
                break;
            }
        }
    }

    /// Extract a complete JSON object from the input, returning (end_position, json_string)
    /// Returns None if the JSON is incomplete
    fn extract_complete_json(input: &str) -> Option<(usize, String)> {
        // Try to parse the entire input as JSON - if it works, we have a complete JSON
        if serde_json::from_str::<serde_json::Value>(input).is_ok() {
            return Some((input.len(), input.to_string()));
        }
        
        // Try to find the outermost complete JSON object by tracking depth correctly
        let mut depth = 0;
        let mut in_string = false;
        let mut escape_next = false;
        let mut json_start = None;
        let mut json_end = None;
        
        for (i, c) in input.char_indices() {
            if escape_next {
                escape_next = false;
                continue;
            }
            
            match c {
                '\\' if in_string => escape_next = true,
                '"' => in_string = !in_string,
                '{' if !in_string => {
                    if depth == 0 {
                        json_start = Some(i);
                    }
                    depth += 1;
                }
                '}' if !in_string => {
                    depth -= 1;
                    if depth == 0 {
                        json_end = Some(i);
                        break;
                    }
                }
                _ => {}
            }
        }
        
        if let (Some(start), Some(end)) = (json_start, json_end) {
            let result = input[start..=end].to_string();
            // Verify this is valid JSON
            if serde_json::from_str::<serde_json::Value>(&result).is_ok() {
                return Some((end + 1, result));
            }
        }
        
        None
    }

    async fn handle_parsed_json(
        app: &AppHandle,
        state: &Arc<Mutex<SidecarState>>,
        raw: String,
        json: serde_json::Value,
    ) {
        if json.get("type").and_then(|t| t.as_str()) == Some("response") {
            let command = json.get("command").and_then(|c| c.as_str()).unwrap_or("unknown").to_string();

            match serde_json::from_value::<RpcResponse>(json) {
                Ok(response) => {
                    if let Some(id) = response.id.clone() {
                        let cmd = response.command.clone();
                        let state_guard = state.lock().await;
                        if let Some(ref tx) = state_guard.response_tx {
                            if tx.try_send((id.clone(), response)).is_err() {
                                logger::log(format!(
                                    "Failed to queue response id={} command={} (channel full/closed)",
                                    id, cmd
                                ));
                            }
                        } else {
                            logger::log("Response channel not initialized");
                        }
                    }
                    return;
                }
                Err(error) => {
                    logger::log(format!(
                        "Failed to deserialize response JSON (len={}, command={}): {}",
                        raw.len(),
                        command,
                        error
                    ));
                    // Don't forward malformed responses to the frontend.
                    return;
                }
            }
        }

        let should_log = json.get("type").and_then(|t| t.as_str()) != Some("message_update");
        if should_log {
            logger::log(format!("Sidecar stdout: {}", Self::shorten_for_log(&raw, 2000)));
        }

        // Guard against WebView IPC payload truncation (~64KB on some platforms).
        const MAX_AGENT_EVENT_CHARS: usize = 60_000;
        if raw.len() > MAX_AGENT_EVENT_CHARS {
            logger::log(format!(
                "Skipping emit of oversized agent-event payload (len={})",
                raw.len()
            ));
            return;
        }

        if let Err(e) = app.emit("agent-event", raw) {
            logger::log(format!("Failed to emit agent event: {}", e));
        }
    }

    fn parse_json_line(line: &str) -> Option<serde_json::Value> {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            return Some(json);
        }

        let start = line.find('{')?;
        let end = line.rfind('}')?;
        if end <= start {
            return None;
        }

        serde_json::from_str::<serde_json::Value>(&line[start..=end]).ok()
    }

    fn shorten_for_log(value: &str, max_chars: usize) -> String {
        if value.chars().count() <= max_chars {
            return value.to_string();
        }

        let shortened = value.chars().take(max_chars).collect::<String>();
        format!("{}…", shortened)
    }

    fn handle_stderr(chunk: Vec<u8>, buffer: &mut Vec<u8>) {
        for line in Self::extract_lines(chunk, buffer) {
            if !line.trim().is_empty() {
                logger::log(format!("Sidecar stderr: {}", line));
            }
        }
    }

    async fn flush_stdout_buffer(
        app: &AppHandle,
        state: &Arc<Mutex<SidecarState>>,
        buffer: &mut Vec<u8>,
        pending_json: &mut Option<String>,
    ) {
        if buffer.is_empty() && pending_json.is_none() {
            return;
        }

        // Process any remaining buffered data
        Self::process_json_buffer(app, state, buffer, pending_json).await;
    }

    fn flush_stderr_buffer(buffer: &mut Vec<u8>) {
        if buffer.is_empty() {
            return;
        }

        let remaining = std::mem::take(buffer);
        let line = Self::decode_utf8_lossy(remaining);
        if !line.trim().is_empty() {
            logger::log(format!("Sidecar stderr: {}", line));
        }
    }

    fn extract_lines(chunk: Vec<u8>, buffer: &mut Vec<u8>) -> Vec<String> {
        buffer.extend_from_slice(&chunk);

        let mut lines = Vec::new();
        while let Some(newline_index) = buffer.iter().position(|b| *b == b'\n') {
            let mut line = buffer.drain(..=newline_index).collect::<Vec<u8>>();

            if line.last() == Some(&b'\n') {
                line.pop();
            }
            if line.last() == Some(&b'\r') {
                line.pop();
            }

            lines.push(Self::decode_utf8_lossy(line));
        }

        lines
    }

    fn decode_utf8_lossy(bytes: Vec<u8>) -> String {
        String::from_utf8(bytes)
            .unwrap_or_else(|err| String::from_utf8_lossy(&err.into_bytes()).into_owned())
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

        let response = tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), rx)
            .await
            .map_err(|_| "Timeout waiting for response")?
            .map_err(|_| "Response channel closed")?;

        Ok(response)
    }
}
