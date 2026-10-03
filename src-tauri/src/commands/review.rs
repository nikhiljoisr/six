use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::snapshot::JotView;
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
    /// No later list has been locked, so what carries from this day is what the next
    /// planner will pre-fill. False once a later list exists: it already took them.
    pub is_latest_list: bool,
    /// Thoughts parked during the day, read back here.
    pub jots: Vec<JotView>,
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_review(app: AppHandle, plan_id: String) -> CmdResult<ReviewView> {
    let state = app.state::<AppState>();
    let (day, clock) = {
        let _gate = state.gate.lock().await;
        let (settings, clock) = read_clock(&state).await?;
        super::housekeeping(&state, &settings, &clock).await?;
        let day = db::load_day_by_plan(&state.pool, &plan_id)
            .await?
            .ok_or_else(|| AppError::new("plan_not_found", "list not found"))?;
        (day, clock)
    };
    let events = db::events_for_plan(&state.pool, &plan_id).await?;
    let is_latest_list = db::latest_locked_date(&state.pool).await? == Some(day.plan.plan_date);
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
        is_latest_list,
        jots: JotView::from_day(&day),
    })
}

/// The user looked at a silence and kept the time as recorded: do not offer it again.
#[tauri::command(rename_all = "snake_case")]
pub async fn keep_gap(app: AppHandle, session_id: String) -> CmdResult<DaySnapshot> {
    mutate_by_session(&app, &session_id, |day, ctx| day.keep_gap(&session_id, ctx)).await
}

/// Take a silence out of a session: the bounds (RFC 3339) come from the review's flag.
#[tauri::command(rename_all = "snake_case")]
pub async fn trim_session(
    app: AppHandle,
    session_id: String,
    gap_start: String,
    gap_end: String,
) -> CmdResult<DaySnapshot> {
    let (from, to) = (parse_ts(&gap_start)?, parse_ts(&gap_end)?);
    mutate_by_session(&app, &session_id, |day, ctx| {
        day.trim_idle(&session_id, from, to, ctx)
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
