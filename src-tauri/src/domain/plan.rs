//! The day aggregate and the task state machine.
//!
//! ```text
//! planned ──activate──▶ active ──complete──▶ done
//!    ▲                   │  ▲
//!    │                   │  └──resume──── paused
//!    │                   ├──pause / take 5──▶ paused
//!    │                   ├──defer────────▶ deferred   (carries to tomorrow)
//!    │                   └──skip─────────▶ skipped    (dropped, logged)
//!    └──reopen (from done / deferred / skipped, same day only)
//! ```
//!
//! Invariants (checked by `Day::check_invariants` in tests, enforced by construction here):
//! at most six tasks; positions are 1..=n and unique; at most one task is active or
//! paused; at most one session is open and it belongs to the active task; sessions of a
//! task never overlap; `completed_at` is set iff status is `done`.

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::model::*;
use super::pomodoro::{Pomodoro, PomodoroOutcome, PomodoroPhase};
use super::timing::{self, IdleFlag};
use super::timing::idle_threshold;

/// Everything a transition needs from the outside world.
#[derive(Debug, Clone, Copy)]
pub struct Ctx<'a> {
    pub now: DateTime<Utc>,
    /// The current business date (already adjusted for the rollover hour).
    pub today: NaiveDate,
    pub device_id: &'a str,
}

impl<'a> Ctx<'a> {
    pub fn new(now: DateTime<Utc>, today: NaiveDate, device_id: &'a str) -> Self {
        Self {
            now,
            today,
            device_id,
        }
    }
}

pub fn new_id() -> String {
    Uuid::now_v7().to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DomainError {
    #[error("a list holds at most six tasks")]
    TooManyTasks,
    #[error("a list needs at least one task")]
    NoTasks,
    #[error("a task needs a title")]
    EmptyTitle,
    #[error("the same task appears twice")]
    DuplicateTask,
    #[error("task not found")]
    TaskNotFound,
    #[error("session not found")]
    SessionNotFound,
    #[error("cannot {action} a task that is {status}")]
    InvalidTransition {
        status: TaskStatus,
        action: &'static str,
    },
    #[error("an earlier task is unfinished; skipping ahead needs an override")]
    NeedsOverride,
    #[error("the list is not locked yet")]
    NotLocked,
    #[error("the list is already locked")]
    AlreadyLocked,
    #[error("that is only allowed on today's list")]
    NotToday,
    #[error("the review for this day is already recorded")]
    AlreadyReviewed,
    #[error("the trim must fall inside the session")]
    InvalidTrim,
    #[error("a pomodoro is already running")]
    PomodoroRunning,
    #[error("a pomodoro needs a positive length")]
    InvalidPomodoroLength,
}

impl DomainError {
    /// Stable machine-readable code for the frontend.
    pub fn code(&self) -> &'static str {
        match self {
            DomainError::TooManyTasks => "too_many_tasks",
            DomainError::NoTasks => "no_tasks",
            DomainError::EmptyTitle => "empty_title",
            DomainError::DuplicateTask => "duplicate_task",
            DomainError::TaskNotFound => "task_not_found",
            DomainError::SessionNotFound => "session_not_found",
            DomainError::InvalidTransition { .. } => "invalid_transition",
            DomainError::NeedsOverride => "needs_override",
            DomainError::NotLocked => "not_locked",
            DomainError::AlreadyLocked => "already_locked",
            DomainError::NotToday => "not_today",
            DomainError::AlreadyReviewed => "already_reviewed",
            DomainError::InvalidTrim => "invalid_trim",
            DomainError::PomodoroRunning => "pomodoro_running",
            DomainError::InvalidPomodoroLength => "invalid_pomodoro_length",
        }
    }
}

/// One row of the planner.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskInput {
    /// When editing, the id of an existing task to keep (status and sessions survive).
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub note: Option<String>,
    /// Lineage: the task on an earlier day this one was carried from.
    #[serde(default)]
    pub carried_from: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PauseReason {
    /// A plain pause.
    Paused,
    /// "Take 5": a short break with a "break over" nudge.
    Break,
}

impl From<PauseReason> for EndedReason {
    fn from(r: PauseReason) -> Self {
        match r {
            PauseReason::Paused => EndedReason::Paused,
            PauseReason::Break => EndedReason::Break,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Carry,
    Drop,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewDecision {
    pub task_id: String,
    pub decision: Decision,
}

/// One day's plan with its tasks and sessions: the unit of persistence and of change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Day {
    pub plan: Plan,
    /// Always sorted by position.
    pub tasks: Vec<Task>,
    /// Every session of every task on this plan.
    pub sessions: Vec<Session>,
    /// Every pomodoro of every task on this plan.
    pub pomodoros: Vec<Pomodoro>,
    /// Events produced since the last save; the store appends and clears them.
    pub pending_events: Vec<Event>,
}

fn clean_inputs(inputs: Vec<TaskInput>) -> Result<Vec<TaskInput>, DomainError> {
    if inputs.len() > MAX_TASKS {
        return Err(DomainError::TooManyTasks);
    }
    let mut cleaned = Vec::with_capacity(inputs.len());
    let mut seen_ids: Vec<String> = Vec::new();
    for mut input in inputs {
        input.title = input.title.trim().to_string();
        if input.title.is_empty() {
            return Err(DomainError::EmptyTitle);
        }
        input.note = input
            .note
            .map(|n| n.trim().to_string())
            .filter(|n| !n.is_empty());
        if let Some(id) = &input.id {
            if seen_ids.contains(id) {
                return Err(DomainError::DuplicateTask);
            }
            seen_ids.push(id.clone());
        }
        cleaned.push(input);
    }
    if cleaned.is_empty() {
        return Err(DomainError::NoTasks);
    }
    Ok(cleaned)
}

impl Day {
    /// Rebuild an aggregate from stored rows.
    pub fn from_rows(
        plan: Plan,
        mut tasks: Vec<Task>,
        sessions: Vec<Session>,
        pomodoros: Vec<Pomodoro>,
    ) -> Self {
        tasks.sort_by_key(|t| t.position);
        Self {
            plan,
            tasks,
            sessions,
            pomodoros,
            pending_events: Vec::new(),
        }
    }

    /// Start a new, unlocked list for `date`.
    pub fn draft(date: NaiveDate, inputs: Vec<TaskInput>, ctx: &Ctx) -> Result<Self, DomainError> {
        let cleaned = clean_inputs(inputs)?;
        let plan_id = new_id();
        let tasks = cleaned
            .into_iter()
            .enumerate()
            .map(|(i, input)| Task {
                id: new_id(),
                plan_id: plan_id.clone(),
                position: (i + 1) as u8,
                title: input.title,
                note: input.note,
                status: TaskStatus::Planned,
                carried_from: input.carried_from,
                completed_at: None,
                updated_at: ctx.now,
                device_id: ctx.device_id.to_string(),
            })
            .collect();
        Ok(Self {
            plan: Plan {
                id: plan_id,
                plan_date: date,
                locked_at: None,
                edited_after_lock: false,
                reviewed_at: None,
                reflection: None,
                updated_at: ctx.now,
                device_id: ctx.device_id.to_string(),
            },
            tasks,
            sessions: Vec::new(),
            pomodoros: Vec::new(),
            pending_events: Vec::new(),
        })
    }

    // ----- queries -------------------------------------------------------------------

    pub fn is_today(&self, ctx: &Ctx) -> bool {
        self.plan.plan_date == ctx.today
    }

    pub fn task(&self, task_id: &str) -> Option<&Task> {
        self.tasks.iter().find(|t| t.id == task_id)
    }

    /// The task holding the day's slot: active or paused.
    pub fn current_task(&self) -> Option<&Task> {
        self.tasks.iter().find(|t| t.status.is_current())
    }

    pub fn open_session(&self) -> Option<&Session> {
        self.sessions.iter().find(|s| s.is_open())
    }

    /// The task's most recently ended session (the break it is on, when paused).
    pub fn last_closed_session(&self, task_id: &str) -> Option<&Session> {
        self.sessions
            .iter()
            .filter(|s| s.task_id == task_id && s.ended_at.is_some())
            .max_by_key(|s| s.ended_at)
    }

    pub fn done_count(&self) -> usize {
        self.tasks
            .iter()
            .filter(|t| t.status == TaskStatus::Done)
            .count()
    }

    pub fn all_done(&self) -> bool {
        !self.tasks.is_empty() && self.tasks.iter().all(|t| t.status == TaskStatus::Done)
    }

    /// Tasks that roll into the next list: deferred ones always, unfinished ones too.
    /// Skipped and done tasks never carry. In position order.
    pub fn carryover(&self) -> Vec<&Task> {
        self.tasks
            .iter()
            .filter(|t| t.status.is_open() || t.status == TaskStatus::Deferred)
            .collect()
    }

    /// Planner rows pre-filled from this day's carryover, with lineage.
    pub fn carryover_inputs(&self) -> Vec<TaskInput> {
        self.carryover()
            .into_iter()
            .map(|t| TaskInput {
                id: None,
                title: t.title.clone(),
                note: t.note.clone(),
                carried_from: Some(t.id.clone()),
            })
            .collect()
    }

    pub fn focus_seconds(&self, task_id: &str, now: DateTime<Utc>) -> i64 {
        timing::focus_seconds(&self.sessions, task_id, now)
    }

    pub fn total_focus_seconds(&self, now: DateTime<Utc>) -> i64 {
        self.sessions
            .iter()
            .map(|s| timing::session_seconds(s, now))
            .sum()
    }

    pub fn idle_flags(&self, now: DateTime<Utc>) -> Vec<IdleFlag> {
        timing::idle_flags(&self.sessions, now)
    }

    // ----- plan-level transitions ------------------------------------------------------

    /// Lock the list. If it is today's list, task 1 becomes active.
    pub fn lock(&mut self, ctx: &Ctx) -> Result<(), DomainError> {
        if self.plan.is_locked() {
            return Err(DomainError::AlreadyLocked);
        }
        if self.tasks.is_empty() {
            return Err(DomainError::NoTasks);
        }
        self.plan.locked_at = Some(ctx.now);
        self.touch_plan(ctx);
        self.push_event(EventKind::Locked, None, ctx);
        self.ensure_active(ctx);
        Ok(())
    }

    /// Replace the rows of the list. Rows carrying an existing id keep that task (its
    /// status and sessions survive); rows without one become new planned tasks; tasks
    /// missing from the rows are removed. Editing a locked list is logged.
    pub fn edit(&mut self, inputs: Vec<TaskInput>, ctx: &Ctx) -> Result<(), DomainError> {
        let cleaned = clean_inputs(inputs)?;
        let mut new_tasks: Vec<Task> = Vec::with_capacity(cleaned.len());
        for (i, input) in cleaned.into_iter().enumerate() {
            let position = (i + 1) as u8;
            let existing = input.id.as_ref().and_then(|id| self.task(id)).cloned();
            match existing {
                Some(mut task) => {
                    let changed = task.position != position
                        || task.title != input.title
                        || task.note != input.note;
                    task.position = position;
                    task.title = input.title;
                    task.note = input.note;
                    if changed {
                        task.updated_at = ctx.now;
                    }
                    new_tasks.push(task);
                }
                None => new_tasks.push(Task {
                    id: new_id(),
                    plan_id: self.plan.id.clone(),
                    position,
                    title: input.title,
                    note: input.note,
                    status: TaskStatus::Planned,
                    carried_from: input.carried_from,
                    completed_at: None,
                    updated_at: ctx.now,
                    device_id: ctx.device_id.to_string(),
                }),
            }
        }
        let kept: Vec<String> = new_tasks.iter().map(|t| t.id.clone()).collect();
        let removed: Vec<String> = self
            .tasks
            .iter()
            .filter(|t| !kept.contains(&t.id))
            .map(|t| t.id.clone())
            .collect();
        for id in &removed {
            self.close_open_session(id, EndedReason::Superseded, ctx.now, ctx);
        }
        // Their rows go with them (the store cascades); drop them from the aggregate too.
        self.sessions.retain(|s| kept.contains(&s.task_id));
        self.pomodoros.retain(|s| kept.contains(&s.task_id));
        self.tasks = new_tasks;
        self.touch_plan(ctx);
        if self.plan.is_locked() {
            self.plan.edited_after_lock = true;
            self.push_event(EventKind::EditedAfterLock, None, ctx);
        }
        self.ensure_active(ctx);
        Ok(())
    }

    /// If this is today's locked list and nothing holds the slot, activate the first
    /// planned task. Returns the id of the task that was activated, if any.
    pub fn ensure_active(&mut self, ctx: &Ctx) -> Option<String> {
        if !self.plan.is_locked() || !self.is_today(ctx) {
            return None;
        }
        if self.current_task().is_some() {
            return None;
        }
        let idx = self
            .tasks
            .iter()
            .position(|t| t.status == TaskStatus::Planned)?;
        self.activate_at(idx, ctx);
        Some(self.tasks[idx].id.clone())
    }

    /// Close any open session on a plan whose day has ended. `day_end` is the UTC
    /// instant of the rollover; sessions end there (never before they started, never
    /// after now). Returns how many sessions were closed.
    pub fn apply_rollover(&mut self, day_end: DateTime<Utc>, ctx: &Ctx) -> usize {
        if self.plan.plan_date >= ctx.today {
            return 0;
        }
        let mut closed = 0;
        let mut ended: Vec<(String, DateTime<Utc>)> = Vec::new();
        for s in self.sessions.iter_mut().filter(|s| s.is_open()) {
            let end = day_end.max(s.started_at).min(ctx.now);
            s.ended_at = Some(end);
            s.ended_reason = Some(EndedReason::DayEnd);
            s.updated_at = ctx.now;
            ended.push((s.task_id.clone(), end));
            closed += 1;
        }
        for (task_id, end) in ended {
            self.end_pomodoros_for(&task_id, end, PomodoroOutcome::Interrupted, ctx);
        }
        closed
    }

    /// Record the evening review: decide each unfinished task (carry by default), then
    /// store the reflection.
    pub fn complete_review(
        &mut self,
        reflection: Option<String>,
        decisions: Vec<ReviewDecision>,
        ctx: &Ctx,
    ) -> Result<(), DomainError> {
        if self.plan.reviewed_at.is_some() {
            return Err(DomainError::AlreadyReviewed);
        }
        for d in &decisions {
            self.index_of(&d.task_id)?;
        }
        for idx in 0..self.tasks.len() {
            if !self.tasks[idx].status.is_open() {
                continue;
            }
            let id = self.tasks[idx].id.clone();
            let decision = decisions
                .iter()
                .find(|d| d.task_id == id)
                .map(|d| d.decision)
                .unwrap_or(Decision::Carry);
            match decision {
                Decision::Carry => self.finish_at(idx, TaskStatus::Deferred, ctx),
                Decision::Drop => self.finish_at(idx, TaskStatus::Skipped, ctx),
            }
        }
        self.plan.reviewed_at = Some(ctx.now);
        self.plan.reflection = reflection
            .map(|r| r.trim().to_string())
            .filter(|r| !r.is_empty());
        self.touch_plan(ctx);
        self.push_event(EventKind::Reviewed, None, ctx);
        Ok(())
    }

    /// Take a silence out of a session (the "likely idle" fix). The session ends where
    /// the silence began; whatever the user did after it continues as a session of its
    /// own, still running if the original was. A pomodoro that ran into the silence ends
    /// there, interrupted, even if it had already been counted as complete.
    pub fn trim_idle(
        &mut self,
        session_id: &str,
        gap_start: DateTime<Utc>,
        gap_end: DateTime<Utc>,
        ctx: &Ctx,
    ) -> Result<(), DomainError> {
        let idx = self
            .sessions
            .iter()
            .position(|s| s.id == session_id)
            .ok_or(DomainError::SessionNotFound)?;
        let original = self.sessions[idx].clone();
        let current_end = original.ended_at.unwrap_or(ctx.now);
        if gap_start < original.started_at || gap_end > current_end || gap_start >= gap_end {
            return Err(DomainError::InvalidTrim);
        }
        {
            let s = &mut self.sessions[idx];
            s.ended_at = Some(gap_start);
            s.ended_reason = Some(EndedReason::Trimmed);
            s.last_interaction_at = s.last_interaction_at.map(|t| t.min(gap_start));
            s.idle_from = None;
            s.idle_until = None;
            s.updated_at = ctx.now;
        }
        // A pomodoro that ran into the silence ends where it began. One that only started
        // inside it never happened: the user says they were not there.
        self.pomodoros.retain(|p| {
            !(p.task_id == original.task_id && p.started_at >= gap_start && p.started_at < gap_end)
        });
        for p in self.pomodoros.iter_mut().filter(|p| {
            p.task_id == original.task_id
                && p.started_at < gap_start
                && p.ended_at.is_none_or(|e| e > gap_start)
        }) {
            p.ended_at = Some(gap_start);
            p.outcome = Some(PomodoroOutcome::Interrupted);
            p.updated_at = ctx.now;
        }
        // What came after the silence is work of its own.
        if original.is_open() || gap_end < current_end {
            let remainder = Session {
                id: new_id(),
                task_id: original.task_id.clone(),
                started_at: gap_end,
                ended_at: original.ended_at,
                ended_reason: original.ended_reason,
                last_interaction_at: Some(
                    original
                        .last_interaction_at
                        .filter(|t| *t >= gap_end)
                        .unwrap_or(gap_end),
                ),
                idle_from: None,
                idle_until: None,
                device_id: ctx.device_id.to_string(),
                updated_at: ctx.now,
            };
            for p in self.pomodoros.iter_mut().filter(|p| {
                p.task_id == original.task_id
                    && p.started_at >= gap_end
                    && p.session_id.as_deref() == Some(session_id)
            }) {
                p.session_id = Some(remainder.id.clone());
            }
            self.sessions.push(remainder);
        }
        Ok(())
    }

    // ----- task transitions ------------------------------------------------------------

    /// Start working on a task. Skipping ahead of an unfinished earlier task needs
    /// `override_order` and is logged as an override. Whatever held the slot goes back
    /// to planned with its session closed as superseded.
    pub fn activate(
        &mut self,
        task_id: &str,
        override_order: bool,
        ctx: &Ctx,
    ) -> Result<(), DomainError> {
        if !self.plan.is_locked() {
            return Err(DomainError::NotLocked);
        }
        if !self.is_today(ctx) {
            return Err(DomainError::NotToday);
        }
        let idx = self.index_of(task_id)?;
        let status = self.tasks[idx].status;
        if status != TaskStatus::Planned {
            return Err(DomainError::InvalidTransition {
                status,
                action: "start",
            });
        }
        let position = self.tasks[idx].position;
        let earlier_unfinished = self
            .tasks
            .iter()
            .any(|t| t.position < position && t.status.is_open());
        if earlier_unfinished {
            if !override_order {
                return Err(DomainError::NeedsOverride);
            }
            self.push_event(EventKind::Overridden, Some(task_id), ctx);
        }
        self.activate_at(idx, ctx);
        Ok(())
    }

    /// Mark the current task done; the next planned task becomes active.
    pub fn complete(&mut self, task_id: &str, ctx: &Ctx) -> Result<(), DomainError> {
        let idx = self.index_of(task_id)?;
        let status = self.tasks[idx].status;
        if !status.is_current() {
            return Err(DomainError::InvalidTransition {
                status,
                action: "complete",
            });
        }
        self.close_open_session(task_id, EndedReason::Done, ctx.now, ctx);
        let t = &mut self.tasks[idx];
        t.status = TaskStatus::Done;
        t.completed_at = Some(ctx.now);
        t.updated_at = ctx.now;
        self.push_event(EventKind::Completed, Some(task_id), ctx);
        self.ensure_active(ctx);
        Ok(())
    }

    /// Pause the active task (a plain pause, or "Take 5").
    pub fn pause(
        &mut self,
        task_id: &str,
        reason: PauseReason,
        ctx: &Ctx,
    ) -> Result<(), DomainError> {
        let idx = self.index_of(task_id)?;
        let status = self.tasks[idx].status;
        if status != TaskStatus::Active {
            return Err(DomainError::InvalidTransition {
                status,
                action: "pause",
            });
        }
        self.close_open_session(task_id, reason.into(), ctx.now, ctx);
        let t = &mut self.tasks[idx];
        t.status = TaskStatus::Paused;
        t.updated_at = ctx.now;
        self.push_event(EventKind::Paused, Some(task_id), ctx);
        Ok(())
    }

    /// Resume a paused task: a new session starts.
    pub fn resume(&mut self, task_id: &str, ctx: &Ctx) -> Result<(), DomainError> {
        if !self.is_today(ctx) {
            return Err(DomainError::NotToday);
        }
        let idx = self.index_of(task_id)?;
        let status = self.tasks[idx].status;
        if status != TaskStatus::Paused {
            return Err(DomainError::InvalidTransition {
                status,
                action: "resume",
            });
        }
        let t = &mut self.tasks[idx];
        t.status = TaskStatus::Active;
        t.updated_at = ctx.now;
        self.start_session(task_id, ctx);
        self.push_event(EventKind::Resumed, Some(task_id), ctx);
        Ok(())
    }

    /// Push an unfinished task to tomorrow's list.
    pub fn defer(&mut self, task_id: &str, ctx: &Ctx) -> Result<(), DomainError> {
        let idx = self.index_of(task_id)?;
        let status = self.tasks[idx].status;
        if !status.is_open() {
            return Err(DomainError::InvalidTransition {
                status,
                action: "defer",
            });
        }
        self.finish_at(idx, TaskStatus::Deferred, ctx);
        self.ensure_active(ctx);
        Ok(())
    }

    /// Drop an unfinished task for good.
    pub fn skip(&mut self, task_id: &str, ctx: &Ctx) -> Result<(), DomainError> {
        let idx = self.index_of(task_id)?;
        let status = self.tasks[idx].status;
        if !status.is_open() {
            return Err(DomainError::InvalidTransition {
                status,
                action: "skip",
            });
        }
        self.finish_at(idx, TaskStatus::Skipped, ctx);
        self.ensure_active(ctx);
        Ok(())
    }

    /// Undo: put a finished task back on the list. Same day only.
    pub fn reopen(&mut self, task_id: &str, ctx: &Ctx) -> Result<(), DomainError> {
        if !self.is_today(ctx) {
            return Err(DomainError::NotToday);
        }
        let idx = self.index_of(task_id)?;
        let status = self.tasks[idx].status;
        if !status.is_terminal() {
            return Err(DomainError::InvalidTransition {
                status,
                action: "reopen",
            });
        }
        let t = &mut self.tasks[idx];
        t.status = TaskStatus::Planned;
        t.completed_at = None;
        t.updated_at = ctx.now;
        self.push_event(EventKind::Reopened, Some(task_id), ctx);
        self.ensure_active(ctx);
        Ok(())
    }

    pub fn set_note(
        &mut self,
        task_id: &str,
        note: Option<String>,
        ctx: &Ctx,
    ) -> Result<(), DomainError> {
        let idx = self.index_of(task_id)?;
        let t = &mut self.tasks[idx];
        t.note = note.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
        t.updated_at = ctx.now;
        Ok(())
    }

    /// The user did something: remember it on the running session for idle detection.
    /// Coming back after more than three hours of nothing records that silence on the
    /// session (the longest one is kept) rather than erasing the only evidence of it.
    pub fn touch(&mut self, ctx: &Ctx) -> bool {
        let Some(s) = self.sessions.iter_mut().find(|s| s.is_open()) else {
            return false;
        };
        let previous = s.last_interaction_at.unwrap_or(s.started_at);
        let silence = ctx.now - previous;
        if silence > idle_threshold() {
            let kept = s
                .idle_gap()
                .map(|(a, b)| b - a)
                .unwrap_or_else(Duration::zero);
            if silence > kept {
                s.idle_from = Some(previous);
                s.idle_until = Some(ctx.now);
            }
        }
        s.last_interaction_at = Some(ctx.now);
        s.updated_at = ctx.now;
        true
    }

    // ----- internals ---------------------------------------------------------------

    // ----- pomodoro ---------------------------------------------------------------------

    /// The running pomodoro, if any (at most one per day).
    pub fn open_pomodoro(&self) -> Option<&Pomodoro> {
        self.pomodoros.iter().find(|p| p.is_open())
    }

    /// Start a pomodoro on the active task. Rings that are due are settled first; a
    /// pomodoro still running refuses a second one. Starting the next answers any ring.
    pub fn start_pomodoro(
        &mut self,
        task_id: &str,
        planned_seconds: i64,
        ctx: &Ctx,
    ) -> Result<(), DomainError> {
        if planned_seconds <= 0 {
            return Err(DomainError::InvalidPomodoroLength);
        }
        let idx = self.index_of(task_id)?;
        let status = self.tasks[idx].status;
        if status != TaskStatus::Active {
            return Err(DomainError::InvalidTransition {
                status,
                action: "start a pomodoro",
            });
        }
        self.settle_pomodoros(ctx);
        if self.open_pomodoro().is_some() {
            return Err(DomainError::PomodoroRunning);
        }
        self.acknowledge_pomodoro(task_id, ctx)?;
        let session_id = self.open_session().map(|s| s.id.clone());
        self.pomodoros.push(Pomodoro {
            id: new_id(),
            task_id: task_id.to_string(),
            session_id,
            started_at: ctx.now,
            planned_seconds,
            ended_at: None,
            outcome: None,
            acknowledged_at: None,
            device_id: ctx.device_id.to_string(),
            updated_at: ctx.now,
        });
        Ok(())
    }

    /// Close every running pomodoro whose planned end has passed, exactly at that end.
    /// Returns whether anything rang. Called on every read, like the rollover.
    pub fn settle_pomodoros(&mut self, ctx: &Ctx) -> bool {
        let mut rang = false;
        for p in self.pomodoros.iter_mut().filter(|p| p.is_open()) {
            let end = p.planned_end();
            if end <= ctx.now {
                p.ended_at = Some(end);
                p.outcome = Some(PomodoroOutcome::Completed);
                p.updated_at = ctx.now;
                rang = true;
            }
        }
        rang
    }

    /// "Keep going": answer the ring without a break or another pomodoro.
    pub fn acknowledge_pomodoro(&mut self, task_id: &str, ctx: &Ctx) -> Result<(), DomainError> {
        self.index_of(task_id)?;
        self.settle_pomodoros(ctx);
        for p in self
            .pomodoros
            .iter_mut()
            .filter(|p| p.task_id == task_id && p.is_awaiting_ack())
        {
            p.acknowledged_at = Some(ctx.now);
            p.updated_at = ctx.now;
        }
        Ok(())
    }

    /// The next break should be the long one: the last completed pomodoro finished a set
    /// of `set`, and no break has been taken since it ended (`except` names the break
    /// being planned, which does not count against itself).
    pub fn long_break_due(&self, set: usize, except: Option<&str>) -> bool {
        let set = set.max(1);
        let completed = self.pomodoros_completed(None);
        if completed == 0 || completed % set != 0 {
            return false;
        }
        let Some(last_end) = self
            .pomodoros
            .iter()
            .filter(|p| p.outcome == Some(PomodoroOutcome::Completed))
            .filter_map(|p| p.ended_at)
            .max()
        else {
            return false;
        };
        !self.sessions.iter().any(|s| {
            except != Some(s.id.as_str())
                && s.ended_reason == Some(EndedReason::Break)
                && s.ended_at.is_some_and(|e| e >= last_end)
        })
    }

    /// Completed pomodoros, for one task or the whole day.
    pub fn pomodoros_completed(&self, task_id: Option<&str>) -> usize {
        self.pomodoros
            .iter()
            .filter(|p| p.outcome == Some(PomodoroOutcome::Completed))
            .filter(|p| task_id.is_none_or(|id| p.task_id == id))
            .count()
    }

    /// The pomodoro phase of the active task at `now`, and the pomodoro it refers to.
    pub fn pomodoro_state(&self, now: DateTime<Utc>) -> (PomodoroPhase, Option<&Pomodoro>) {
        let Some(task) = self.current_task() else {
            return (PomodoroPhase::Idle, None);
        };
        if task.status != TaskStatus::Active {
            return (PomodoroPhase::Idle, None);
        }
        if let Some(p) = self
            .pomodoros
            .iter()
            .find(|p| p.is_open() && p.task_id == task.id)
        {
            let phase = if p.planned_end() > now {
                PomodoroPhase::Running
            } else {
                PomodoroPhase::Done
            };
            return (phase, Some(p));
        }
        match self.pomodoros.iter().rev().find(|p| p.task_id == task.id) {
            Some(p) if p.is_awaiting_ack() => (PomodoroPhase::Done, Some(p)),
            _ => (PomodoroPhase::Idle, None),
        }
    }

    /// End the task's running pomodoro at `at`: completed if the planned end had passed
    /// (at that end), otherwise with `outcome`. A rung pomodoro counts as answered by
    /// the transition.
    fn end_pomodoros_for(
        &mut self,
        task_id: &str,
        at: DateTime<Utc>,
        outcome: PomodoroOutcome,
        ctx: &Ctx,
    ) {
        for p in self
            .pomodoros
            .iter_mut()
            .filter(|p| p.task_id == task_id && p.is_open())
        {
            let planned_end = p.planned_end();
            if planned_end <= at {
                p.ended_at = Some(planned_end);
                p.outcome = Some(PomodoroOutcome::Completed);
            } else {
                p.ended_at = Some(at.max(p.started_at));
                p.outcome = Some(outcome);
            }
            p.updated_at = ctx.now;
        }
        for p in self
            .pomodoros
            .iter_mut()
            .filter(|p| p.task_id == task_id && p.is_awaiting_ack())
        {
            p.acknowledged_at = Some(at);
            p.updated_at = ctx.now;
        }
    }

    fn index_of(&self, task_id: &str) -> Result<usize, DomainError> {
        self.tasks
            .iter()
            .position(|t| t.id == task_id)
            .ok_or(DomainError::TaskNotFound)
    }

    fn touch_plan(&mut self, ctx: &Ctx) {
        self.plan.updated_at = ctx.now;
    }

    fn push_event(&mut self, kind: EventKind, task_id: Option<&str>, ctx: &Ctx) {
        self.pending_events.push(Event {
            id: new_id(),
            task_id: task_id.map(str::to_string),
            plan_id: Some(self.plan.id.clone()),
            kind,
            occurred_at: ctx.now,
            device_id: ctx.device_id.to_string(),
        });
    }

    fn start_session(&mut self, task_id: &str, ctx: &Ctx) {
        debug_assert!(self.open_session().is_none(), "sessions never overlap");
        self.sessions.push(Session {
            id: new_id(),
            task_id: task_id.to_string(),
            started_at: ctx.now,
            ended_at: None,
            ended_reason: None,
            last_interaction_at: Some(ctx.now),
            idle_from: None,
            idle_until: None,
            device_id: ctx.device_id.to_string(),
            updated_at: ctx.now,
        });
    }

    fn close_open_session(
        &mut self,
        task_id: &str,
        reason: EndedReason,
        at: DateTime<Utc>,
        ctx: &Ctx,
    ) -> bool {
        let closed = match self
            .sessions
            .iter_mut()
            .find(|s| s.task_id == task_id && s.is_open())
        {
            Some(s) => {
                s.ended_at = Some(at.max(s.started_at));
                s.ended_reason = Some(reason);
                s.updated_at = ctx.now;
                true
            }
            None => false,
        };
        // Leaving the active slot ends any pomodoro on the task: finished early if the
        // task is done, interrupted otherwise (unless it had already rung).
        let outcome = match reason {
            EndedReason::Done => PomodoroOutcome::FinishedEarly,
            _ => PomodoroOutcome::Interrupted,
        };
        self.end_pomodoros_for(task_id, at, outcome, ctx);
        closed
    }

    /// Whatever holds the slot goes back to planned; its running session is superseded.
    fn vacate_slot(&mut self, ctx: &Ctx) {
        let holders: Vec<String> = self
            .tasks
            .iter()
            .filter(|t| t.status.is_current())
            .map(|t| t.id.clone())
            .collect();
        for id in holders {
            self.close_open_session(&id, EndedReason::Superseded, ctx.now, ctx);
            let t = self
                .tasks
                .iter_mut()
                .find(|t| t.id == id)
                .expect("holder exists");
            t.status = TaskStatus::Planned;
            t.updated_at = ctx.now;
        }
    }

    fn activate_at(&mut self, idx: usize, ctx: &Ctx) {
        self.vacate_slot(ctx);
        let id = self.tasks[idx].id.clone();
        let t = &mut self.tasks[idx];
        t.status = TaskStatus::Active;
        t.completed_at = None;
        t.updated_at = ctx.now;
        self.start_session(&id, ctx);
        self.push_event(EventKind::Activated, Some(&id), ctx);
    }

    /// Move an open task to deferred or skipped, closing its session and logging it.
    fn finish_at(&mut self, idx: usize, status: TaskStatus, ctx: &Ctx) {
        let id = self.tasks[idx].id.clone();
        let (reason, kind) = match status {
            TaskStatus::Deferred => (EndedReason::Deferred, EventKind::Deferred),
            TaskStatus::Skipped => (EndedReason::Skipped, EventKind::Skipped),
            other => unreachable!("finish_at only handles deferred/skipped, got {other}"),
        };
        self.close_open_session(&id, reason, ctx.now, ctx);
        let t = &mut self.tasks[idx];
        t.status = status;
        t.completed_at = None;
        t.updated_at = ctx.now;
        self.push_event(kind, Some(&id), ctx);
    }

    /// Verify every invariant. Used by tests after each transition.
    pub fn check_invariants(&self) -> Result<(), String> {
        if self.tasks.len() > MAX_TASKS {
            return Err(format!("{} tasks; six is the ceiling", self.tasks.len()));
        }
        for (i, t) in self.tasks.iter().enumerate() {
            if usize::from(t.position) != i + 1 {
                return Err(format!("position {} at index {i}", t.position));
            }
            if t.plan_id != self.plan.id {
                return Err(format!("task {} belongs to another plan", t.id));
            }
            if (t.status == TaskStatus::Done) != t.completed_at.is_some() {
                return Err(format!(
                    "task {} completed_at disagrees with status {}",
                    t.id, t.status
                ));
            }
        }
        let current = self.tasks.iter().filter(|t| t.status.is_current()).count();
        if current > 1 {
            return Err(format!("{current} tasks hold the slot"));
        }
        let open: Vec<&Session> = self.sessions.iter().filter(|s| s.is_open()).collect();
        if open.len() > 1 {
            return Err(format!("{} open sessions", open.len()));
        }
        if let Some(s) = open.first() {
            match self.task(&s.task_id) {
                Some(t) if t.status == TaskStatus::Active => {}
                Some(t) => return Err(format!("open session on {} task", t.status)),
                None => return Err("open session on unknown task".into()),
            }
        }
        for s in &self.sessions {
            if self.task(&s.task_id).is_none() {
                return Err(format!("session {} on unknown task", s.id));
            }
            if let Some(end) = s.ended_at {
                if end < s.started_at {
                    return Err(format!("session {} ends before it starts", s.id));
                }
                if s.ended_reason.is_none() {
                    return Err(format!("session {} closed without a reason", s.id));
                }
            }
            for other in &self.sessions {
                if other.id == s.id || other.task_id != s.task_id {
                    continue;
                }
                let s_end = s.ended_at.unwrap_or(DateTime::<Utc>::MAX_UTC);
                let o_end = other.ended_at.unwrap_or(DateTime::<Utc>::MAX_UTC);
                if s.started_at < o_end && other.started_at < s_end {
                    return Err(format!("sessions {} and {} overlap", s.id, other.id));
                }
            }
        }
        let open_pomodoros: Vec<&Pomodoro> =
            self.pomodoros.iter().filter(|p| p.is_open()).collect();
        if open_pomodoros.len() > 1 {
            return Err(format!(
                "{} pomodoros running at once",
                open_pomodoros.len()
            ));
        }
        for p in &self.pomodoros {
            if !self.tasks.iter().any(|t| t.id == p.task_id) {
                return Err(format!("pomodoro {} belongs to no task on this plan", p.id));
            }
            if p.is_open() != p.outcome.is_none() {
                return Err(format!("pomodoro {} outcome disagrees with ended_at", p.id));
            }
            if let Some(end) = p.ended_at {
                if end < p.started_at {
                    return Err(format!("pomodoro {} ends before it starts", p.id));
                }
            }
        }
        if let Some(p) = open_pomodoros.first() {
            let task = self.tasks.iter().find(|t| t.id == p.task_id);
            if task.map(|t| t.status) != Some(TaskStatus::Active) {
                return Err(format!(
                    "pomodoro {} runs on a task that is not active",
                    p.id
                ));
            }
        }
        Ok(())
    }
}
