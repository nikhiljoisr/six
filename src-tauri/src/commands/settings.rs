use tauri::{AppHandle, Manager};

use super::{AppState, CmdResult, DaySnapshot};
use crate::db;
use crate::domain::Settings;

#[tauri::command(rename_all = "snake_case")]
pub async fn get_settings(app: AppHandle) -> CmdResult<Settings> {
    let state = app.state::<AppState>();
    Ok(db::load_settings(&state.pool).await?)
}

/// Change one setting (validated against its range) and broadcast the new snapshot,
/// since the evening hour and rollover hour change what the day looks like.
#[tauri::command(rename_all = "snake_case")]
pub async fn set_setting(app: AppHandle, key: String, value: String) -> CmdResult<DaySnapshot> {
    let state = app.state::<AppState>();
    Settings::validate(&key, &value)?;
    let _gate = state.gate.lock().await;
    if key == "global_shortcut" {
        // Taken before it is saved: a combination another app holds is refused, and the
        // one that was working is put back.
        if let Err(problem) = crate::hotkey::apply(&app, value.trim()) {
            let current = db::load_settings(&state.pool).await?.global_shortcut;
            let _ = crate::hotkey::apply(&app, &current);
            return Err(super::AppError::new("shortcut_unavailable", problem));
        }
    }
    db::save_setting(&state.pool, &key, value.trim(), chrono::Utc::now()).await?;
    super::publish(&app).await
}

/// Whether Six opens when you log in. The answer lives with macOS (a launch agent in the
/// user's Library), not in Six's own settings.
#[tauri::command(rename_all = "snake_case")]
pub async fn get_autostart(app: AppHandle) -> CmdResult<bool> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch()
        .is_enabled()
        .map_err(|e| super::AppError::new("autostart", e.to_string()))
}

#[tauri::command(rename_all = "snake_case")]
pub async fn set_autostart(app: AppHandle, enabled: bool) -> CmdResult<bool> {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    let done = if enabled { launcher.enable() } else { launcher.disable() };
    done.map_err(|e| super::AppError::new("autostart", e.to_string()))?;
    launcher
        .is_enabled()
        .map_err(|e| super::AppError::new("autostart", e.to_string()))
}
