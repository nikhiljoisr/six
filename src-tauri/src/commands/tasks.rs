use tauri::{AppHandle, Manager};

use super::{mutate_by_task, read_clock, AppState, CmdResult, DaySnapshot};
use crate::db;
use crate::domain::PauseReason;

/// Start a task. `override_order` confirms skipping ahead of an unfinished earlier task;
/// without it the command fails with code `needs_override` so the UI can ask.
#[tauri::command(rename_all = "snake_case")]
pub async fn activate(
    app: AppHandle,
    task_id: String,
    override_order: Option<bool>,
) -> CmdResult<DaySnapshot> {
    let force = override_order.unwrap_or(false);
    mutate_by_task(&app, &task_id, |day, ctx| {
        day.activate(&task_id, force, ctx)
    })
    .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn complete(app: AppHandle, task_id: String) -> CmdResult<DaySnapshot> {
    mutate_by_task(&app, &task_id, |day, ctx| day.complete(&task_id, ctx)).await
}

/// Pause the active task. `reason` is `"break"` for Take 5, `"paused"` otherwise.
#[tauri::command(rename_all = "snake_case")]
pub async fn pause(
    app: AppHandle,
    task_id: String,
    reason: Option<PauseReason>,
) -> CmdResult<DaySnapshot> {
    let reason = reason.unwrap_or(PauseReason::Paused);
    mutate_by_task(&app, &task_id, |day, ctx| day.pause(&task_id, reason, ctx)).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn resume(app: AppHandle, task_id: String) -> CmdResult<DaySnapshot> {
    mutate_by_task(&app, &task_id, |day, ctx| day.resume(&task_id, ctx)).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn defer(app: AppHandle, task_id: String) -> CmdResult<DaySnapshot> {
    mutate_by_task(&app, &task_id, |day, ctx| day.defer(&task_id, ctx)).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn skip(app: AppHandle, task_id: String) -> CmdResult<DaySnapshot> {
    mutate_by_task(&app, &task_id, |day, ctx| day.skip(&task_id, ctx)).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn reopen(app: AppHandle, task_id: String) -> CmdResult<DaySnapshot> {
    mutate_by_task(&app, &task_id, |day, ctx| day.reopen(&task_id, ctx)).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn set_note(
    app: AppHandle,
    task_id: String,
    note: Option<String>,
) -> CmdResult<DaySnapshot> {
    mutate_by_task(&app, &task_id, |day, ctx| day.set_note(&task_id, note, ctx)).await
}

/// The user interacted with the app: stamp the running session for idle detection.
/// Quiet on purpose: no snapshot is broadcast.
#[tauri::command(rename_all = "snake_case")]
pub async fn touch(app: AppHandle) -> CmdResult<bool> {
    let state = app.state::<AppState>();
    let (_, clock) = read_clock(&state).await?;
    let Some(mut day) = db::load_day(&state.pool, clock.today).await? else {
        return Ok(false);
    };
    let ctx = clock.ctx(&state.device_id);
    if day.touch(&ctx) {
        db::save_day(&state.pool, &mut day).await?;
        return Ok(true);
    }
    Ok(false)
}
