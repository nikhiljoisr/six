use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::{
    mutate_by_plan, mutate_by_session, parse_ts, read_clock, AppError, AppState, CmdResult,
    DaySnapshot, PlanView,
};
use crate::db;
use crate::domain::timing::IdleFlag;
use crate::domain::{EventKind, ReviewDecision, TaskStatus};

/// Everything the three review panels need.
#[derive(Debug, Clone, Serialize)]
pub struct ReviewView {
    pub plan: PlanView,
    /// Top three (or all, if fewer) done.
    pub top_three_done: bool,
    pub overrides: usize,
    pub idle_flags: Vec<IdleFlag>,
    /// Ids of tasks still unfinished: the ones panel 2 asks about.
    pub unfinished: Vec<String>,
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_review(app: AppHandle, plan_id: String) -> CmdResult<ReviewView> {
    let state = app.state::<AppState>();
    let (settings, clock) = read_clock(&state).await?;
    super::housekeeping(&state, &settings, &clock).await?;
    let day = db::load_day_by_plan(&state.pool, &plan_id)
        .await?
        .ok_or_else(|| AppError::new("plan_not_found", "list not found"))?;
    let events = db::events_for_plan(&state.pool, &plan_id).await?;
    let top = day
        .tasks
        .iter()
        .filter(|t| t.position <= 3)
        .collect::<Vec<_>>();
    Ok(ReviewView {
        plan: PlanView::from_day(&day, clock.now, clock.today),
        top_three_done: !top.is_empty() && top.iter().all(|t| t.status == TaskStatus::Done),
        overrides: events
            .iter()
            .filter(|e| e.kind == EventKind::Overridden)
            .count(),
        idle_flags: day.idle_flags(clock.now),
        unfinished: day
            .tasks
            .iter()
            .filter(|t| t.status.is_open())
            .map(|t| t.id.clone())
            .collect(),
    })
}

/// Cut a likely-idle session at `ended_at` (RFC 3339).
#[tauri::command(rename_all = "snake_case")]
pub async fn trim_session(
    app: AppHandle,
    session_id: String,
    ended_at: String,
) -> CmdResult<DaySnapshot> {
    let at = parse_ts(&ended_at)?;
    mutate_by_session(&app, &session_id, |day, ctx| {
        day.trim_session(&session_id, at, ctx)
    })
    .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn complete_review(
    app: AppHandle,
    plan_id: String,
    reflection: Option<String>,
    decisions: Option<Vec<ReviewDecision>>,
) -> CmdResult<DaySnapshot> {
    let decisions = decisions.unwrap_or_default();
    mutate_by_plan(&app, &plan_id, |day, ctx| {
        day.complete_review(reflection, decisions, ctx)
    })
    .await
}
