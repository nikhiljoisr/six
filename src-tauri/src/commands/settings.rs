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
    db::save_setting(&state.pool, &key, value.trim(), chrono::Utc::now()).await?;
    super::publish(&app).await
}
