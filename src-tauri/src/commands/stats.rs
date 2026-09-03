use chrono::Duration;
use tauri::{AppHandle, Manager};

use super::{read_clock, AppState, CmdResult};
use crate::db;
use crate::domain::streak;

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

// `get_stats` and `export` arrive with the Stats view in Step 5.
