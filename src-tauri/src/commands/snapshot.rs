//! The read model. The frontend renders this and nothing else.

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::Serialize;

use super::{housekeeping, read_clock, AppState, CmdResult};
use crate::db;
use crate::domain::{streak, Day, Settings, TaskInput, TaskStatus};

#[derive(Debug, Clone, Serialize)]
pub struct TaskView {
    pub id: String,
    pub position: u8,
    pub title: String,
    pub note: Option<String>,
    pub status: TaskStatus,
    pub carried_from: Option<String>,
    pub completed_at: Option<DateTime<Utc>>,
    /// Recorded focus time, including the running session up to `now`.
    pub focus_seconds: i64,
    /// Start of the running session, if this task is active.
    pub session_started_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlanView {
    pub id: String,
    pub date: NaiveDate,
    pub locked_at: Option<DateTime<Utc>>,
    pub edited_after_lock: bool,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub reflection: Option<String>,
    pub is_today: bool,
    pub task_count: usize,
    pub done_count: usize,
    pub all_done: bool,
    pub total_focus_seconds: i64,
    pub tasks: Vec<TaskView>,
}

impl PlanView {
    pub fn from_day(day: &Day, now: DateTime<Utc>, today: NaiveDate) -> Self {
        let open = day.open_session();
        let tasks = day
            .tasks
            .iter()
            .map(|t| TaskView {
                id: t.id.clone(),
                position: t.position,
                title: t.title.clone(),
                note: t.note.clone(),
                status: t.status,
                carried_from: t.carried_from.clone(),
                completed_at: t.completed_at,
                focus_seconds: day.focus_seconds(&t.id, now),
                session_started_at: open.filter(|s| s.task_id == t.id).map(|s| s.started_at),
            })
            .collect();
        Self {
            id: day.plan.id.clone(),
            date: day.plan.plan_date,
            locked_at: day.plan.locked_at,
            edited_after_lock: day.plan.edited_after_lock,
            reviewed_at: day.plan.reviewed_at,
            reflection: day.plan.reflection.clone(),
            is_today: day.plan.plan_date == today,
            task_count: day.tasks.len(),
            done_count: day.done_count(),
            all_done: day.all_done(),
            total_focus_seconds: day.total_focus_seconds(now),
            tasks,
        }
    }
}

/// Rows that will pre-fill the next list, and the day they come from.
#[derive(Debug, Clone, Serialize)]
pub struct CarryoverPreview {
    pub from_date: NaiveDate,
    pub tasks: Vec<TaskInput>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    BeforeEvening,
    AfterEvening,
}

#[derive(Debug, Clone, Serialize)]
pub struct DaySnapshot {
    pub today: NaiveDate,
    pub tomorrow: NaiveDate,
    pub now: DateTime<Utc>,
    pub phase: Phase,
    pub settings: Settings,
    pub streak: u32,
    pub today_plan: Option<PlanView>,
    pub tomorrow_plan: Option<PlanView>,
    /// What would roll into the next unplanned list (today's if unplanned, else tomorrow's).
    pub carryover_preview: Option<CarryoverPreview>,
}

/// Carryover for a list dated `date`: the most recent locked list before it.
pub async fn carryover_for(
    state: &AppState,
    date: NaiveDate,
) -> CmdResult<Option<CarryoverPreview>> {
    let Some(from_date) = db::latest_locked_date_before(&state.pool, date).await? else {
        return Ok(None);
    };
    let Some(day) = db::load_day(&state.pool, from_date).await? else {
        return Ok(None);
    };
    let tasks = day.carryover_inputs();
    if tasks.is_empty() {
        return Ok(None);
    }
    Ok(Some(CarryoverPreview { from_date, tasks }))
}

pub async fn build(state: &AppState) -> CmdResult<DaySnapshot> {
    let (settings, clock) = read_clock(state).await?;
    housekeeping(state, &settings, &clock).await?;
    let today = clock.today;
    let tomorrow = clock.tomorrow();

    let today_day = db::load_day(&state.pool, today).await?;
    let tomorrow_day = db::load_day(&state.pool, tomorrow).await?;
    let locked = db::locked_dates(&state.pool, today - Duration::days(400), tomorrow).await?;

    let today_planned = today_day.as_ref().is_some_and(|d| d.plan.is_locked());
    let tomorrow_planned = tomorrow_day.as_ref().is_some_and(|d| d.plan.is_locked());
    let carryover_preview = if !today_planned {
        carryover_for(state, today).await?
    } else if !tomorrow_planned {
        carryover_for(state, tomorrow).await?
    } else {
        None
    };

    Ok(DaySnapshot {
        today,
        tomorrow,
        now: clock.now,
        phase: if clock.after_evening(&settings) {
            Phase::AfterEvening
        } else {
            Phase::BeforeEvening
        },
        streak: streak::streak(&locked, today),
        settings,
        today_plan: today_day
            .as_ref()
            .map(|d| PlanView::from_day(d, clock.now, today)),
        tomorrow_plan: tomorrow_day
            .as_ref()
            .map(|d| PlanView::from_day(d, clock.now, today)),
        carryover_preview,
    })
}
