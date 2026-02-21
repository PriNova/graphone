use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

#[cfg(target_os = "linux")]
use flate2::read::GzDecoder;
#[cfg(target_os = "linux")]
use std::fs;
#[cfg(target_os = "linux")]
use std::io::{self, Read};
#[cfg(target_os = "linux")]
use std::path::{Path, PathBuf};
#[cfg(target_os = "linux")]
use std::time::UNIX_EPOCH;
#[cfg(target_os = "linux")]
use tauri::Manager;

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

        #[cfg(target_os = "linux")]
        {
            let sidecar_runtime_dir = prepare_linux_sidecar_runtime(app)?;
            let sidecar_binary = sidecar_runtime_dir.join("pi-agent");

            logger::log(format!(
                "Launching linux sidecar from extracted runtime: {}",
                sidecar_binary.display()
            ));

            return Ok(app
                .shell()
                .command(&sidecar_binary)
                .current_dir(&sidecar_runtime_dir));
        }

        #[cfg(not(target_os = "linux"))]
        {
            app.shell()
                .sidecar("pi-agent")
                .map_err(|e| format!("Failed to create sidecar: {}", e))
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

#[cfg(target_os = "linux")]
fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| {
        format!(
            "Failed to create directory {}: {}",
            destination.display(),
            error
        )
    })?;

    for entry in fs::read_dir(source)
        .map_err(|error| format!("Failed to read directory {}: {}", source.display(), error))?
    {
        let entry = entry.map_err(|error| {
            format!(
                "Failed to iterate directory {}: {}",
                source.display(),
                error
            )
        })?;

        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = entry.metadata().map_err(|error| {
            format!(
                "Failed to read metadata for {}: {}",
                source_path.display(),
                error
            )
        })?;

        if metadata.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else {
            if let Some(parent) = destination_path.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("Failed to create directory {}: {}", parent.display(), error)
                })?;
            }

            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "Failed to copy runtime asset {} to {}: {}",
                    source_path.display(),
                    destination_path.display(),
                    error
                )
            })?;
        }
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn resolve_linux_sidecar_source_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("sidecar").join("linux"));
    }

    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecar/linux"));

    for candidate in candidates {
        if candidate.join("pi-agent.gz").exists() {
            return Ok(candidate);
        }
    }

    Err("Linux sidecar bundle not found in resource directories".to_string())
}

#[cfg(target_os = "linux")]
fn source_stamp(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Failed to stat {}: {}", path.display(), error))?;

    let modified_secs = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0);

    Ok(format!("{}:{}", metadata.len(), modified_secs))
}

#[cfg(target_os = "linux")]
fn validate_linux_sidecar_binary(path: &Path) -> Result<(), String> {
    let mut file = fs::File::open(path).map_err(|error| {
        format!(
            "Failed to open {} for validation: {}",
            path.display(),
            error
        )
    })?;

    let mut header = [0_u8; 4];
    file.read_exact(&mut header).map_err(|error| {
        format!(
            "Failed to read ELF header from {}: {}",
            path.display(),
            error
        )
    })?;

    if header == [0x7f, b'E', b'L', b'F'] {
        return Ok(());
    }

    Err(format!(
        "Linux sidecar binary {} is not a valid ELF executable. Rebuild without GRAPHONE_SKIP_SIDECAR_BUILD.",
        path.display()
    ))
}

#[cfg(target_os = "linux")]
fn prepare_linux_sidecar_runtime(app: &AppHandle) -> Result<PathBuf, String> {
    let source_dir = resolve_linux_sidecar_source_dir(app)?;
    let compressed_binary = source_dir.join("pi-agent.gz");
    let source_stamp = source_stamp(&compressed_binary)?;

    let app_local_data_dir = app.path().app_local_data_dir().map_err(|error| {
        format!(
            "Failed to resolve app local data directory for linux sidecar: {}",
            error
        )
    })?;

    let runtime_dir = app_local_data_dir.join("sidecar").join("linux-runtime");
    let stamp_path = runtime_dir.join(".stamp");
    let extracted_binary = runtime_dir.join("pi-agent");

    let needs_refresh = match fs::read_to_string(&stamp_path) {
        Ok(current_stamp) => current_stamp.trim() != source_stamp || !extracted_binary.exists(),
        Err(_) => true,
    };

    if !needs_refresh {
        if let Err(error) = validate_linux_sidecar_binary(&extracted_binary) {
            logger::log(format!(
                "Linux sidecar runtime at {} failed validation ({}). Refreshing runtime.",
                extracted_binary.display(),
                error
            ));
        } else {
            return Ok(runtime_dir);
        }
    }

    if runtime_dir.exists() {
        fs::remove_dir_all(&runtime_dir).map_err(|error| {
            format!(
                "Failed to remove stale linux sidecar runtime {}: {}",
                runtime_dir.display(),
                error
            )
        })?;
    }

    fs::create_dir_all(&runtime_dir).map_err(|error| {
        format!(
            "Failed to create linux sidecar runtime {}: {}",
            runtime_dir.display(),
            error
        )
    })?;

    for entry in fs::read_dir(&source_dir)
        .map_err(|error| format!("Failed to read {}: {}", source_dir.display(), error))?
    {
        let entry = entry.map_err(|error| {
            format!(
                "Failed to iterate source sidecar directory {}: {}",
                source_dir.display(),
                error
            )
        })?;

        let source_path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();

        if name == "pi-agent.gz" {
            continue;
        }

        let destination_path = runtime_dir.join(&*name);
        if source_path.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "Failed to copy linux sidecar asset {} to {}: {}",
                    source_path.display(),
                    destination_path.display(),
                    error
                )
            })?;
        }
    }

    let source_file = fs::File::open(&compressed_binary).map_err(|error| {
        format!(
            "Failed to open compressed linux sidecar {}: {}",
            compressed_binary.display(),
            error
        )
    })?;
    let mut decoder = GzDecoder::new(source_file);

    let mut output_file = fs::File::create(&extracted_binary).map_err(|error| {
        format!(
            "Failed to create extracted linux sidecar {}: {}",
            extracted_binary.display(),
            error
        )
    })?;

    io::copy(&mut decoder, &mut output_file).map_err(|error| {
        format!(
            "Failed to extract linux sidecar {}: {}",
            extracted_binary.display(),
            error
        )
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&extracted_binary)
            .map_err(|error| {
                format!(
                    "Failed to read permissions for {}: {}",
                    extracted_binary.display(),
                    error
                )
            })?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&extracted_binary, permissions).map_err(|error| {
            format!(
                "Failed to set executable permissions on {}: {}",
                extracted_binary.display(),
                error
            )
        })?;
    }

    validate_linux_sidecar_binary(&extracted_binary)?;

    fs::write(&stamp_path, source_stamp).map_err(|error| {
        format!(
            "Failed to write linux sidecar stamp {}: {}",
            stamp_path.display(),
            error
        )
    })?;

    Ok(runtime_dir)
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

    fn truncate_string(value: &str, max_chars: usize) -> String {
        if value.chars().count() <= max_chars {
            return value.to_string();
        }

        let truncated = value.chars().take(max_chars).collect::<String>();
        format!("{}…", truncated)
    }

    fn compact_json_value(value: &serde_json::Value, depth: usize) -> serde_json::Value {
        const MAX_DEPTH: usize = 2;
        const MAX_STRING_CHARS: usize = 1024;
        const MAX_OBJECT_KEYS: usize = 16;
        const MAX_ARRAY_ITEMS: usize = 16;

        match value {
            serde_json::Value::String(text) => {
                serde_json::Value::String(Self::truncate_string(text, MAX_STRING_CHARS))
            }
            serde_json::Value::Array(items) => {
                if depth >= MAX_DEPTH {
                    return serde_json::json!({
                        "_truncatedArrayItems": items.len(),
                    });
                }

                let mut compacted = items
                    .iter()
                    .take(MAX_ARRAY_ITEMS)
                    .map(|item| Self::compact_json_value(item, depth + 1))
                    .collect::<Vec<_>>();

                if items.len() > MAX_ARRAY_ITEMS {
                    compacted.push(serde_json::json!({
                        "_truncatedArrayItems": items.len() - MAX_ARRAY_ITEMS,
                    }));
                }

                serde_json::Value::Array(compacted)
            }
            serde_json::Value::Object(map) => {
                if depth >= MAX_DEPTH {
                    return serde_json::json!({
                        "_truncatedObjectKeys": map.len(),
                    });
                }

                let mut compacted = serde_json::Map::new();

                for (index, (key, entry)) in map.iter().enumerate() {
                    if index >= MAX_OBJECT_KEYS {
                        compacted.insert(
                            "_truncatedObjectKeys".to_string(),
                            serde_json::json!(map.len() - MAX_OBJECT_KEYS),
                        );
                        break;
                    }

                    compacted.insert(key.clone(), Self::compact_json_value(entry, depth + 1));
                }

                serde_json::Value::Object(compacted)
            }
            _ => value.clone(),
        }
    }

    fn compact_tool_call(value: &serde_json::Value) -> serde_json::Value {
        let id = value
            .get("id")
            .and_then(|entry| entry.as_str())
            .unwrap_or_default()
            .to_string();

        let name = value
            .get("name")
            .and_then(|entry| entry.as_str())
            .unwrap_or_default()
            .to_string();

        let arguments = value
            .get("arguments")
            .map(|entry| Self::compact_json_value(entry, 0))
            .unwrap_or_else(|| serde_json::json!({}));

        serde_json::json!({
            "type": "toolCall",
            "id": id,
            "name": name,
            "arguments": arguments,
        })
    }

    fn extract_tool_call_from_partial(
        assistant_event: &serde_json::Map<String, serde_json::Value>,
    ) -> Option<serde_json::Value> {
        let content_index = assistant_event
            .get("contentIndex")
            .and_then(|value| value.as_u64())? as usize;

        let partial = assistant_event.get("partial")?;
        let content = partial.get("content")?.as_array()?;
        let tool_call = content.get(content_index)?;

        if tool_call.get("type").and_then(|entry| entry.as_str()) != Some("toolCall") {
            return None;
        }

        Some(Self::compact_tool_call(tool_call))
    }

    fn compact_tool_execution_start_event(event: &serde_json::Value) -> serde_json::Value {
        let tool_call_id = event
            .get("toolCallId")
            .and_then(|value| value.as_str())
            .unwrap_or_default();

        let tool_name = event
            .get("toolName")
            .and_then(|value| value.as_str())
            .unwrap_or_default();

        let args = event
            .get("args")
            .map(|value| Self::compact_json_value(value, 0))
            .unwrap_or_else(|| serde_json::json!({}));

        serde_json::json!({
            "type": "tool_execution_start",
            "toolCallId": tool_call_id,
            "toolName": tool_name,
            "args": args,
        })
    }

    fn compact_tool_execution_update_event(event: &serde_json::Value) -> serde_json::Value {
        let tool_call_id = event
            .get("toolCallId")
            .and_then(|value| value.as_str())
            .unwrap_or_default();

        let tool_name = event
            .get("toolName")
            .and_then(|value| value.as_str())
            .unwrap_or_default();

        serde_json::json!({
            "type": "tool_execution_update",
            "toolCallId": tool_call_id,
            "toolName": tool_name,
        })
    }

    fn compact_tool_execution_end_event(event: &serde_json::Value) -> serde_json::Value {
        const MAX_RESULT_CHARS: usize = 24_000;

        let tool_call_id = event
            .get("toolCallId")
            .and_then(|value| value.as_str())
            .unwrap_or_default();

        let tool_name = event
            .get("toolName")
            .and_then(|value| value.as_str())
            .unwrap_or_default();

        let is_error = event
            .get("isError")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);

        let result = match event.get("result") {
            Some(serde_json::Value::String(text)) => {
                serde_json::Value::String(Self::truncate_string(text, MAX_RESULT_CHARS))
            }
            Some(value) => Self::compact_json_value(value, 0),
            None => serde_json::Value::Null,
        };

        serde_json::json!({
            "type": "tool_execution_end",
            "toolCallId": tool_call_id,
            "toolName": tool_name,
            "isError": is_error,
            "result": result,
        })
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
                        let assistant_event_type = map
                            .get("type")
                            .and_then(|value| value.as_str())
                            .unwrap_or_default();

                        if (assistant_event_type == "toolcall_start"
                            || assistant_event_type == "toolcall_delta")
                            && !map.contains_key("toolCall")
                        {
                            if let Some(tool_call) = Self::extract_tool_call_from_partial(&map) {
                                map.insert("toolCall".to_string(), tool_call);
                            }
                        }

                        if let Some(tool_call) = map.get("toolCall").cloned() {
                            map.insert("toolCall".to_string(), Self::compact_tool_call(&tool_call));
                        }

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
            Some("tool_execution_start") => Self::compact_tool_execution_start_event(&event),
            Some("tool_execution_update") => Self::compact_tool_execution_update_event(&event),
            Some("tool_execution_end") => Self::compact_tool_execution_end_event(&event),
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
