//! Six — an Ivy Lee Method app. The Rust core owns every rule; the webview only renders.

mod commands;
mod db;
mod domain;
mod scheduler;
mod tray;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(db::DB_URL, db::migrations())
                .build(),
        )
        .setup(|app| {
            let pool = db::pool_from_plugin(app.handle())?;
            let device_id = tauri::async_runtime::block_on(db::ensure_device_id(&pool))?;
            app.manage(commands::AppState { pool, device_id });
            #[cfg(target_os = "macos")]
            {
                tray::setup(app.handle())?;
                tray::refresh(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // The main window closes to the menu bar; the app keeps running until Quit.
            #[cfg(target_os = "macos")]
            if window.label() == tray::MAIN {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    tray::main_closed(window.app_handle());
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            commands::plans::get_snapshot,
            commands::plans::get_day,
            commands::plans::get_range,
            commands::plans::get_carryover,
            commands::plans::draft_plan,
            commands::plans::lock_plan,
            commands::plans::edit_plan,
            commands::tasks::activate,
            commands::tasks::complete,
            commands::tasks::pause,
            commands::tasks::resume,
            commands::tasks::defer,
            commands::tasks::skip,
            commands::tasks::reopen,
            commands::tasks::set_note,
            commands::tasks::touch,
            commands::tasks::get_elapsed,
            commands::review::get_review,
            commands::review::trim_session,
            commands::review::complete_review,
            commands::stats::get_streak,
            commands::settings::get_settings,
            commands::settings::set_setting,
            commands::window::show_main,
            commands::window::hide_popover,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Six")
        .run(|app, event| {
            // Clicking the Dock icon (when there is one) brings the main window back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                tray::show_main(app, None);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
