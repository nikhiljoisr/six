//! Window commands shared by the popover, the tray menu and nudge actions.

use tauri::AppHandle;
#[cfg(not(target_os = "macos"))]
use tauri::{Emitter, Manager};

use super::CmdResult;

pub const MAIN: &str = "main";

/// Show and focus the main window, optionally asking it to navigate.
pub fn open_main(app: &AppHandle, target: Option<serde_json::Value>) {
    #[cfg(target_os = "macos")]
    crate::tray::show_main(app, target);
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(w) = app.get_webview_window(MAIN) {
            let _ = w.show();
            let _ = w.set_focus();
            if let Some(t) = target {
                let _ = app.emit_to(MAIN, "navigate", t);
            }
        }
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn show_main(app: AppHandle, target: Option<serde_json::Value>) -> CmdResult<()> {
    open_main(&app, target);
    Ok(())
}

/// The popover moved on to the next queued nudge: keep Six's banner on screen for it.
#[tauri::command(rename_all = "snake_case")]
pub async fn show_banner(app: AppHandle) -> CmdResult<()> {
    #[cfg(target_os = "macos")]
    crate::tray::show_banner(&app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn hide_popover(app: AppHandle) -> CmdResult<()> {
    #[cfg(target_os = "macos")]
    crate::tray::hide_popover(&app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}
