mod commands;
mod sidecar;
mod state;
mod types;
mod utils;

use std::sync::Arc;
use tokio::sync::Mutex;

use state::SidecarState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sidecar_state = Arc::new(Mutex::new(SidecarState::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(sidecar_state)
        .invoke_handler(tauri::generate_handler![
            commands::start_agent_session,
            commands::send_prompt,
            commands::abort_agent,
            commands::new_session,
            commands::get_messages
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
