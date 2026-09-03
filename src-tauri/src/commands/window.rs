use tauri::AppHandle;

use super::CmdResult;

/// Show and focus the main window, optionally navigating it (`{"name": "planner", ...}`).
#[tauri::command(rename_all = "snake_case")]
pub async fn show_main(app: AppHandle, target: Option<serde_json::Value>) -> CmdResult<()> {
    #[cfg(target_os = "macos")]
    {
        crate::tray::show_main(&app, target);
    }
    #[cfg(not(target_os = "macos"))]
    {
        use tauri::{Emitter, Manager};
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
            if let Some(target) = target {
                let _ = app.emit_to("main", "navigate", target);
            }
        }
    }
    Ok(())
}

/// Hide the tray popover (Escape, or after "Open Six").
#[tauri::command(rename_all = "snake_case")]
pub async fn hide_popover(app: AppHandle) -> CmdResult<()> {
    #[cfg(target_os = "macos")]
    crate::tray::hide_popover(&app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}
