//! One optional global shortcut: summon Six from any app, or send it back to the menu
//! bar. Off unless chosen in Settings; a short list of combinations rather than a
//! recorder, so the choice is always one macOS can register.

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::commands::window::MAIN;
use crate::domain::settings::GLOBAL_SHORTCUTS;

pub fn plugin() -> TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                toggle_main(app);
            }
        })
        .build()
}

/// Bring the registered shortcut in line with the setting. `Err` carries a sentence for
/// the user when the combination could not be taken (another app holds it).
pub fn apply(app: &AppHandle, choice: &str) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    if choice == "off" || !GLOBAL_SHORTCUTS.contains(&choice) {
        return Ok(());
    }
    shortcuts
        .register(choice)
        .map_err(|e| format!("That shortcut could not be registered; another app may be using it. ({e})"))
}

/// In front and focused: back to the menu bar. Anything else: show and focus.
fn toggle_main(app: &AppHandle) {
    let in_front = app
        .get_webview_window(MAIN)
        .is_some_and(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false));
    if in_front {
        if let Some(window) = app.get_webview_window(MAIN) {
            let _ = window.hide();
        }
        #[cfg(target_os = "macos")]
        crate::tray::main_closed(app);
    } else {
        crate::commands::window::open_main(app, None);
    }
}
