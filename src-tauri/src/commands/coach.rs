//! The planning coach, as the view sees it: whether it can run, and one check of a list.
//! Nothing here touches the day: a check reads a setting and asks TypeSafe, no more.

use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::{AppError, AppState, CmdResult};
use crate::db;
use crate::domain::coach::{self, Hint};
use crate::domain::MAX_TASKS;

#[derive(Debug, Clone, Serialize)]
pub struct CoachStatus {
    pub enabled: bool,
    /// A TypeSafe key is in the Keychain. Six never reads it for this answer, and does
    /// not look at all while the coach is off (then this is false).
    pub key_present: bool,
}

#[tauri::command(rename_all = "snake_case")]
pub async fn coach_status(app: AppHandle) -> CmdResult<CoachStatus> {
    let state = app.state::<AppState>();
    let enabled = db::load_settings(&state.pool).await?.coach_enabled;
    let key_present = enabled
        && tauri::async_runtime::spawn_blocking(crate::coach::key_present)
            .await
            .unwrap_or(false);
    Ok(CoachStatus { enabled, key_present })
}

#[derive(Debug, Clone, Serialize)]
pub struct CoachView {
    /// One entry per title sent, in order: a hint or nothing.
    pub hints: Vec<Option<Hint>>,
}

/// Check a list: the titles as the planner holds them now (it need not be saved). Refused
/// unless the coach is switched on. The gate is not held: nothing of the day is read or
/// written, and a network call must never block the rest of the app.
#[tauri::command(rename_all = "snake_case")]
pub async fn coach_plan(app: AppHandle, titles: Vec<String>) -> CmdResult<CoachView> {
    let state = app.state::<AppState>();
    if !db::load_settings(&state.pool).await?.coach_enabled {
        return Err(AppError::new("coach_off", "the planning coach is switched off in Settings"));
    }
    let titles: Vec<String> = titles.iter().map(|t| t.trim().to_string()).collect();
    if titles.is_empty() || titles.len() > MAX_TASKS || titles.iter().any(String::is_empty) {
        return Err(AppError::new("coach_nothing", "there is nothing on the list to check"));
    }
    let request = coach::request(&titles);
    let count = titles.len();
    let answers = tauri::async_runtime::spawn_blocking(move || crate::coach::ask(&request))
        .await
        .map_err(|e| {
            eprintln!("[coach] the check stopped: {e}");
            let failed = crate::coach::CoachError::Failed(String::new());
            AppError::new(failed.code(), failed.message())
        })?
        .map_err(|e| {
            eprintln!("[coach] {}: {e:?}", e.code());
            AppError::new(e.code(), e.message())
        })?;
    Ok(CoachView {
        hints: coach::hints(count, &answers),
    })
}
