//! Nudge actions (from the OS notification or the in-app banner), snoozes, permission
//! status, and app info for the Settings screen.

use chrono::Duration;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Manager};

use super::{
    mutate_by_task, publish, read_clock, window, AppError, AppState, CmdResult, DaySnapshot,
};
use crate::db;
use crate::domain::nudges::NudgeKind;
use crate::domain::{PauseReason, TaskStatus};
use crate::scheduler::{self, Scheduler, LATER};

/// One action from a nudge: the same ids the OS buttons and the in-app banner use.
#[tauri::command(rename_all = "snake_case")]
pub async fn nudge_action(app: AppHandle, kind: String, action: String) -> CmdResult<DaySnapshot> {
    let kind =
        NudgeKind::parse(&kind).ok_or_else(|| AppError::new("unknown_nudge", "unknown nudge"))?;
    let (settings, clock, current, today_plan_id) = {
        let state = app.state::<AppState>();
        let (settings, clock) = read_clock(&state).await?;
        let today = db::load_day(&state.pool, clock.today).await?;
        let current = today.as_ref().and_then(|d| d.current_task().cloned());
        (settings, clock, current, today.map(|d| d.plan.id))
    };
    let sched = app.state::<Scheduler>();
    match action.as_str() {
        "later" => sched.snooze(kind, clock.now + LATER),
        "keep_going" => sched.snooze(
            NudgeKind::CheckIn,
            clock.now + Duration::minutes(i64::from(settings.checkin_minutes)),
        ),
        "five_more" => sched.snooze(NudgeKind::BreakOver, clock.now + Duration::minutes(5)),
        "plan" => {
            let date = if kind == NudgeKind::UnplannedMorning {
                clock.today
            } else {
                clock.tomorrow()
            };
            window::open_main(
                &app,
                Some(json!({"name": "planner", "date": date.to_string()})),
            );
        }
        "review" => {
            if let Some(plan_id) = today_plan_id {
                window::open_main(&app, Some(json!({"name": "review", "planId": plan_id})));
            }
        }
        "done" => {
            if let Some(t) = current.filter(|t| t.status.is_current()) {
                return mutate_by_task(&app, &t.id, |d, c| d.complete(&t.id, c)).await;
            }
        }
        "take_break" => {
            if let Some(t) = current.filter(|t| t.status == TaskStatus::Active) {
                return mutate_by_task(&app, &t.id, |d, c| d.pause(&t.id, PauseReason::Break, c))
                    .await;
            }
        }
        "resume" => {
            if let Some(t) = current.filter(|t| t.status == TaskStatus::Paused) {
                return mutate_by_task(&app, &t.id, |d, c| d.resume(&t.id, c)).await;
            }
        }
        "one_more" => {
            if let Some(t) = current.filter(|t| t.status == TaskStatus::Active) {
                if !settings.pomodoro_enabled {
                    return Err(AppError::new(
                        "pomodoro_off",
                        "Pomodoro is switched off in Settings",
                    ));
                }
                let seconds = i64::from(settings.pomodoro_minutes) * 60;
                return mutate_by_task(&app, &t.id, |d, c| d.start_pomodoro(&t.id, seconds, c))
                    .await;
            }
        }
        other => {
            return Err(AppError::new(
                "unknown_action",
                format!("unknown nudge action {other}"),
            ))
        }
    }
    publish(&app).await
}

/// Push a nudge back by `minutes` (the banner's "Later").
#[tauri::command(rename_all = "snake_case")]
pub async fn snooze(app: AppHandle, kind: String, minutes: u32) -> CmdResult<DaySnapshot> {
    let kind =
        NudgeKind::parse(&kind).ok_or_else(|| AppError::new("unknown_nudge", "unknown nudge"))?;
    let now = chrono::Utc::now();
    app.state::<Scheduler>().snooze(
        kind,
        now + Duration::minutes(i64::from(minutes.clamp(1, 24 * 60))),
    );
    publish(&app).await
}

#[derive(Debug, Clone, Serialize)]
pub struct NotificationStatus {
    /// The OS notification plugin is usable in this build (macOS: only from a .app bundle).
    pub available: bool,
    /// "granted", "denied", "prompt", or "unavailable".
    pub permission: String,
}

async fn permission_string(app: &AppHandle) -> String {
    #[cfg(any(target_os = "macos", mobile))]
    {
        use tauri_plugin_notifications::NotificationsExt;
        match app.notifications().permission_state().await {
            Ok(state) => format!("{state:?}").to_lowercase(),
            Err(_) => "unavailable".to_string(),
        }
    }
    #[cfg(not(any(target_os = "macos", mobile)))]
    {
        let _ = app;
        "unavailable".to_string()
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn notification_status(app: AppHandle) -> CmdResult<NotificationStatus> {
    let available = app
        .try_state::<Scheduler>()
        .is_some_and(|s| s.notifications_available());
    let permission = if available {
        permission_string(&app).await
    } else {
        "unavailable".to_string()
    };
    Ok(NotificationStatus {
        available,
        permission,
    })
}

#[tauri::command(rename_all = "snake_case")]
pub async fn request_notification_permission(app: AppHandle) -> CmdResult<NotificationStatus> {
    let available = app
        .try_state::<Scheduler>()
        .is_some_and(|s| s.notifications_available());
    if !available {
        return Ok(NotificationStatus {
            available,
            permission: "unavailable".to_string(),
        });
    }
    #[cfg(any(target_os = "macos", mobile))]
    {
        use tauri_plugin_notifications::NotificationsExt;
        let permission = match app.notifications().request_permission().await {
            Ok(state) => format!("{state:?}").to_lowercase(),
            Err(e) => {
                eprintln!("[nudges] permission request failed: {e}");
                "unavailable".to_string()
            }
        };
        scheduler::reconcile(&app).await;
        Ok(NotificationStatus {
            available,
            permission,
        })
    }
    #[cfg(not(any(target_os = "macos", mobile)))]
    Ok(NotificationStatus {
        available: false,
        permission: "unavailable".to_string(),
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
    pub exports_dir: String,
    pub platform: String,
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_app_info(app: AppHandle) -> CmdResult<AppInfo> {
    let data_dir = app
        .path()
        .app_config_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        data_dir,
        exports_dir: super::stats::exports_dir(&app)
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
        platform: std::env::consts::OS.to_string(),
    })
}
