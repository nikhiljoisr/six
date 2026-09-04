use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::{mutate_by_task, read_clock, AppError, AppState, CmdResult, DaySnapshot};
use crate::db;
use crate::domain::PomodoroPhase;
use crate::domain::{PauseReason, TaskStatus};

/// Focus time of today's current task, measured from its session timestamps.
#[derive(Debug, Clone, Serialize)]
pub struct Elapsed {
    pub task_id: String,
    pub status: TaskStatus,
    pub focus_seconds: i64,
    /// The pomodoro layer for this task right now.
    pub pomodoro: PomodoroPhase,
    pub pomodoro_remaining: i64,
}

/// Polled by the active card once a second while the window is focused. A cheap read
/// with one duty: if a pomodoro has just rung, settle it and broadcast the change.
/// Returns `None` when nothing holds today's slot.
#[tauri::command(rename_all = "snake_case")]
pub async fn get_elapsed(app: AppHandle) -> CmdResult<Option<Elapsed>> {
    crate::scheduler::deliver_now(&app).await;
    let state = app.state::<AppState>();
    let (day, clock) = {
        let _gate = state.gate.lock().await;
        let (_, clock) = read_clock(&state).await?;
        let Some(mut day) = db::load_day(&state.pool, clock.today).await? else {
            return Ok(None);
        };
        if day.settle_pomodoros(&clock.ctx(&state.device_id)) {
            db::save_day(&state.pool, &mut day).await?;
            super::publish(&app).await?;
        }
        (day, clock)
    };
    let (phase, pomodoro) = day.pomodoro_state(clock.now);
    Ok(day.current_task().map(|t| Elapsed {
        task_id: t.id.clone(),
        status: t.status,
        focus_seconds: day.focus_seconds(&t.id, clock.now),
        pomodoro: phase,
        pomodoro_remaining: pomodoro
            .map(|p| p.remaining_seconds(clock.now))
            .unwrap_or(0),
    }))
}

/// Start a pomodoro on the active task (length from Settings). Refused when the layer
/// is switched off.
#[tauri::command(rename_all = "snake_case")]
pub async fn start_pomodoro(app: AppHandle, task_id: String) -> CmdResult<DaySnapshot> {
    let settings = {
        let state = app.state::<AppState>();
        db::load_settings(&state.pool).await?
    };
    if !settings.pomodoro_enabled {
        return Err(AppError::new(
            "pomodoro_off",
            "Pomodoro is switched off in Settings",
        ));
    }
    let seconds = i64::from(settings.pomodoro_minutes) * 60;
    mutate_by_task(&app, &task_id, |day, ctx| {
        day.start_pomodoro(&task_id, seconds, ctx)
    })
    .await
}

/// "Keep going": answer the ring without a break or another pomodoro.
#[tauri::command(rename_all = "snake_case")]
pub async fn acknowledge_pomodoro(app: AppHandle, task_id: String) -> CmdResult<DaySnapshot> {
    mutate_by_task(&app, &task_id, |day, ctx| {
        day.acknowledge_pomodoro(&task_id, ctx)
    })
    .await
}

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
    let _gate = state.gate.lock().await;
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
