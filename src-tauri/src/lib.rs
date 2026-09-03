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
            Ok(())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Six");
}
