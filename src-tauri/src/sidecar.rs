use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

use crate::logger;
use crate::state::SidecarState;
use crate::types::{RpcCommand, RpcResponse, SessionEventEnvelope};

pub struct SidecarManager;

impl SidecarManager {
    pub fn build_sidecar_command(
        app: &AppHandle,
        _provider: Option<String>,
        _model: Option<String>,
    ) -> Result<tauri_plugin_shell::process::Command, String> {
        logger::log("Sidecar backend=host args: []");
        app.shell()
            .sidecar("pi-agent")
            .map_err(|e| format!("Failed to create sidecar: {}", e))
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

#[derive(Debug, Clone)]
struct DeltaEventKey {
    delta_type: String,
    content_index: i64,
}

struct SessionDeltaCoalescer {
    pending_by_session: HashMap<String, Vec<serde_json::Value>>,
    flush_interval: Duration,
    last_flush: Instant,
}

impl SessionDeltaCoalescer {
    fn new(flush_interval: Duration) -> Self {
        Self {
            pending_by_session: HashMap::new(),
            flush_interval,
            last_flush: Instant::now(),
        }
    }

    fn is_delta_event(event: &serde_json::Value) -> bool {
        Self::delta_event_key(event).is_some()
    }

    fn maybe_queue_delta(&mut self, session_id: &str, event: serde_json::Value) -> bool {
        let Some(key) = Self::delta_event_key(&event) else {
            return false;
        };

        let queue = self
            .pending_by_session
            .entry(session_id.to_string())
            .or_default();

        if let Some(last_event) = queue.last_mut() {
            if let Some(last_key) = Self::delta_event_key(last_event) {
                if last_key.delta_type == key.delta_type
                    && last_key.content_index == key.content_index
                {
                    if Self::append_delta(last_event, &event) {
                        return true;
                    }
                }
            }
        }

        queue.push(event);
        true
    }

    fn flush_due(&mut self, app: &AppHandle) {
        if self.pending_by_session.is_empty() {
            return;
        }

        if self.last_flush.elapsed() < self.flush_interval {
            return;
        }

        self.flush_all(app);
    }

    fn flush_session(&mut self, app: &AppHandle, session_id: &str) {
        let Some(events) = self.pending_by_session.remove(session_id) else {
            return;
        };

        for event in events {
            EventHandler::emit_session_event(app, session_id, event);
        }

        self.last_flush = Instant::now();
    }

    fn flush_all(&mut self, app: &AppHandle) {
        if self.pending_by_session.is_empty() {
            return;
        }

        let sessions = self.pending_by_session.keys().cloned().collect::<Vec<_>>();
        for session_id in sessions {
            self.flush_session(app, &session_id);
        }

        self.last_flush = Instant::now();
    }

    fn delta_event_key(event: &serde_json::Value) -> Option<DeltaEventKey> {
        let event_type = event.get("type")?.as_str()?;
        if event_type != "message_update" {
            return None;
        }

        let assistant_event = event.get("assistantMessageEvent")?;
        let delta_type = assistant_event.get("type")?.as_str()?;
        if delta_type != "text_delta" && delta_type != "thinking_delta" {
            return None;
        }

        let content_index = assistant_event.get("contentIndex")?.as_i64()?;

        Some(DeltaEventKey {
            delta_type: delta_type.to_string(),
            content_index,
        })
    }

    fn append_delta(target: &mut serde_json::Value, source: &serde_json::Value) -> bool {
        let source_delta = source
            .get("assistantMessageEvent")
            .and_then(|event| event.get("delta"))
            .and_then(|delta| delta.as_str())
            .unwrap_or("");

        let Some(assistant_event) = target
            .get_mut("assistantMessageEvent")
            .and_then(|value| value.as_object_mut())
        else {
            return false;
        };

        let next_delta = match assistant_event
            .get("delta")
            .and_then(|value| value.as_str())
        {
            Some(existing) => format!("{}{}", existing, source_delta),
            None => source_delta.to_string(),
        };

        assistant_event.insert("delta".to_string(), serde_json::Value::String(next_delta));
        true
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
            let mut delta_coalescer = SessionDeltaCoalescer::new(Duration::from_millis(16));

            while let Some(event) = event_rx.recv().await {
                let should_continue = Self::handle_event(
                    &app_clone,
                    &state,
                    event,
                    &mut stdout_buffer,
                    &mut stderr_buffer,
                    &mut delta_coalescer,
                )
                .await;

                if !should_continue {
                    break;
                }
            }

            Self::flush_stdout_buffer(&app_clone, &state, &mut stdout_buffer, &mut delta_coalescer)
                .await;
            delta_coalescer.flush_all(&app_clone);
            Self::flush_stderr_buffer(&mut stderr_buffer);
        });
    }

    async fn handle_event(
        app: &AppHandle,
        state: &Arc<Mutex<SidecarState>>,
        event: CommandEvent,
        stdout_buffer: &mut Vec<u8>,
        stderr_buffer: &mut Vec<u8>,
        delta_coalescer: &mut SessionDeltaCoalescer,
    ) -> bool {
        match event {
            CommandEvent::Stdout(chunk) => {
                Self::handle_stdout(app, state, chunk, stdout_buffer, delta_coalescer).await;
                true
            }
            CommandEvent::Stderr(chunk) => {
                Self::handle_stderr(chunk, stderr_buffer);
                true
            }
            CommandEvent::Terminated(payload) => {
                Self::flush_stdout_buffer(app, state, stdout_buffer, delta_coalescer).await;
                delta_coalescer.flush_all(app);
                Self::flush_stderr_buffer(stderr_buffer);
                logger::log(format!("Sidecar terminated with code: {:?}", payload.code));
                let _ = app.emit("agent-terminated", payload.code);
                false
            }
            CommandEvent::Error(e) => {
                Self::flush_stdout_buffer(app, state, stdout_buffer, delta_coalescer).await;
                delta_coalescer.flush_all(app);
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
        delta_coalescer: &mut SessionDeltaCoalescer,
    ) {
        for line in Self::extract_lines(chunk, buffer) {
            Self::handle_stdout_line(app, state, line, delta_coalescer).await;
            delta_coalescer.flush_due(app);
        }
    }

    async fn handle_stdout_line(
        app: &AppHandle,
        state: &Arc<Mutex<SidecarState>>,
        line: String,
        delta_coalescer: &mut SessionDeltaCoalescer,
    ) {
        let line = Self::sanitize_json_line(line);
        if line.trim().is_empty() {
            return;
        }

        match serde_json::from_str::<serde_json::Value>(&line) {
            Ok(json) => Self::handle_parsed_json(app, state, line, json, delta_coalescer).await,
            Err(error) => {
                logger::log(format!(
                    "Sidecar stdout invalid NDJSON line (len={}): {} ({}; prefix={})",
                    line.len(),
                    Self::shorten_for_log(&line, 400),
                    error,
                    Self::debug_prefix_codepoints(&line, 8)
                ));
            }
        }
    }

    async fn handle_parsed_json(
        app: &AppHandle,
        state: &Arc<Mutex<SidecarState>>,
        raw: String,
        json: serde_json::Value,
        delta_coalescer: &mut SessionDeltaCoalescer,
    ) {
        let top_level_type = json.get("type").and_then(|t| t.as_str());

        if top_level_type == Some("response") {
            let command = json
                .get("command")
                .and_then(|c| c.as_str())
                .unwrap_or("unknown")
                .to_string();

            match serde_json::from_value::<RpcResponse>(json.clone()) {
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

        // Guard against WebView IPC payload truncation (~64KB on some platforms).
        const MAX_AGENT_EVENT_CHARS: usize = 60_000;

        if top_level_type == Some("session_event") {
            match serde_json::from_value::<SessionEventEnvelope>(json.clone()) {
                Ok(envelope) => {
                    let session_id = envelope.session_id;
                    let compact_event = Self::compact_session_event_for_frontend(envelope.event);

                    if SessionDeltaCoalescer::is_delta_event(&compact_event) {
                        let _ = delta_coalescer.maybe_queue_delta(&session_id, compact_event);
                        delta_coalescer.flush_due(app);
                        return;
                    }

                    delta_coalescer.flush_session(app, &session_id);
                    Self::emit_session_event(app, &session_id, compact_event);
                }
                Err(error) => {
                    logger::log(format!(
                        "Failed to deserialize session_event JSON (len={}): {}",
                        raw.len(),
                        error
                    ));
                }
            }

            return;
        }

        let should_log = top_level_type != Some("message_update");
        if should_log {
            logger::log(format!(
                "Sidecar stdout: {}",
                Self::shorten_for_log(&raw, 2000)
            ));
        }

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

    fn emit_session_event(app: &AppHandle, session_id: &str, event: serde_json::Value) {
        const MAX_AGENT_EVENT_CHARS: usize = 60_000;

        let payload = serde_json::json!({
            "sessionId": session_id,
            "event": event,
        });

        let payload_string = match serde_json::to_string(&payload) {
            Ok(value) => value,
            Err(error) => {
                logger::log(format!(
                    "Failed to serialize session_event payload for frontend: {}",
                    error
                ));
                return;
            }
        };

        if payload_string.len() > MAX_AGENT_EVENT_CHARS {
            logger::log(format!(
                "Skipping emit of oversized session_event payload (len={})",
                payload_string.len()
            ));
            return;
        }

        let should_log = payload
            .get("event")
            .and_then(|value| value.get("type"))
            .and_then(|value| value.as_str())
            != Some("message_update");

        if should_log {
            logger::log(format!(
                "Sidecar session_event: {}",
                Self::shorten_for_log(&payload_string, 2000)
            ));
        }

        if let Err(error) = app.emit("agent-event", payload_string) {
            logger::log(format!("Failed to emit agent event: {}", error));
        }
    }

    fn shorten_for_log(value: &str, max_chars: usize) -> String {
        if value.chars().count() <= max_chars {
            return value.to_string();
        }

        let shortened = value.chars().take(max_chars).collect::<String>();
        format!("{}…", shortened)
    }

    fn sanitize_json_line(line: String) -> String {
        let trimmed = line
            .trim()
            .trim_start_matches('\u{feff}')
            .trim_matches('\0');

        if Self::is_probably_clean_json_line(trimmed) {
            return trimmed.to_string();
        }

        // Sidecars may occasionally emit terminal escape sequences (OSC/CSI),
        // UTF-8 BOMs, or stray control bytes around otherwise valid JSON.
        let stripped = Self::strip_ansi_escapes(&line);

        let mut value = stripped
            .trim()
            .trim_start_matches('\u{feff}')
            .trim_matches('\0')
            .to_string();

        if let Some(candidate) = Self::extract_json_object_candidate(&value) {
            value = candidate;
        }

        value
    }

    fn is_probably_clean_json_line(value: &str) -> bool {
        if !value.starts_with('{') || !value.ends_with('}') {
            return false;
        }

        !value.as_bytes().contains(&0x1b)
    }

    fn strip_ansi_escapes(input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        let mut chars = input.chars().peekable();

        while let Some(ch) = chars.next() {
            if ch != '\u{1b}' {
                out.push(ch);
                continue;
            }

            match chars.peek().copied() {
                Some('[') => {
                    // CSI: ESC [ ... <final byte>
                    chars.next();
                    while let Some(c) = chars.next() {
                        if ('@'..='~').contains(&c) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    // OSC: ESC ] ... BEL or ESC \
                    chars.next();
                    while let Some(c) = chars.next() {
                        if c == '\u{07}' {
                            break;
                        }
                        if c == '\u{1b}' {
                            if matches!(chars.peek().copied(), Some('\\')) {
                                chars.next();
                                break;
                            }
                        }
                    }
                }
                Some('P') | Some('X') | Some('^') | Some('_') => {
                    // DCS/SOS/PM/APC: ESC <code> ... ESC \
                    chars.next();
                    while let Some(c) = chars.next() {
                        if c == '\u{1b}' {
                            if matches!(chars.peek().copied(), Some('\\')) {
                                chars.next();
                                break;
                            }
                        }
                    }
                }
                Some(_) => {
                    // Other ESC sequence with one introducer byte.
                    chars.next();
                }
                None => break,
            }
        }

        out
    }

    fn extract_json_object_candidate(input: &str) -> Option<String> {
        let start = input.find('{')?;
        let end = input.rfind('}')?;
        if end < start {
            return None;
        }

        Some(input[start..=end].to_string())
    }

    fn debug_prefix_codepoints(value: &str, max_chars: usize) -> String {
        let mut parts = value
            .chars()
            .take(max_chars)
            .map(|c| format!("U+{:04X}", c as u32))
            .collect::<Vec<_>>();

        if value.chars().count() > max_chars {
            parts.push("…".to_string());
        }

        parts.join(" ")
    }

    fn compact_session_event_for_frontend(event: serde_json::Value) -> serde_json::Value {
        let event_type = event.get("type").and_then(|value| value.as_str());

        match event_type {
            Some("agent_start") => serde_json::json!({ "type": "agent_start" }),
            Some("agent_end") => serde_json::json!({ "type": "agent_end" }),
            Some("turn_start") => serde_json::json!({ "type": "turn_start" }),
            Some("turn_end") => serde_json::json!({ "type": "turn_end" }),
            Some("message_update") => {
                let mut event_map = match event {
                    serde_json::Value::Object(map) => map,
                    _ => {
                        return serde_json::json!({
                            "type": "message_update",
                            "message": { "role": "assistant" },
                            "assistantMessageEvent": {},
                        });
                    }
                };

                let role = event_map
                    .get("message")
                    .and_then(|message| message.get("role"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("assistant")
                    .to_string();

                let assistant_message_event = match event_map.remove("assistantMessageEvent") {
                    Some(serde_json::Value::Object(mut map)) => {
                        // Drop `partial`: frontend reconstructs streaming content via deltas.
                        map.remove("partial");
                        serde_json::Value::Object(map)
                    }
                    Some(value) => value,
                    None => serde_json::json!({}),
                };

                serde_json::json!({
                    "type": "message_update",
                    "message": { "role": role },
                    "assistantMessageEvent": assistant_message_event,
                })
            }
            Some("message_end") => {
                let message = event.get("message");

                let role = message
                    .and_then(|message| message.get("role"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("assistant");

                let mut compact_message = serde_json::Map::new();
                compact_message.insert("role".to_string(), serde_json::json!(role));

                if let Some(stop_reason) = message
                    .and_then(|message| message.get("stopReason"))
                    .and_then(|value| value.as_str())
                {
                    compact_message
                        .insert("stopReason".to_string(), serde_json::json!(stop_reason));
                }

                if let Some(error_message) = message
                    .and_then(|message| message.get("errorMessage"))
                    .and_then(|value| value.as_str())
                {
                    compact_message
                        .insert("errorMessage".to_string(), serde_json::json!(error_message));
                }

                serde_json::json!({
                    "type": "message_end",
                    "message": serde_json::Value::Object(compact_message),
                })
            }
            _ => event,
        }
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
        delta_coalescer: &mut SessionDeltaCoalescer,
    ) {
        if buffer.is_empty() {
            return;
        }

        let mut line = Self::decode_utf8_lossy(std::mem::take(buffer));
        if line.ends_with('\r') {
            line.pop();
        }

        if line.trim().is_empty() {
            return;
        }

        Self::handle_stdout_line(app, state, line, delta_coalescer).await;
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

    async fn remove_pending_request(state: &Arc<Mutex<SidecarState>>, id: &str) {
        let mut state_guard = state.lock().await;
        state_guard.pending_requests.remove(id);
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
        if let Err(e) = child_guard.write(json.as_bytes()) {
            drop(child_guard);
            Self::remove_pending_request(state, &id).await;
            return Err(format!("Failed to write to sidecar: {}", e));
        }

        if let Err(e) = child_guard.write(b"\n") {
            drop(child_guard);
            Self::remove_pending_request(state, &id).await;
            return Err(format!("Failed to write newline to sidecar: {}", e));
        }

        drop(child_guard);

        let response =
            match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), rx).await {
                Ok(Ok(response)) => response,
                Ok(Err(_)) => {
                    Self::remove_pending_request(state, &id).await;
                    return Err("Response channel closed".to_string());
                }
                Err(_) => {
                    Self::remove_pending_request(state, &id).await;
                    return Err("Timeout waiting for response".to_string());
                }
            };

        Ok(response)
    }
}
