//! Tauri commands: thin adapters between the frontend and the domain. Every mutation
//! loads a `Day`, applies one transition, saves it, then broadcasts a fresh snapshot on
//! the `state_changed` event.
//!
//! One operation at a time. Every read-modify-save (a command, the ticker, an interaction
//! stamp, the housekeeping inside a snapshot) runs under `AppState::gate`, so a slow
//! command can never save a copy of the day that another one has already moved on from.
//! Functions documented "gate held" never take the gate themselves (it is not
//! re-entrant); their callers do.

pub mod nudges;
pub mod plans;
pub mod review;
pub mod settings;
pub mod snapshot;
pub mod stats;
pub mod tasks;
pub mod window;

use std::sync::atomic::{AtomicU64, Ordering};

use chrono::{
    DateTime, Duration, Local, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Timelike, Utc,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::{self, DbError, Pool};
use crate::domain::{day as day_bounds, Ctx, Day, DomainError, Settings, SettingsError};

pub use snapshot::{DaySnapshot, PlanView, TaskView};

pub const STATE_CHANGED: &str = "state_changed";

pub struct AppState {
    pub pool: Pool,
    pub device_id: String,
    /// Serialises every read-modify-save. See the module notes.
    pub gate: tokio::sync::Mutex<()>,
    /// Counts the snapshots built under the gate; the frontend keeps the newest.
    revision: AtomicU64,
}

impl AppState {
    pub fn new(pool: Pool, device_id: String) -> Self {
        Self {
            pool,
            device_id,
            gate: tokio::sync::Mutex::new(()),
            revision: AtomicU64::new(0),
        }
    }

    /// Gate held. The next snapshot revision, so revisions order the same way as state.
    pub fn next_revision(&self) -> u64 {
        self.revision.fetch_add(1, Ordering::SeqCst) + 1
    }
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

    /// Past the evening hour of the current business day. The business day runs from
    /// the day-start hour to the next one; the evening hour may lie past midnight,
    /// before it, in which case only those small hours are "after evening".
    pub fn after_evening(&self, settings: &Settings) -> bool {
        let hour = self.local_now.hour();
        let (evening, start) = (settings.evening_hour, settings.day_start_hour);
        if evening >= start {
            hour >= evening || hour < start
        } else {
            hour >= evening && hour < start
        }
    }

    /// The rollover instant that began today.
    pub fn today_start(&self, settings: &Settings) -> DateTime<Utc> {
        day_end_utc(self.today - Duration::days(1), settings.day_start_hour)
    }

    /// The next rollover instant.
    pub fn tomorrow_start(&self, settings: &Settings) -> DateTime<Utc> {
        day_end_utc(self.today, settings.day_start_hour)
    }

    /// The evening-hour instant of a business date (the next calendar day when the
    /// evening hour lies past midnight, before the rollover).
    pub fn evening(&self, date: NaiveDate, settings: &Settings) -> DateTime<Utc> {
        let calendar = if settings.evening_hour < settings.day_start_hour {
            date + Duration::days(1)
        } else {
            date
        };
        local_to_utc(
            calendar
                .and_hms_opt(settings.evening_hour, 0, 0)
                .expect("evening_hour is validated to 0..=23"),
        )
    }
}

/// A local wall-clock time as a UTC instant, tolerant of DST gaps.
pub fn local_to_utc(local: NaiveDateTime) -> DateTime<Utc> {
    match Local.from_local_datetime(&local) {
        LocalResult::Single(dt) | LocalResult::Ambiguous(dt, _) => dt.with_timezone(&Utc),
        LocalResult::None => Local
            .from_local_datetime(&(local + Duration::hours(1)))
            .earliest()
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(Utc::now),
    }
}

/// The UTC instant at which `date`'s business day ends.
pub fn day_end_utc(date: NaiveDate, day_start_hour: u32) -> DateTime<Utc> {
    local_to_utc(day_bounds::day_end_local(date, day_start_hour))
}

/// Gate held. Runs before every read and write: close running sessions on past days
/// (the rollover), settle rings, and give today's first planned task the slot if
/// nothing holds it.
pub async fn housekeeping(state: &AppState, settings: &Settings, clock: &Clock) -> CmdResult<bool> {
    let ctx = clock.ctx(&state.device_id);
    let mut changed = false;
    for (plan_id, plan_date) in db::plans_with_open_sessions(&state.pool).await? {
        if plan_date >= clock.today {
            continue;
        }
        if let Some(mut day) = db::load_day_by_plan(&state.pool, &plan_id).await? {
            let day_end = day_end_utc(plan_date, settings.day_start_hour);
            if day.apply_rollover(day_end, &ctx) > 0 {
                db::save_day(&state.pool, &mut day).await?;
                changed = true;
            }
        }
    }
    if let Some(mut day) = db::load_day(&state.pool, clock.today).await? {
        let activated = day.ensure_active(&ctx).is_some();
        let rang = day.settle_pomodoros(&ctx);
        if activated || rang {
            db::save_day(&state.pool, &mut day).await?;
            changed = true;
        }
    }
    Ok(changed)
}

/// Gate held. Build the current snapshot and broadcast it to every window.
pub async fn publish(app: &AppHandle) -> CmdResult<DaySnapshot> {
    crate::scheduler::deliver_now(app).await;
    let snap = {
        let state = app.state::<AppState>();
        snapshot::build(&state).await?
    };
    let _ = app.emit(STATE_CHANGED, &snap);
    #[cfg(target_os = "macos")]
    crate::tray::sync(app, &snap);
    crate::scheduler::reconcile(app).await;
    Ok(snap)
}

/// The current snapshot, built under the gate (a read can move state: the rollover, a
/// ring, the first task taking the slot), with the tray and the nudges brought in line.
pub async fn read_snapshot(app: &AppHandle) -> CmdResult<DaySnapshot> {
    crate::scheduler::deliver_now(app).await;
    let snap = {
        let state = app.state::<AppState>();
        let _gate = state.gate.lock().await;
        snapshot::build(&state).await?
    };
    #[cfg(target_os = "macos")]
    crate::tray::sync(app, &snap);
    crate::scheduler::reconcile(app).await;
    Ok(snap)
}

/// Settings and clock together, since every command needs both.
pub async fn read_clock(state: &AppState) -> CmdResult<(Settings, Clock)> {
    let settings = db::load_settings(&state.pool).await?;
    let clock = Clock::read(&settings);
    Ok((settings, clock))
}

/// Gate held. Housekeeping, then `f` on a fresh copy of the day, then save. `day` only
/// names the plan; the copy that changes is loaded after housekeeping, under the gate.
pub async fn mutate_locked<F>(
    state: &AppState,
    day: Option<Day>,
    missing: AppError,
    f: F,
) -> CmdResult<()>
where
    F: FnOnce(&mut Day, &Ctx<'_>) -> Result<(), DomainError>,
{
    let (settings, clock) = read_clock(state).await?;
    housekeeping(state, &settings, &clock).await?;
    let plan_id = day.ok_or(missing)?.plan.id;
    let mut day = db::load_day_by_plan(&state.pool, &plan_id)
        .await?
        .ok_or_else(|| AppError::new("plan_not_found", "list not found"))?;
    let ctx = clock.ctx(&state.device_id);
    f(&mut day, &ctx)?;
    // Whatever the command was, the user was here for it.
    day.touch(&ctx);
    db::save_day(&state.pool, &mut day).await?;
    Ok(())
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
    let _gate = state.gate.lock().await;
    mutate_locked(&state, day, missing, f).await?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn clock(hour: u32) -> Clock {
        let day = NaiveDate::from_ymd_opt(2026, 9, 3).unwrap();
        Clock {
            now: Utc::now(),
            local_now: day.and_hms_opt(hour, 0, 0).unwrap(),
            today: day,
        }
    }

    #[test]
    fn after_evening_runs_from_the_evening_hour_to_the_day_start() {
        let s = Settings::default(); // evening 18, day starts 5
        assert!(!clock(9).after_evening(&s));
        assert!(!clock(17).after_evening(&s));
        assert!(clock(18).after_evening(&s));
        assert!(clock(23).after_evening(&s));
        assert!(clock(2).after_evening(&s), "the small hours belong to the evening before");
        assert!(!clock(5).after_evening(&s));
    }

    #[test]
    fn an_evening_hour_past_midnight_covers_only_the_small_hours() {
        let mut s = Settings::default();
        s.evening_hour = 2;
        s.day_start_hour = 5;
        assert!(!clock(12).after_evening(&s));
        assert!(!clock(23).after_evening(&s));
        assert!(!clock(1).after_evening(&s));
        assert!(clock(2).after_evening(&s));
        assert!(clock(4).after_evening(&s));
        assert!(!clock(5).after_evening(&s));
    }

    #[test]
    fn revisions_only_go_up() {
        let pool = tauri::async_runtime::block_on(crate::db::open_in_memory()).unwrap();
        let state = AppState::new(pool, "test".into());
        let a = state.next_revision();
        let b = state.next_revision();
        assert!(b > a);
    }
}
