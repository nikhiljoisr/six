//! Six — an Ivy Lee Method app. The Rust core owns every rule; the webview only renders.

mod commands;
mod db;
mod domain;
mod coach;
mod hotkey;
mod login_item;
mod scheduler;
mod tray;

use std::fs::{self, File, TryLockError};

use tauri::Manager;

/// Held for the life of the process: one Six per data folder. A second copy launched on
/// the same folder (an old build still running while a new one is opened) would write
/// its own view of the day over the first one's.
struct InstanceLock(#[allow(dead_code)] File);

/// Where the main window's size is remembered (a row in `settings`, not a setting).
const WINDOW_SIZE_KEY: &str = "window_size";

/// Counts the main window's resizes, so the size is saved once a drag has settled.
#[derive(Default)]
struct WindowMemo(std::sync::atomic::AtomicU64);

/// The green button zooms the window to its largest size and back. It never enters macOS
/// full screen, which for a card this small is a column on a black field.
#[cfg(target_os = "macos")]
fn zoom_never_full_screen(window: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
    let Ok(pointer) = window.ns_window() else {
        return;
    };
    if pointer.is_null() {
        return;
    }
    // Safety: this is the live NSWindow behind the Tauri window, which outlives this
    // call, and it is used on the main thread (setup runs there), as AppKit requires.
    let ns_window: &NSWindow = unsafe { &*pointer.cast::<NSWindow>() };
    let mut behavior = ns_window.collectionBehavior();
    behavior.remove(NSWindowCollectionBehavior::FullScreenPrimary);
    behavior.insert(NSWindowCollectionBehavior::FullScreenNone);
    ns_window.setCollectionBehavior(behavior);
}

/// The main window changed size: draw the page at the scale that fits its width, and
/// remember the size once the drag has settled.
fn main_resized(window: &tauri::Window, size: &tauri::PhysicalSize<u32>) {
    use std::sync::atomic::Ordering;
    let logical = size.to_logical::<f64>(window.scale_factor().unwrap_or(1.0));
    if logical.width < 100.0 {
        return; // hidden or minimised: not a size anyone chose
    }
    let app = window.app_handle().clone();
    if let Some(main) = app.get_webview_window(commands::window::MAIN) {
        let _ = main.set_zoom(domain::window::page_scale(logical.width));
    }
    let Some(memo) = app.try_state::<WindowMemo>() else {
        return;
    };
    let turn = memo.0.fetch_add(1, Ordering::SeqCst) + 1;
    let stored = domain::window::format_size(logical.width, logical.height);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(700)).await;
        let Some(memo) = app.try_state::<WindowMemo>() else {
            return;
        };
        if memo.0.load(Ordering::SeqCst) != turn || domain::window::parse_size(&stored).is_none() {
            return;
        }
        if let Some(state) = app.try_state::<commands::AppState>() {
            let _gate = state.gate.lock().await;
            let _ = db::save_setting(&state.pool, WINDOW_SIZE_KEY, &stored, chrono::Utc::now()).await;
        }
    });
}

/// The native macOS notification path needs a .app bundle; `pnpm tauri dev` runs the
/// bare binary, where the plugin would refuse to initialise. Mobile always qualifies.
fn notifications_available() -> bool {
    if cfg!(mobile) {
        return true;
    }
    if !cfg!(target_os = "macos") {
        return false;
    }
    in_app_bundle()
}

/// Whether this process is the executable of a .app bundle (not a `cargo` build run directly).
fn in_app_bundle() -> bool {
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
    let mut builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(db::DB_URL, db::migrations())
                .build(),
        )
        // Opening at login is the user's choice (Settings); the launch agent is named
        // for the bundle so it is recognisable in ~/Library/LaunchAgents.
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name(login_item::LABEL)
                .macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent)
                .build(),
        )
        .plugin(hotkey::plugin());
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
            // One copy of the database per day Six is opened, the last seven kept.
            let today = chrono::Local::now().date_naive();
            match tauri::async_runtime::block_on(db::backup::run(&pool, &data_dir.join("backups"), today)) {
                Ok(Some(path)) => eprintln!("[six] backup written: {}", path.display()),
                Ok(None) => {}
                Err(problem) => eprintln!("[six] backup skipped: {problem}"),
            }
            let device_id = tauri::async_runtime::block_on(db::ensure_device_id(&pool))?;
            let saved = tauri::async_runtime::block_on(db::load_settings(&pool)).unwrap_or_default();
            let shortcut = saved.global_shortcut.clone();
            commands::settings::apply_appearance(app.handle(), &saved.appearance);
            // The window opens at the size it was left at, and the page at the scale
            // that fits it. Until a size has been chosen it opens as it always has.
            app.manage(WindowMemo::default());
            if let Some(main) = app.get_webview_window(commands::window::MAIN) {
                #[cfg(target_os = "macos")]
                zoom_never_full_screen(&main);
                let remembered = tauri::async_runtime::block_on(db::get_raw_setting(&pool, WINDOW_SIZE_KEY))
                    .ok()
                    .flatten()
                    .and_then(|s| domain::window::parse_size(&s));
                if let Some(size) = remembered {
                    // Never larger than the screen it opens on (a size chosen on a big
                    // display, reopened on the laptop).
                    let room = main.current_monitor().ok().flatten().map(|m| {
                        let area = m.work_area().size.to_logical::<f64>(m.scale_factor());
                        (area.width, area.height)
                    });
                    let (width, height) = domain::window::fit(size, room);
                    let _ = main.set_size(tauri::LogicalSize::new(width, height));
                    let _ = main.set_zoom(domain::window::page_scale(width));
                }
            }
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
            if let Err(problem) = hotkey::apply(app.handle(), &shortcut) {
                eprintln!("[six] global shortcut not registered: {problem}");
            }
            // The login item records where Six was when the switch was set. If the app
            // it names is gone (moved, replaced), point it at the Six that is running.
            {
                use tauri_plugin_autostart::ManagerExt;
                let launcher = app.autolaunch();
                if launcher.is_enabled().unwrap_or(false) {
                    let recorded = app
                        .path()
                        .home_dir()
                        .ok()
                        .map(|home| home.join("Library/LaunchAgents").join(format!("{}.plist", login_item::LABEL)))
                        .and_then(|plist| fs::read_to_string(plist).ok())
                        .and_then(|text| login_item::recorded_program(&text));
                    let exists = recorded.as_deref().is_some_and(|p| std::path::Path::new(p).exists());
                    let here = std::env::current_exe()
                        .map(|p| p.display().to_string())
                        .unwrap_or_default();
                    if login_item::should_repoint(recorded.as_deref(), exists, &here, in_app_bundle()) {
                        if let Err(problem) = launcher.enable() {
                            eprintln!("[six] login item not refreshed: {problem}");
                        }
                    }
                }
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
                    tauri::WindowEvent::Resized(size) => main_resized(window, size),
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
            commands::tasks::add_jot,
            commands::tasks::remove_jot,
            commands::review::get_review,
            commands::review::trim_session,
            commands::review::keep_gap,
            commands::review::trim_return_gap,
            commands::coach::coach_status,
            commands::coach::coach_plan,
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
            commands::settings::get_autostart,
            commands::settings::set_autostart,
            commands::window::show_main,
            commands::window::hide_popover,
            commands::window::show_banner,
            commands::window::size_popover,
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
