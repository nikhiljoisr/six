//! Facts over a range, and the export.

use std::path::PathBuf;

use chrono::{Duration, NaiveDate, Utc};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::{parse_date, read_clock, AppError, AppState, CmdResult};
use crate::db;
use crate::domain::analytics::{self, Stats};
use crate::domain::{report, streak, Day, Event, Plan, Pomodoro, Session, Task};

/// Consecutive planned days ending today or tomorrow.
#[tauri::command(rename_all = "snake_case")]
pub async fn get_streak(app: AppHandle) -> CmdResult<u32> {
    let state = app.state::<AppState>();
    let (_, clock) = read_clock(&state).await?;
    let locked = db::locked_dates(
        &state.pool,
        clock.today - Duration::days(400),
        clock.tomorrow(),
    )
    .await?;
    Ok(streak::streak(&locked, clock.today))
}

/// Days for `from..=to` plus sixty days of history before it, so carry-over lineage can
/// be followed; the stats themselves only count the range.
async fn load_with_lineage(
    state: &AppState,
    from: NaiveDate,
    to: NaiveDate,
) -> CmdResult<(Vec<Day>, Vec<Event>)> {
    let days = db::load_days(&state.pool, from - Duration::days(60), to).await?;
    let events = db::events_between(&state.pool, from, to).await?;
    Ok((days, events))
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_stats(app: AppHandle, from: String, to: String) -> CmdResult<Stats> {
    let state = app.state::<AppState>();
    let (_, clock) = read_clock(&state).await?;
    let (from, to) = (parse_date(&from)?, parse_date(&to)?);
    if to < from || (to - from).num_days() > 400 {
        return Err(AppError::new(
            "bad_range",
            "the range must run forwards and span at most 400 days",
        ));
    }
    let (days, events) = load_with_lineage(&state, from, to).await?;
    Ok(analytics::stats(&days, &events, from, to, clock.now))
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportResult {
    pub paths: Vec<String>,
    pub dir: String,
}

#[derive(Debug, Clone, Serialize)]
struct DayExport<'a> {
    plan: &'a Plan,
    tasks: &'a [Task],
    sessions: &'a [Session],
    pomodoros: &'a [Pomodoro],
}

#[derive(Debug, Clone, Serialize)]
struct Export<'a> {
    exported_at: chrono::DateTime<Utc>,
    from: NaiveDate,
    to: NaiveDate,
    stats: &'a Stats,
    days: Vec<DayExport<'a>>,
    events: &'a [Event],
}

/// `~/Six/exports` on the desktop.
pub fn exports_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| AppError::new("no_home", format!("no home directory: {e}")))?;
    Ok(home.join("Six").join("exports"))
}

fn write(dir: &PathBuf, name: &str, contents: &str) -> CmdResult<String> {
    std::fs::create_dir_all(dir).map_err(|e| {
        AppError::new(
            "export_failed",
            format!("could not create {}: {e}", dir.display()),
        )
    })?;
    let path = dir.join(name);
    std::fs::write(&path, contents).map_err(|e| {
        AppError::new(
            "export_failed",
            format!("could not write {}: {e}", path.display()),
        )
    })?;
    Ok(path.display().to_string())
}

/// Plain text and JSON for a range, written to the exports folder.
#[tauri::command(rename_all = "snake_case")]
pub async fn export_range(
    app: AppHandle,
    from: String,
    to: String,
    format: String,
) -> CmdResult<ExportResult> {
    let state = app.state::<AppState>();
    let (_, clock) = read_clock(&state).await?;
    let (from, to) = (parse_date(&from)?, parse_date(&to)?);
    if to < from || (to - from).num_days() > 400 {
        return Err(AppError::new(
            "bad_range",
            "the range must run forwards and span at most 400 days",
        ));
    }
    let (days, events) = load_with_lineage(&state, from, to).await?;
    let stats = analytics::stats(&days, &events, from, to, clock.now);
    let in_range: Vec<&Day> = days
        .iter()
        .filter(|d| d.plan.plan_date >= from && d.plan.plan_date <= to)
        .collect();
    let dir = exports_dir(&app)?;
    let stem = format!("six-{from}_{to}");
    let mut paths = Vec::new();
    if format == "text" || format == "both" {
        let owned: Vec<Day> = in_range.iter().map(|d| (*d).clone()).collect();
        let text = report::text_report(&stats, &owned, clock.now);
        paths.push(write(&dir, &format!("{stem}.txt"), &text)?);
    }
    if format == "json" || format == "both" {
        let export = Export {
            exported_at: clock.now,
            from,
            to,
            stats: &stats,
            days: in_range
                .iter()
                .map(|d| DayExport {
                    plan: &d.plan,
                    tasks: &d.tasks,
                    sessions: &d.sessions,
                    pomodoros: &d.pomodoros,
                })
                .collect(),
            events: &events,
        };
        let json = serde_json::to_string_pretty(&export)
            .map_err(|e| AppError::new("export_failed", format!("could not serialise: {e}")))?;
        paths.push(write(&dir, &format!("{stem}.json"), &json)?);
    }
    Ok(ExportResult {
        paths,
        dir: dir.display().to_string(),
    })
}

/// Everything, as JSON.
#[tauri::command(rename_all = "snake_case")]
pub async fn export_all(app: AppHandle) -> CmdResult<ExportResult> {
    let state = app.state::<AppState>();
    let (_, clock) = read_clock(&state).await?;
    let from = NaiveDate::from_ymd_opt(2000, 1, 1).expect("valid");
    let to = clock.tomorrow() + Duration::days(1);
    let days = db::load_days(&state.pool, from, to).await?;
    let events = db::events_between(&state.pool, from, to).await?;
    let stats = analytics::stats(&days, &events, from, to, clock.now);
    let export = Export {
        exported_at: clock.now,
        from,
        to,
        stats: &stats,
        days: days
            .iter()
            .map(|d| DayExport {
                plan: &d.plan,
                tasks: &d.tasks,
                sessions: &d.sessions,
                pomodoros: &d.pomodoros,
            })
            .collect(),
        events: &events,
    };
    let json = serde_json::to_string_pretty(&export)
        .map_err(|e| AppError::new("export_failed", format!("could not serialise: {e}")))?;
    let dir = exports_dir(&app)?;
    let path = write(&dir, &format!("six-all-{}.json", clock.today), &json)?;
    Ok(ExportResult {
        paths: vec![path],
        dir: dir.display().to_string(),
    })
}
