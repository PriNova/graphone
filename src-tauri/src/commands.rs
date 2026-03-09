use std::sync::Arc;

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;

#[cfg(target_os = "linux")]
use crate::logger;
use crate::state::SidecarState;
use crate::types::{RpcCommand, RpcImageAttachment, RpcResponse};
use crate::utils::crypto_random_uuid;

mod oauth_and_models;
mod session_scopes;
mod settings;
mod sidecar_lifecycle;

pub use session_scopes::{DeleteProjectSessionResponse, SessionProjectScopesResponse};
pub use settings::EnabledModelsResponse;

#[tauri::command]
pub fn list_session_project_scopes() -> SessionProjectScopesResponse {
    session_scopes::list_session_project_scopes()
}

#[tauri::command]
pub fn delete_project_scope(project_dir: String) -> Result<usize, String> {
    session_scopes::delete_project_scope(project_dir)
}

#[tauri::command]
pub fn delete_project_session(
    project_dir: String,
    session_id: String,
    file_path: String,
) -> Result<DeleteProjectSessionResponse, String> {
    session_scopes::delete_project_session(project_dir, session_id, file_path)
}

/// Get the current working directory (the directory in which the app executes).
#[tauri::command]
pub fn get_working_directory() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to determine current working directory: {e}"))
}

/// Open an external URL in the system browser.
///
/// - Windows/macOS: use Tauri's opener plugin.
/// - Linux native: try opener first, then fall back to command-based open.
/// - Linux with Windows host interop: prefer command-based open first
///   (cmd.exe/powershell/explorer) to reliably target the host browser.
#[tauri::command]
pub fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL cannot be empty".to_string());
    }

    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("Only http:// and https:// URLs are supported".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        if crate::platform::linux_open_url::has_windows_host_interop() {
            logger::log(
                "Windows host interop detected: using command-based URL opener path".to_string(),
            );
            return crate::platform::linux_open_url::open_external_url_linux(trimmed);
        }

        match app.opener().open_url(trimmed, None::<&str>) {
            Ok(()) => {
                logger::log("Opened OAuth URL with tauri opener plugin".to_string());
                Ok(())
            }
            Err(opener_error) => {
                logger::log(format!(
                    "tauri opener failed on Linux ({}), trying command fallback",
                    opener_error
                ));
                crate::platform::linux_open_url::open_external_url_linux(trimmed)
            }
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        app.opener()
            .open_url(trimmed, None::<&str>)
            .map_err(|error| format!("Failed to open external URL via tauri opener: {}", error))
    }
}

/// Get enabledModels patterns from pi settings.
///
/// Precedence: project settings (`<projectDir>/.pi/settings.json`) override global settings (`~/.pi/agent/settings.json`).
#[tauri::command]
pub fn get_enabled_models(project_dir: Option<String>) -> EnabledModelsResponse {
    settings::get_enabled_models(project_dir)
}

/// Persist enabledModels patterns to a pi settings file.
///
/// - patterns: the enabledModels array to write. Empty means "no scoping" (all models enabled).
/// - scope: "auto" (default), "project", or "global".
#[tauri::command]
pub fn set_enabled_models(
    patterns: Vec<String>,
    scope: Option<String>,
    project_dir: Option<String>,
) -> Result<EnabledModelsResponse, String> {
    settings::set_enabled_models(patterns, scope, project_dir)
}

pub async fn shutdown_sidecar_gracefully(state: &Arc<Mutex<SidecarState>>) -> Result<(), String> {
    sidecar_lifecycle::shutdown_sidecar_gracefully(state).await
}

#[tauri::command]
pub async fn create_agent(
    app: AppHandle,
    state: State<'_, Arc<Mutex<SidecarState>>>,
    project_dir: String,
    provider: Option<String>,
    model: Option<String>,
    session_file: Option<String>,
) -> Result<RpcResponse, String> {
    sidecar_lifecycle::create_session_internal(
        app,
        state.inner(),
        project_dir,
        provider,
        model,
        session_file,
    )
    .await
}

#[tauri::command]
pub async fn close_agent(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    sidecar_lifecycle::close_agent(state.inner(), session_id).await
}

#[tauri::command]
pub async fn list_agents(
    state: State<'_, Arc<Mutex<SidecarState>>>,
) -> Result<RpcResponse, String> {
    sidecar_lifecycle::list_agents(state.inner()).await
}

/// Best-effort native clipboard image read.
/// Primarily used as a fallback on Linux/Wayland when WebView clipboard events
/// do not expose image items reliably.
#[tauri::command]
pub async fn read_clipboard_image() -> Result<Option<RpcImageAttachment>, String> {
    #[cfg(target_os = "linux")]
    {
        return Ok(crate::platform::linux_clipboard::read_clipboard_image_linux());
    }

    #[cfg(not(target_os = "linux"))]
    {
        Ok(None)
    }
}

fn require_session_id(session_id: String, command: &str) -> Result<String, String> {
    let trimmed = session_id.trim().to_string();
    if trimmed.is_empty() {
        return Err(format!("sessionId is required for {}", command));
    }

    Ok(trimmed)
}

/// Send a prompt to the agent
#[tauri::command]
pub async fn send_prompt(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    prompt: String,
    session_id: String,
    images: Option<Vec<RpcImageAttachment>>,
) -> Result<(), String> {
    let session_id = require_session_id(session_id, "prompt")?;

    let images = images
        .map(|attachments| {
            attachments
                .into_iter()
                .filter(|attachment| {
                    attachment.r#type == "image"
                        && !attachment.data.is_empty()
                        && attachment.mime_type.starts_with("image/")
                })
                .collect::<Vec<_>>()
        })
        .filter(|attachments| !attachments.is_empty());

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "prompt".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: Some(prompt),
        provider: None,
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images,
    };

    crate::sidecar::RpcClient::send_command(state.inner(), cmd).await
}

#[tauri::command]
pub async fn send_bash_command(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    command: String,
    session_id: String,
    exclude_from_context: Option<bool>,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "bash")?;

    let trimmed_command = command.trim().to_string();
    if trimmed_command.is_empty() {
        return Err("command must be a non-empty string".to_string());
    }

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "bash".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: Some(trimmed_command),
        provider: None,
        model_id: None,
        streaming_behavior: exclude_from_context
            .filter(|value| *value)
            .map(|_| "excludeFromContext".to_string()),
        session_file: None,
        level: None,
        images: None,
    };

    sidecar_lifecycle::send_command_with_response(state.inner(), cmd, 3600).await
}

/// Abort the current agent operation
#[tauri::command]
pub async fn abort_agent(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<(), String> {
    let session_id = require_session_id(session_id, "abort")?;

    let cmd = RpcCommand {
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

    crate::sidecar::RpcClient::send_command(state.inner(), cmd).await
}

#[tauri::command]
pub async fn abort_bash(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "abort_bash")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "abort_bash".to_string(),
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

    sidecar_lifecycle::send_command_with_response(state.inner(), cmd, 5).await
}

/// Create a new session
#[tauri::command]
pub async fn new_session(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "new_session")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "new_session".to_string(),
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

    sidecar_lifecycle::send_command_with_response(state.inner(), cmd, 5).await
}

/// Get messages from the current session
#[tauri::command]
pub async fn get_messages(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "get_messages")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "get_messages".to_string(),
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

    sidecar_lifecycle::send_command_with_response(state.inner(), cmd, 5).await
}

/// Get current session state (including selected model/provider)
#[tauri::command]
pub async fn get_state(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "get_state")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "get_state".to_string(),
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

    sidecar_lifecycle::send_command_with_response(state.inner(), cmd, 5).await
}

#[tauri::command]
pub async fn get_available_models(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    oauth_and_models::get_available_models(state.inner(), session_id).await
}

#[tauri::command]
pub async fn get_registered_extensions(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "get_registered_extensions")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "get_registered_extensions".to_string(),
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

    sidecar_lifecycle::send_command_with_response(state.inner(), cmd, 5).await
}

#[tauri::command]
pub async fn get_oauth_providers(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    oauth_and_models::get_oauth_providers(state.inner(), session_id).await
}

#[tauri::command]
pub async fn start_oauth_login(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    provider: String,
    session_id: String,
) -> Result<RpcResponse, String> {
    oauth_and_models::start_oauth_login(state.inner(), provider, session_id).await
}

#[tauri::command]
pub async fn poll_oauth_login(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    oauth_and_models::poll_oauth_login(state.inner(), session_id).await
}

#[tauri::command]
pub async fn submit_oauth_login_input(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
    input: String,
) -> Result<RpcResponse, String> {
    oauth_and_models::submit_oauth_login_input(state.inner(), session_id, input).await
}

#[tauri::command]
pub async fn cancel_oauth_login(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    oauth_and_models::cancel_oauth_login(state.inner(), session_id).await
}

#[tauri::command]
pub async fn logout_oauth_provider(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    provider: String,
    session_id: String,
) -> Result<RpcResponse, String> {
    oauth_and_models::logout_oauth_provider(state.inner(), provider, session_id).await
}

#[tauri::command]
pub async fn set_model(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    provider: String,
    model_id: String,
    session_id: String,
) -> Result<RpcResponse, String> {
    oauth_and_models::set_model(state.inner(), provider, model_id, session_id).await
}

#[tauri::command]
pub async fn set_thinking_level(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    level: String,
    session_id: String,
) -> Result<RpcResponse, String> {
    oauth_and_models::set_thinking_level(state.inner(), level, session_id).await
}

#[tauri::command]
pub async fn cycle_model(
    state: State<'_, Arc<Mutex<SidecarState>>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    oauth_and_models::cycle_model(state.inner(), session_id).await
}
