//! Tauri commands: thin adapters between the frontend and the domain. Every mutation
//! loads a `Day`, applies one transition, saves it, then broadcasts a fresh snapshot on
//! the `state_changed` event.

pub mod plans;
pub mod review;
pub mod settings;
pub mod snapshot;
pub mod stats;
pub mod tasks;

use chrono::{
    DateTime, Duration, Local, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Timelike, Utc,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::{self, DbError, Pool};
use crate::domain::{day as day_bounds, Ctx, Day, DomainError, Settings, SettingsError};

pub use snapshot::{DaySnapshot, PlanView};

pub const STATE_CHANGED: &str = "state_changed";

pub struct AppState {
    pub pool: Pool,
    pub device_id: String,
}

/// What the frontend receives when a command fails. `code` is stable; `message` is for
/// display.
#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
}

impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }
}

impl From<DomainError> for AppError {
    fn from(e: DomainError) -> Self {
        Self::new(e.code(), e.to_string())
    }
}

impl From<DbError> for AppError {
    fn from(e: DbError) -> Self {
        Self::new("db", e.to_string())
    }
}

impl From<SettingsError> for AppError {
    fn from(e: SettingsError) -> Self {
        Self::new("settings", e.to_string())
    }
}

pub type CmdResult<T> = Result<T, AppError>;

pub fn parse_date(s: &str) -> CmdResult<NaiveDate> {
    NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::new("bad_date", format!("not a date: {s:?}")))
}

pub fn parse_ts(s: &str) -> CmdResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s.trim())
        .map(|d| d.with_timezone(&Utc))
        .map_err(|_| AppError::new("bad_timestamp", format!("not a timestamp: {s:?}")))
}

/// The clock as the domain sees it: one UTC instant, its local wall-clock reading, and
/// the business date that reading falls on.
#[derive(Debug, Clone, Copy)]
pub struct Clock {
    pub now: DateTime<Utc>,
    pub local_now: NaiveDateTime,
    pub today: NaiveDate,
}

impl Clock {
    pub fn read(settings: &Settings) -> Self {
        let now = Utc::now();
        let local_now = now.with_timezone(&Local).naive_local();
        Self {
            now,
            local_now,
            today: day_bounds::business_date(local_now, settings.day_start_hour),
        }
    }

    pub fn ctx<'a>(&self, device_id: &'a str) -> Ctx<'a> {
        Ctx::new(self.now, self.today, device_id)
    }

    pub fn tomorrow(&self) -> NaiveDate {
        self.today + Duration::days(1)
    }

    /// Past the evening hour of the current business day (which may run past midnight).
    pub fn after_evening(&self, settings: &Settings) -> bool {
        let hour = self.local_now.hour();
        hour >= settings.evening_hour || hour < settings.day_start_hour
    }
}

/// The UTC instant at which `date`'s business day ends.
pub fn day_end_utc(date: NaiveDate, day_start_hour: u32) -> DateTime<Utc> {
    let local = day_bounds::day_end_local(date, day_start_hour);
    match Local.from_local_datetime(&local) {
        LocalResult::Single(dt) | LocalResult::Ambiguous(dt, _) => dt.with_timezone(&Utc),
        // A DST gap: the wall-clock time never happened; use the hour after it.
        LocalResult::None => Local
            .from_local_datetime(&(local + Duration::hours(1)))
            .earliest()
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(Utc::now),
    }
}

/// Runs before every read and write: close running sessions on past days (the rollover)
/// and give today's first planned task the slot if nothing holds it.
pub async fn housekeeping(state: &AppState, settings: &Settings, clock: &Clock) -> CmdResult<()> {
    let ctx = clock.ctx(&state.device_id);
    for (plan_id, plan_date) in db::plans_with_open_sessions(&state.pool).await? {
        if plan_date >= clock.today {
            continue;
        }
        if let Some(mut day) = db::load_day_by_plan(&state.pool, &plan_id).await? {
            let day_end = day_end_utc(plan_date, settings.day_start_hour);
            if day.apply_rollover(day_end, &ctx) > 0 {
                db::save_day(&state.pool, &mut day).await?;
            }
        }
    }
    if let Some(mut day) = db::load_day(&state.pool, clock.today).await? {
        if day.ensure_active(&ctx).is_some() {
            db::save_day(&state.pool, &mut day).await?;
        }
    }
    Ok(())
}

/// Build the current snapshot and broadcast it to every window.
pub async fn publish(app: &AppHandle) -> CmdResult<DaySnapshot> {
    let state = app.state::<AppState>();
    let snap = snapshot::build(&state).await?;
    let _ = app.emit(STATE_CHANGED, &snap);
    Ok(snap)
}

/// Settings and clock together, since every command needs both.
pub async fn read_clock(state: &AppState) -> CmdResult<(Settings, Clock)> {
    let settings = db::load_settings(&state.pool).await?;
    let clock = Clock::read(&settings);
    Ok((settings, clock))
}

async fn mutate_loaded<F>(
    app: &AppHandle,
    day: Option<Day>,
    missing: AppError,
    f: F,
) -> CmdResult<DaySnapshot>
where
    F: FnOnce(&mut Day, &Ctx<'_>) -> Result<(), DomainError>,
{
    let state = app.state::<AppState>();
    let (settings, clock) = read_clock(&state).await?;
    housekeeping(&state, &settings, &clock).await?;
    let mut day = day.ok_or(missing)?;
    // Re-read after housekeeping so the transition sees the rollover / auto-activation.
    if let Some(fresh) = db::load_day_by_plan(&state.pool, &day.plan.id).await? {
        day = fresh;
    }
    let ctx = clock.ctx(&state.device_id);
    f(&mut day, &ctx)?;
    db::save_day(&state.pool, &mut day).await?;
    publish(app).await
}

/// Load the day that owns `task_id`, apply `f`, save, publish.
pub async fn mutate_by_task<F>(app: &AppHandle, task_id: &str, f: F) -> CmdResult<DaySnapshot>
where
    F: FnOnce(&mut Day, &Ctx<'_>) -> Result<(), DomainError>,
{
    let state = app.state::<AppState>();
    let day = db::load_day_by_task(&state.pool, task_id).await?;
    mutate_loaded(app, day, DomainError::TaskNotFound.into(), f).await
}

/// Load the day for `plan_id`, apply `f`, save, publish.
pub async fn mutate_by_plan<F>(app: &AppHandle, plan_id: &str, f: F) -> CmdResult<DaySnapshot>
where
    F: FnOnce(&mut Day, &Ctx<'_>) -> Result<(), DomainError>,
{
    let state = app.state::<AppState>();
    let day = db::load_day_by_plan(&state.pool, plan_id).await?;
    mutate_loaded(
        app,
        day,
        AppError::new("plan_not_found", "list not found"),
        f,
    )
    .await
}

/// Load the day that owns `session_id`, apply `f`, save, publish.
pub async fn mutate_by_session<F>(app: &AppHandle, session_id: &str, f: F) -> CmdResult<DaySnapshot>
where
    F: FnOnce(&mut Day, &Ctx<'_>) -> Result<(), DomainError>,
{
    let state = app.state::<AppState>();
    let day = db::load_day_by_session(&state.pool, session_id).await?;
    mutate_loaded(app, day, DomainError::SessionNotFound.into(), f).await
}
