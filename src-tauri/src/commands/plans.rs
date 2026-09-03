use tauri::{AppHandle, Manager};

use super::snapshot::{self, CarryoverPreview, DaySnapshot, PlanView};
use super::{mutate_by_plan, parse_date, read_clock, AppError, AppState, CmdResult};
use crate::db;
use crate::domain::{Day, TaskInput};

/// The full day snapshot (also what `state_changed` carries).
#[tauri::command(rename_all = "snake_case")]
pub async fn get_snapshot(app: AppHandle) -> CmdResult<DaySnapshot> {
    let state = app.state::<AppState>();
    snapshot::build(&state).await
}

/// One day's list, if any.
#[tauri::command(rename_all = "snake_case")]
pub async fn get_day(app: AppHandle, date: String) -> CmdResult<Option<PlanView>> {
    let state = app.state::<AppState>();
    let date = parse_date(&date)?;
    let (_, clock) = read_clock(&state).await?;
    Ok(db::load_day(&state.pool, date)
        .await?
        .map(|d| PlanView::from_day(&d, clock.now, clock.today)))
}

/// Lists dated `from..=to`, newest first.
#[tauri::command(rename_all = "snake_case")]
pub async fn get_range(app: AppHandle, from: String, to: String) -> CmdResult<Vec<PlanView>> {
    let state = app.state::<AppState>();
    let (from, to) = (parse_date(&from)?, parse_date(&to)?);
    let (_, clock) = read_clock(&state).await?;
    Ok(db::load_days(&state.pool, from, to)
        .await?
        .iter()
        .map(|d| PlanView::from_day(d, clock.now, clock.today))
        .collect())
}

/// Rows that would pre-fill the planner for `date`.
#[tauri::command(rename_all = "snake_case")]
pub async fn get_carryover(app: AppHandle, date: String) -> CmdResult<Option<CarryoverPreview>> {
    let state = app.state::<AppState>();
    snapshot::carryover_for(&state, parse_date(&date)?).await
}

/// Save the planner's rows for today or tomorrow. Creates the list, or replaces the rows
/// of an existing one (which counts as an edit if it was locked).
#[tauri::command(rename_all = "snake_case")]
pub async fn draft_plan(
    app: AppHandle,
    date: String,
    tasks: Vec<TaskInput>,
) -> CmdResult<DaySnapshot> {
    let state = app.state::<AppState>();
    let date = parse_date(&date)?;
    let (settings, clock) = read_clock(&state).await?;
    if date != clock.today && date != clock.tomorrow() {
        return Err(AppError::new(
            "not_plannable",
            "only today or tomorrow can be planned",
        ));
    }
    super::housekeeping(&state, &settings, &clock).await?;
    let ctx = clock.ctx(&state.device_id);
    let mut day = match db::load_day(&state.pool, date).await? {
        Some(mut existing) => {
            existing.edit(tasks, &ctx)?;
            existing
        }
        None => Day::draft(date, tasks, &ctx)?,
    };
    db::save_day(&state.pool, &mut day).await?;
    super::publish(&app).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn lock_plan(app: AppHandle, plan_id: String) -> CmdResult<DaySnapshot> {
    mutate_by_plan(&app, &plan_id, |day, ctx| day.lock(ctx)).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn edit_plan(
    app: AppHandle,
    plan_id: String,
    tasks: Vec<TaskInput>,
) -> CmdResult<DaySnapshot> {
    mutate_by_plan(&app, &plan_id, |day, ctx| day.edit(tasks, ctx)).await
}
