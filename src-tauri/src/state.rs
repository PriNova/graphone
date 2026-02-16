use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::types::RpcResponse;

pub struct PendingRequest {
    pub sender: oneshot::Sender<RpcResponse>,
}

pub struct SidecarState {
    pub child: Option<Arc<Mutex<tauri_plugin_shell::process::CommandChild>>>,
    pub pending_requests: HashMap<String, PendingRequest>,
    pub response_tx: Option<mpsc::Sender<(String, RpcResponse)>>,
    pub session_cwds: HashMap<String, String>,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            child: None,
            pending_requests: HashMap::new(),
            response_tx: None,
            session_cwds: HashMap::new(),
        }
    }
}

impl Default for SidecarState {
    fn default() -> Self {
        Self::new()
    }
}
