mod commands;
mod logger;
mod sidecar;
mod state;
mod types;
mod utils;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use tauri::Manager;
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

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(sidecar_state)
        .invoke_handler(tauri::generate_handler![
            commands::get_working_directory,
            commands::open_external_url,
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
            commands::get_oauth_providers,
            commands::start_oauth_login,
            commands::poll_oauth_login,
            commands::submit_oauth_login_input,
            commands::cancel_oauth_login,
            commands::logout_oauth_provider,
            commands::set_model,
            commands::set_thinking_level,
            commands::cycle_model,
            commands::get_enabled_models,
            commands::set_enabled_models,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    let shutdown_started = Arc::new(AtomicBool::new(false));
    let shutdown_complete = Arc::new(AtomicBool::new(false));

    app.run(move |app_handle, event| {
        if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
            if shutdown_complete.load(Ordering::SeqCst) {
                return;
            }

            api.prevent_exit();

            if shutdown_started.swap(true, Ordering::SeqCst) {
                return;
            }

            let app_handle = app_handle.clone();
            let sidecar_state = app_handle
                .state::<Arc<Mutex<SidecarState>>>()
                .inner()
                .clone();
            let shutdown_complete = shutdown_complete.clone();
            let exit_code = code.unwrap_or(0);

            tauri::async_runtime::spawn(async move {
                let _ = commands::shutdown_sidecar_gracefully(&sidecar_state).await;
                shutdown_complete.store(true, Ordering::SeqCst);
                app_handle.exit(exit_code);
            });
        }
    });
}
