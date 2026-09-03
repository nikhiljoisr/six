//! Nudges. Rust plans them from state (`domain::nudges`), the OS delivers them while the
//! window is away, and while the window is focused they arrive as in-app banners instead.
//! One pending notification per kind; re-scheduling replaces. Also the timed checks:
//! when the day rolls over or the evening hour passes, the state is republished so the
//! tray, the window and the nudges all move together.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use chrono::{DateTime, Duration, NaiveDate, Utc};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::{self, AppState};
use crate::db;
use crate::domain::nudges::{self, Nudge, NudgeInput, NudgeKind};
use crate::domain::Settings;

pub const NUDGE_EVENT: &str = "nudge";
const TICK_SECS: u64 = 15;

type Fingerprint = (DateTime<Utc>, String, String);

#[derive(Default)]
pub struct Scheduler {
    /// The main window has focus: nothing fires, banners show in-app.
    focused: AtomicBool,
    /// The OS notification plugin is usable (macOS needs a .app bundle).
    available: AtomicBool,
    snoozes: Mutex<HashMap<NudgeKind, DateTime<Utc>>>,
    planned: Mutex<Vec<Nudge>>,
    os_scheduled: Mutex<HashMap<NudgeKind, Fingerprint>>,
    delivered: Mutex<HashSet<(NudgeKind, DateTime<Utc>)>>,
}

impl Scheduler {
    pub fn snooze(&self, kind: NudgeKind, until: DateTime<Utc>) {
        self.snoozes.lock().unwrap().insert(kind, until);
    }

    pub fn is_focused(&self) -> bool {
        self.focused.load(Ordering::Relaxed)
    }

    pub fn notifications_available(&self) -> bool {
        self.available.load(Ordering::Relaxed)
    }
}

/// Install the scheduler state and start the ticker.
pub fn setup(app: &AppHandle, notifications_available: bool) {
    let s = Scheduler::default();
    s.focused.store(true, Ordering::Relaxed);
    s.available
        .store(notifications_available, Ordering::Relaxed);
    app.manage(s);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last: Option<(NaiveDate, bool)> = None;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(TICK_SECS)).await;
            let tick = {
                let state = app.state::<AppState>();
                match commands::read_clock(&state).await {
                    Ok((settings, clock)) => {
                        // Rings and rollovers are settled here too, so a pomodoro that
                        // ends while the window shows Settings (or is closed) is not missed.
                        let changed = commands::housekeeping(&state, &settings, &clock)
                            .await
                            .unwrap_or(false);
                        Some((
                            clock.today,
                            clock.after_evening(&settings),
                            clock.now,
                            changed,
                        ))
                    }
                    Err(_) => None,
                }
            };
            let Some((today, evening, now, changed)) = tick else {
                continue;
            };
            if changed || last.is_some_and(|k| k != (today, evening)) {
                // Something moved (a ring, a rollover, the evening hour): republish.
                let _ = commands::publish(&app).await;
            }
            last = Some((today, evening));
            deliver_due(&app, now);
        }
    });
}

/// Focus changed: while focused, cancel the OS notifications and show banners instead.
pub fn set_focused(app: &AppHandle, focused: bool) {
    if let Some(s) = app.try_state::<Scheduler>() {
        s.focused.store(focused, Ordering::Relaxed);
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        reconcile(&app).await;
    });
}

/// Recompute the plan from the current state and bring the OS (or the banners) in line.
pub async fn reconcile(app: &AppHandle) {
    let Some(sched) = app.try_state::<Scheduler>() else {
        return;
    };
    let state = app.state::<AppState>();
    let Ok((settings, clock)) = commands::read_clock(&state).await else {
        return;
    };
    let today = db::load_day(&state.pool, clock.today).await.ok().flatten();
    let tomorrow_locked = db::load_day(&state.pool, clock.tomorrow())
        .await
        .ok()
        .flatten()
        .is_some_and(|d| d.plan.is_locked());
    let snoozes = sched.snoozes.lock().unwrap().clone();
    let input = NudgeInput {
        now: clock.now,
        today_start: clock.today_start(&settings),
        tomorrow_start: clock.tomorrow_start(&settings),
        evening_today: clock.evening(clock.today, &settings),
        evening_tomorrow: clock.evening(clock.tomorrow(), &settings),
        settings: &settings,
        today: today.as_ref(),
        tomorrow_locked,
        snoozes: &snoozes,
    };
    let planned = nudges::plan(&input);
    eprintln!(
        "[nudges] planned ({}): {}",
        if sched.is_focused() {
            "focused"
        } else {
            "away"
        },
        planned
            .iter()
            .map(|n| format!("{}@{}", n.kind.key(), n.due.format("%H:%M")))
            .collect::<Vec<_>>()
            .join(" ")
    );
    *sched.planned.lock().unwrap() = planned.clone();

    let focused = sched.is_focused();
    if focused {
        deliver_due(app, clock.now);
    }
    #[cfg(any(target_os = "macos", mobile))]
    if sched.notifications_available() {
        os_sync(app, &planned, focused, clock.now, &settings).await;
    }
    #[cfg(not(any(target_os = "macos", mobile)))]
    let _ = (&planned, focused, &settings);
}

/// Show, in-app, every planned nudge whose time has come (once each).
fn deliver_due(app: &AppHandle, now: DateTime<Utc>) {
    let Some(sched) = app.try_state::<Scheduler>() else {
        return;
    };
    if !sched.is_focused() {
        return;
    }
    let due: Vec<Nudge> = sched
        .planned
        .lock()
        .unwrap()
        .iter()
        .filter(|n| n.due <= now)
        .cloned()
        .collect();
    let mut delivered = sched.delivered.lock().unwrap();
    for n in due {
        if delivered.insert((n.kind, n.due)) {
            eprintln!(
                "[nudges] in-app: {} due {}",
                n.kind.key(),
                n.due.format("%H:%M:%S")
            );
            let _ = app.emit_to(crate::commands::window::MAIN, NUDGE_EVENT, &n);
        }
    }
}

/// Which OS action set a nudge uses; the long pomodoro break carries its own labels.
fn action_type_for(n: &Nudge) -> &'static str {
    match n.kind {
        NudgeKind::PomodoroDone if n.actions.first().is_some_and(|a| a.label != "Take 5") => {
            "pomodoro_done_long"
        }
        kind => kind.key(),
    }
}

#[cfg(any(target_os = "macos", mobile))]
fn action_types(settings: &Settings) -> Vec<tauri_plugin_notifications::ActionType> {
    use serde_json::json;
    let long = format!("Take {}", settings.long_break_minutes);
    let defs = vec![
        json!({"id": "evening_ritual", "actions": [
            {"id": "plan", "title": "Plan", "foreground": true},
            {"id": "later", "title": "Later"}]}),
        json!({"id": "check_in", "actions": [
            {"id": "done", "title": "Done"},
            {"id": "keep_going", "title": "Keep going"},
            {"id": "take_break", "title": "Take 5"}]}),
        json!({"id": "break_over", "actions": [
            {"id": "resume", "title": "Resume"},
            {"id": "five_more", "title": "5 more"}]}),
        json!({"id": "unplanned_morning", "actions": [
            {"id": "plan", "title": "Plan now", "foreground": true}]}),
        json!({"id": "end_of_day", "actions": [
            {"id": "review", "title": "Review", "foreground": true},
            {"id": "later", "title": "Later"}]}),
        json!({"id": "pomodoro_done", "actions": [
            {"id": "take_break", "title": "Take 5"},
            {"id": "one_more", "title": "One more"}]}),
        json!({"id": "pomodoro_done_long", "actions": [
            {"id": "take_break", "title": long},
            {"id": "one_more", "title": "One more"}]}),
    ];
    defs.into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect()
}

#[cfg(any(target_os = "macos", mobile))]
fn to_offset(dt: DateTime<Utc>) -> time::OffsetDateTime {
    time::OffsetDateTime::from_unix_timestamp(dt.timestamp())
        .unwrap_or_else(|_| time::OffsetDateTime::now_utc())
}

/// Bring the OS's pending notifications in line with the plan: one per kind, none while
/// the window is focused, replaced only when the time or text changed.
#[cfg(any(target_os = "macos", mobile))]
async fn os_sync(
    app: &AppHandle,
    planned: &[Nudge],
    focused: bool,
    now: DateTime<Utc>,
    settings: &Settings,
) {
    use tauri_plugin_notifications::{NotificationsExt, Schedule};
    let Some(sched) = app.try_state::<Scheduler>() else {
        return;
    };
    let notifications = app.notifications();
    let _ = notifications.register_action_types(action_types(settings));

    let current: HashMap<NudgeKind, Fingerprint> = sched.os_scheduled.lock().unwrap().clone();
    let desired: HashMap<NudgeKind, &Nudge> = if focused {
        HashMap::new()
    } else {
        planned
            .iter()
            .filter(|n| n.due > now)
            .map(|n| (n.kind, n))
            .collect()
    };
    let mut next = current.clone();
    for kind in NudgeKind::ALL {
        match (desired.get(&kind), current.get(&kind)) {
            (None, Some(_)) => {
                let _ = notifications.cancel(vec![kind.id()]);
                next.remove(&kind);
            }
            (Some(n), cur) => {
                let fp: Fingerprint = (n.due, n.title.clone(), n.body.clone());
                if cur == Some(&fp) {
                    continue;
                }
                let _ = notifications.cancel(vec![kind.id()]);
                let builder = notifications
                    .builder()
                    .id(kind.id())
                    .title(&n.title)
                    .body(&n.body)
                    .action_type_id(action_type_for(n))
                    .schedule(Schedule::At {
                        date: to_offset(n.due),
                        repeating: false,
                        allow_while_idle: true,
                    });
                // Silent unless the user asked for a sound on timer transitions.
                let timer_transition =
                    matches!(kind, NudgeKind::PomodoroDone | NudgeKind::BreakOver);
                let builder = if settings.sound_enabled && timer_transition {
                    builder.sound("default")
                } else {
                    builder
                };
                let shown = builder.show().await;
                match shown {
                    Ok(()) => {
                        next.insert(kind, fp);
                    }
                    Err(e) => {
                        eprintln!("[nudges] could not schedule {}: {e}", kind.key());
                        next.remove(&kind);
                    }
                }
            }
            (None, None) => {}
        }
    }
    *sched.os_scheduled.lock().unwrap() = next;
}

/// Thirty minutes, the "Later" of every nudge that has one.
pub const LATER: Duration = Duration::minutes(30);
