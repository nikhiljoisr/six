//! Six — an Ivy Lee Method app. The Rust core owns every rule; the webview only renders.

mod commands;
mod db;
mod domain;
mod scheduler;
mod tray;

use std::fs::{self, File, TryLockError};

use tauri::Manager;

/// Held for the life of the process: one Six per data folder. A second copy launched on
/// the same folder (an old build still running while a new one is opened) would write
/// its own view of the day over the first one's.
struct InstanceLock(#[allow(dead_code)] File);

/// The native macOS notification path needs a .app bundle; `pnpm tauri dev` runs the
/// bare binary, where the plugin would refuse to initialise. Mobile always qualifies.
fn notifications_available() -> bool {
    if cfg!(mobile) {
        return true;
    }
    if !cfg!(target_os = "macos") {
        return false;
    }
    std::env::current_exe()
        .ok()
        .and_then(|exe| {
            let macos = exe.parent()?;
            let contents = macos.parent()?;
            let bundle = contents.parent()?;
            Some(
                macos.file_name()? == "MacOS"
                    && contents.file_name()? == "Contents"
                    && bundle.extension().is_some_and(|e| e == "app"),
            )
        })
        .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let notifications = notifications_available();
    let mut builder = tauri::Builder::default().plugin(
        tauri_plugin_sql::Builder::new()
            .add_migrations(db::DB_URL, db::migrations())
            .build(),
    );
    #[cfg(any(target_os = "macos", mobile))]
    if notifications {
        builder = builder.plugin(tauri_plugin_notifications::init());
    }
    builder
        .setup(move |app| {
            let data_dir = app.path().app_config_dir()?;
            fs::create_dir_all(&data_dir)?;
            let lock = File::create(data_dir.join("six.lock"))?;
            match lock.try_lock() {
                Ok(()) => {
                    app.manage(InstanceLock(lock));
                }
                Err(TryLockError::WouldBlock) => {
                    eprintln!(
                        "[six] another Six is already running on {}; handing over to it",
                        data_dir.display()
                    );
                    let _ = std::process::Command::new("open")
                        .args(["-b", "com.nikhiljois.six"])
                        .status();
                    std::process::exit(0);
                }
                Err(TryLockError::Error(e)) => return Err(e.into()),
            }
            let pool = db::pool_from_plugin(app.handle())?;
            let device_id = tauri::async_runtime::block_on(db::ensure_device_id(&pool))?;
            app.manage(commands::AppState::new(pool, device_id));
            scheduler::setup(app.handle(), notifications);
            if !notifications {
                eprintln!("[nudges] OS notifications off: not running from a .app bundle; in-app banners only");
            }
            #[cfg(target_os = "macos")]
            {
                tray::setup(app.handle())?;
                tray::refresh(app.handle());
            }
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                scheduler::reconcile(&handle).await;
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == commands::window::MAIN {
                match event {
                    // The main window closes to the menu bar; the app keeps running until Quit.
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        #[cfg(target_os = "macos")]
                        {
                            api.prevent_close();
                            let _ = window.hide();
                            tray::main_closed(window.app_handle());
                        }
                        #[cfg(not(target_os = "macos"))]
                        let _ = api;
                    }
                    // Focused: nudges show in-app. Away: the OS delivers them.
                    tauri::WindowEvent::Focused(focused) => {
                        scheduler::set_focused(window.app_handle(), *focused);
                    }
                    _ => {}
                }
            }
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
            commands::tasks::start_pomodoro,
            commands::tasks::acknowledge_pomodoro,
            commands::review::get_review,
            commands::review::trim_session,
            commands::review::complete_review,
            commands::stats::get_streak,
            commands::stats::get_stats,
            commands::stats::export_range,
            commands::stats::export_all,
            commands::nudges::nudge_action,
            commands::nudges::snooze,
            commands::nudges::notification_status,
            commands::nudges::request_notification_permission,
            commands::nudges::get_app_info,
            commands::settings::get_settings,
            commands::settings::set_setting,
            commands::window::show_main,
            commands::window::hide_popover,
            commands::window::show_banner,
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
