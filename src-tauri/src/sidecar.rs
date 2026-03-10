use std::collections::HashMap;
use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
#[cfg(not(target_os = "linux"))]
use tauri::Manager;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

mod event_payload;
#[cfg(target_os = "linux")]
mod linux_runtime;
mod ndjson;

use event_payload::{compact_session_event_for_frontend, shorten_for_log};
#[cfg(target_os = "linux")]
use linux_runtime::prepare_linux_sidecar_runtime;
use ndjson::{debug_prefix_codepoints, decode_utf8_lossy, extract_lines, sanitize_json_line};

use crate::logger;
use crate::state::SidecarState;
use crate::types::{RpcCommand, RpcResponse, SessionEventEnvelope};

const GRAPHONE_HOST_FLAG: &str = "--graphone-host";
const MAX_AGENT_EVENT_CHARS: usize = 60_000;
const MAX_AGENT_EVENT_CHUNK_SOURCE_BYTES: usize = 16_000;

static AGENT_EVENT_CHUNK_COUNTER: AtomicU64 = AtomicU64::new(1);

fn path_entries_match(lhs: &Path, rhs: &Path) -> bool {
    #[cfg(windows)]
    {
        lhs.to_string_lossy()
            .eq_ignore_ascii_case(&rhs.to_string_lossy())
    }

    #[cfg(not(windows))]
    {
        lhs == rhs
    }
}

fn fallback_join_paths(path_entry: &Path, existing_path: &OsString) -> OsString {
    let mut joined = OsString::from(path_entry.as_os_str());

    if !existing_path.is_empty() {
        joined.push(if cfg!(windows) { ";" } else { ":" });
        joined.push(existing_path);
    }

    joined
}

fn prepend_path_directory(path_entry: &Path) -> OsString {
    let existing_path = env::var_os("PATH").unwrap_or_default();
    let mut entries: Vec<PathBuf> = env::split_paths(&existing_path).collect();

    if !entries
        .iter()
        .any(|existing| path_entries_match(existing, path_entry))
    {
        entries.insert(0, path_entry.to_path_buf());
    }

    env::join_paths(entries.iter())
        .unwrap_or_else(|_| fallback_join_paths(path_entry, &existing_path))
}

fn with_prepended_runtime_path(
    command: tauri_plugin_shell::process::Command,
    runtime_dir: &Path,
) -> tauri_plugin_shell::process::Command {
    command.env("PATH", prepend_path_directory(runtime_dir))
}

fn split_utf8_by_max_bytes(value: &str, max_bytes: usize) -> Vec<String> {
    if value.is_empty() {
        return Vec::new();
    }

    let mut chunks = Vec::new();
    let mut start = 0usize;

    while start < value.len() {
        let mut end = (start + max_bytes).min(value.len());
        while end > start && !value.is_char_boundary(end) {
            end -= 1;
        }

        if end == start {
            end = value[start..]
                .char_indices()
                .nth(1)
                .map(|(offset, _)| start + offset)
                .unwrap_or(value.len());
        }

        chunks.push(value[start..end].to_string());
        start = end;
    }

    chunks
}

fn next_agent_event_chunk_id() -> String {
    format!(
        "agent-event-chunk-{}",
        AGENT_EVENT_CHUNK_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

#[cfg(not(target_os = "linux"))]
fn resolve_non_linux_sidecar_runtime_dir(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(resource_dir) = app.path().resource_dir() {
            let macos_runtime_dir = resource_dir.join("sidecar-runtime");
            if macos_runtime_dir.exists() {
                return Some(macos_runtime_dir);
            }

            return Some(resource_dir);
        }
    }

    let current_exe = env::current_exe().ok()?;
    let exe_dir = current_exe.parent()?;

    if exe_dir.ends_with("deps") {
        return Some(exe_dir.parent().unwrap_or(exe_dir).to_path_buf());
    }

    Some(exe_dir.to_path_buf())
}

pub struct SidecarManager;

impl SidecarManager {
    pub fn build_sidecar_command(
        app: &AppHandle,
        _provider: Option<String>,
        _model: Option<String>,
    ) -> Result<tauri_plugin_shell::process::Command, String> {
        logger::log(format!(
            "Sidecar backend=host args: [{}]",
            GRAPHONE_HOST_FLAG
        ));

        #[cfg(target_os = "linux")]
        {
            let sidecar_runtime_dir = prepare_linux_sidecar_runtime(app)?;
            let sidecar_binary = sidecar_runtime_dir.join("pi");

            logger::log(format!(
                "Launching linux sidecar from extracted runtime: {}",
                sidecar_binary.display()
            ));

            let command = app
                .shell()
                .command(&sidecar_binary)
                .current_dir(&sidecar_runtime_dir)
                .arg(GRAPHONE_HOST_FLAG);

            return Ok(with_prepended_runtime_path(command, &sidecar_runtime_dir));
        }

        #[cfg(not(target_os = "linux"))]
        {
            let sidecar_runtime_dir = resolve_non_linux_sidecar_runtime_dir(app)
                .ok_or_else(|| "Failed to resolve sidecar runtime directory".to_string())?;

            logger::log(format!(
                "Launching sidecar from runtime directory: {}",
                sidecar_runtime_dir.display()
            ));

            let node_path = sidecar_runtime_dir.join("node_modules");

            let command = app
                .shell()
                .sidecar("pi")
                .map_err(|e| format!("Failed to create sidecar: {}", e))?
                .current_dir(&sidecar_runtime_dir)
                .env("PI_PACKAGE_DIR", &sidecar_runtime_dir)
                .env("NODE_PATH", &node_path)
                .arg(GRAPHONE_HOST_FLAG);

            Ok(with_prepended_runtime_path(command, &sidecar_runtime_dir))
        }
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
        for line in extract_lines(chunk, buffer) {
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
        let line = sanitize_json_line(line);
        if line.trim().is_empty() {
            return;
        }

        match serde_json::from_str::<serde_json::Value>(&line) {
            Ok(json) => Self::handle_parsed_json(app, state, line, json, delta_coalescer).await,
            Err(error) => {
                logger::log(format!(
                    "Sidecar stdout invalid NDJSON line (len={}): {} ({}; prefix={})",
                    line.len(),
                    shorten_for_log(&line, 400),
                    error,
                    debug_prefix_codepoints(&line, 8)
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

        // Guard against WebView IPC payload truncation (~64KB on some platforms)
        // by chunking oversized payloads before they cross the WebView boundary.
        if top_level_type == Some("session_event") {
            match serde_json::from_value::<SessionEventEnvelope>(json.clone()) {
                Ok(envelope) => {
                    let session_id = envelope.session_id;
                    let compact_event = compact_session_event_for_frontend(envelope.event);

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
            logger::log(format!("Sidecar stdout: {}", shorten_for_log(&raw, 2000)));
        }

        Self::emit_agent_event_payload(app, raw, "agent-event");
    }

    fn emit_session_event(app: &AppHandle, session_id: &str, event: serde_json::Value) {
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

        let should_log = payload
            .get("event")
            .and_then(|value| value.get("type"))
            .and_then(|value| value.as_str())
            != Some("message_update");

        if should_log {
            logger::log(format!(
                "Sidecar session_event: {}",
                shorten_for_log(&payload_string, 2000)
            ));
        }

        Self::emit_agent_event_payload(app, payload_string, "session_event");
    }

    fn emit_agent_event_payload(app: &AppHandle, payload_string: String, payload_kind: &str) {
        if payload_string.len() <= MAX_AGENT_EVENT_CHARS {
            if let Err(error) = app.emit("agent-event", payload_string) {
                logger::log(format!("Failed to emit agent event: {}", error));
            }
            return;
        }

        let chunks = split_utf8_by_max_bytes(&payload_string, MAX_AGENT_EVENT_CHUNK_SOURCE_BYTES);
        let chunk_count = chunks.len();
        let chunk_id = next_agent_event_chunk_id();

        logger::log(format!(
            "Chunking oversized {} payload (len={}, chunks={})",
            payload_kind,
            payload_string.len(),
            chunk_count
        ));

        for (chunk_index, payload_chunk) in chunks.into_iter().enumerate() {
            let chunk_payload = serde_json::json!({
                "type": "agent_event_chunk",
                "chunkId": chunk_id.clone(),
                "chunkIndex": chunk_index,
                "chunkCount": chunk_count,
                "payloadChunk": payload_chunk,
            });

            let chunk_payload_string = match serde_json::to_string(&chunk_payload) {
                Ok(value) => value,
                Err(error) => {
                    logger::log(format!(
                        "Failed to serialize {} chunk {}/{}: {}",
                        payload_kind,
                        chunk_index + 1,
                        chunk_count,
                        error
                    ));
                    return;
                }
            };

            if chunk_payload_string.len() > MAX_AGENT_EVENT_CHARS {
                logger::log(format!(
                    "Skipping {} chunk {}/{} because serialized chunk payload is still oversized (len={})",
                    payload_kind,
                    chunk_index + 1,
                    chunk_count,
                    chunk_payload_string.len()
                ));
                return;
            }

            if let Err(error) = app.emit("agent-event", chunk_payload_string) {
                logger::log(format!(
                    "Failed to emit {} chunk {}/{}: {}",
                    payload_kind,
                    chunk_index + 1,
                    chunk_count,
                    error
                ));
                return;
            }
        }
    }

    fn handle_stderr(chunk: Vec<u8>, buffer: &mut Vec<u8>) {
        for line in extract_lines(chunk, buffer) {
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

        let mut line = decode_utf8_lossy(std::mem::take(buffer));
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
        let line = decode_utf8_lossy(remaining);
        if !line.trim().is_empty() {
            logger::log(format!("Sidecar stderr: {}", line));
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

        let json = Self::serialize_command(&command)?;
        Self::write_command_line(&child_arc, &json).await
    }

    fn serialize_command(command: &RpcCommand) -> Result<String, String> {
        serde_json::to_string(command).map_err(|e| format!("Failed to serialize command: {}", e))
    }

    async fn write_command_line(
        child_arc: &Arc<Mutex<tauri_plugin_shell::process::CommandChild>>,
        json: &str,
    ) -> Result<(), String> {
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

        let json = Self::serialize_command(&command)?;

        if let Err(error) = Self::write_command_line(&child_arc, &json).await {
            Self::remove_pending_request(state, &id).await;
            return Err(error);
        }

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
