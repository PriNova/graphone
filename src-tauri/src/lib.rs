mod commands;
mod logger;
mod sidecar;
mod state;
mod types;
mod utils;

use std::sync::Arc;
use tokio::sync::Mutex;

use state::SidecarState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logger::init();
    logger::log("Starting graphone");

    std::panic::set_hook(Box::new(|panic_info| {
        crate::logger::log(format!("panic: {}", panic_info));
    }));

    let sidecar_state = Arc::new(Mutex::new(SidecarState::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(sidecar_state)
        .invoke_handler(tauri::generate_handler![
            commands::get_working_directory,
            commands::list_session_project_scopes,
            commands::delete_project_scope,
            commands::delete_project_session,
            commands::create_agent,
            commands::close_agent,
            commands::list_agents,
            commands::send_prompt,
            commands::read_clipboard_image,
            commands::abort_agent,
            commands::new_session,
            commands::get_messages,
            commands::get_state,
            commands::get_available_models,
            commands::set_model,
            commands::set_thinking_level,
            commands::cycle_model,
            commands::get_enabled_models,
            commands::set_enabled_models,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
