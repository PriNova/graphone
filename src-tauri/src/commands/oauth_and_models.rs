use std::sync::Arc;

use tokio::sync::Mutex;

use super::sidecar_lifecycle::send_command_with_response;
use crate::state::SidecarState;
use crate::types::{RpcCommand, RpcResponse};
use crate::utils::crypto_random_uuid;

fn require_session_id(session_id: String, command: &str) -> Result<String, String> {
    let trimmed = session_id.trim().to_string();
    if trimmed.is_empty() {
        return Err(format!("sessionId is required for {}", command));
    }

    Ok(trimmed)
}

/// Get available models (filtered by configured auth)
pub async fn get_available_models(
    state: &Arc<Mutex<SidecarState>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "get_available_models")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "get_available_models".to_string(),
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

    let mut response = send_command_with_response(state, cmd, 5).await?;

    // Keep IPC payload compact for webview transport reliability.
    // Host already returns compact models, but we defensively normalize here.
    if response.success {
        if let Some(data) = response.data.take() {
            let compact_models = data
                .get("models")
                .and_then(|models| models.as_array())
                .map(|models| {
                    models
                        .iter()
                        .filter_map(|model| {
                            let provider = model.get("provider")?.as_str()?;
                            let id = model.get("id")?.as_str()?;
                            let name = model.get("name").and_then(|v| v.as_str()).unwrap_or(id);
                            let supports_image_input = model
                                .get("supportsImageInput")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);

                            Some(serde_json::json!({
                                "provider": provider,
                                "id": id,
                                "name": name,
                                "supportsImageInput": supports_image_input,
                            }))
                        })
                        .collect::<Vec<serde_json::Value>>()
                })
                .unwrap_or_default();

            response.data = Some(serde_json::json!({ "models": compact_models }));
        }
    }

    Ok(response)
}

/// Get OAuth providers and current login status.
pub async fn get_oauth_providers(
    state: &Arc<Mutex<SidecarState>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "get_oauth_providers")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "oauth_list_providers".to_string(),
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

    send_command_with_response(state, cmd, 5).await
}

/// Start OAuth login flow for a provider.
pub async fn start_oauth_login(
    state: &Arc<Mutex<SidecarState>>,
    provider: String,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "start_oauth_login")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "oauth_start_login".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: None,
        provider: Some(provider),
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    send_command_with_response(state, cmd, 5).await
}

/// Poll current OAuth login flow state and updates.
pub async fn poll_oauth_login(
    state: &Arc<Mutex<SidecarState>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "poll_oauth_login")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "oauth_poll_login".to_string(),
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

    send_command_with_response(state, cmd, 5).await
}

/// Submit user input for the active OAuth login step.
pub async fn submit_oauth_login_input(
    state: &Arc<Mutex<SidecarState>>,
    session_id: String,
    input: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "submit_oauth_login_input")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "oauth_submit_login_input".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: Some(input),
        provider: None,
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    send_command_with_response(state, cmd, 5).await
}

/// Cancel the active OAuth login flow (if any).
pub async fn cancel_oauth_login(
    state: &Arc<Mutex<SidecarState>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "cancel_oauth_login")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "oauth_cancel_login".to_string(),
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

    send_command_with_response(state, cmd, 5).await
}

/// Logout from an OAuth provider.
pub async fn logout_oauth_provider(
    state: &Arc<Mutex<SidecarState>>,
    provider: String,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "logout_oauth_provider")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "oauth_logout".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: None,
        provider: Some(provider),
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    send_command_with_response(state, cmd, 5).await
}

/// Set active model by provider and model id
pub async fn set_model(
    state: &Arc<Mutex<SidecarState>>,
    provider: String,
    model_id: String,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "set_model")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "set_model".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: None,
        provider: Some(provider),
        model_id: Some(model_id),
        streaming_behavior: None,
        session_file: None,
        level: None,
        images: None,
    };

    send_command_with_response(state, cmd, 5).await
}

/// Set thinking level for the active session model.
pub async fn set_thinking_level(
    state: &Arc<Mutex<SidecarState>>,
    level: String,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "set_thinking_level")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "set_thinking_level".to_string(),
        session_id: Some(session_id),
        cwd: None,
        message: None,
        provider: None,
        model_id: None,
        streaming_behavior: None,
        session_file: None,
        level: Some(level),
        images: None,
    };

    send_command_with_response(state, cmd, 5).await
}

/// Cycle to next model
pub async fn cycle_model(
    state: &Arc<Mutex<SidecarState>>,
    session_id: String,
) -> Result<RpcResponse, String> {
    let session_id = require_session_id(session_id, "cycle_model")?;

    let cmd = RpcCommand {
        id: Some(crypto_random_uuid()),
        r#type: "cycle_model".to_string(),
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

    send_command_with_response(state, cmd, 5).await
}
