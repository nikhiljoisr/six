//! macOS menu bar companion (SPEC §4.11). The tray title reflects the day's state and
//! changes on state change only; a left click opens a small popover window with the
//! active task and its three actions; a right click shows a native menu. The main window
//! closes to the menu bar and the app keeps running until Quit.
#![cfg(target_os = "macos")]

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{
    ActivationPolicy, AppHandle, Emitter, LogicalPosition, Manager, WebviewUrl,
    WebviewWindowBuilder, WindowEvent, Wry,
};

use crate::commands::{self, AppState, DaySnapshot, TaskView};
use crate::domain::tray::{tray_title, TraySummary};
use crate::domain::{PauseReason, TaskStatus};

pub const MAIN: &str = "main";
pub const POPOVER: &str = "popover";
const POPOVER_WIDTH: f64 = 320.0;
const POPOVER_HEIGHT: f64 = 220.0;
/// A tray click that arrives this soon after the popover lost focus is the click that
/// closed it, not a request to reopen it.
const REOPEN_GUARD: Duration = Duration::from_millis(400);
/// The status item briefly takes key focus back right after the click that opened the
/// popover; a blur this soon after showing is that flicker, not a dismissal.
const BLUR_GRACE: Duration = Duration::from_millis(600);

pub struct Tray {
    icon: TrayIcon<Wry>,
    plan_item: MenuItem<Wry>,
    pause_item: MenuItem<Wry>,
    review_item: MenuItem<Wry>,
    last_title: Mutex<String>,
    popover_hidden_at: Mutex<Option<Instant>>,
    popover_shown_at: Mutex<Option<Instant>>,
    /// Bumped on every show; a banner's auto-hide only fires for its own showing.
    generation: Mutex<u64>,
}

/// Build the tray icon, its menu and the (hidden) popover window.
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Six", true, None::<&str>)?;
    let plan = MenuItem::with_id(app, "plan_tomorrow", "Plan tomorrow", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause_resume", "Pause", false, None::<&str>)?;
    let review = MenuItem::with_id(app, "review", "Review today", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Six", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &plan, &pause, &review, &separator, &quit])?;

    let icon = TrayIconBuilder::with_id("six")
        .title("Six")
        .tooltip("Six")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                toggle_popover(tray.app_handle(), rect);
            }
        })
        .build(app)?;

    let popover = WebviewWindowBuilder::new(app, POPOVER, WebviewUrl::App("index.html".into()))
        .title("Six")
        .inner_size(POPOVER_WIDTH, POPOVER_HEIGHT)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .shadow(true)
        .accept_first_mouse(true)
        .visible(false)
        .build()?;
    {
        let app = app.clone();
        popover.on_window_event(move |event| {
            if let WindowEvent::Focused(false) = event {
                let just_shown = app
                    .try_state::<Tray>()
                    .and_then(|t| *t.popover_shown_at.lock().unwrap())
                    .is_some_and(|at| at.elapsed() < BLUR_GRACE);
                if just_shown {
                    return;
                }
                hide_popover(&app);
            }
        });
    }

    app.manage(Tray {
        icon,
        plan_item: plan,
        pause_item: pause,
        review_item: review,
        last_title: Mutex::new(String::new()),
        popover_hidden_at: Mutex::new(None),
        popover_shown_at: Mutex::new(None),
        generation: Mutex::new(0),
    });
    Ok(())
}

/// Rebuild the snapshot and bring the tray in line with it. Used at startup and when the
/// popover opens, since the evening hour can pass without any mutation.
pub fn refresh(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Built under the gate; brings the tray in line itself.
        let _ = commands::read_snapshot(&app).await;
    });
}

/// Bring the tray title and menu in line with a snapshot. Called on every publish.
pub fn sync(app: &AppHandle, snapshot: &DaySnapshot) {
    let Some(tray) = app.try_state::<Tray>() else {
        return;
    };
    let title = tray_title(&summarize(snapshot));
    {
        let mut last = tray.last_title.lock().unwrap();
        if *last != title {
            let _ = tray.icon.set_title(Some(&title));
            *last = title;
        }
    }
    let (pause_text, pause_enabled) = match current_task(snapshot) {
        Some(t) if t.status == TaskStatus::Active => ("Pause", true),
        Some(_) => ("Resume", true),
        None => ("Pause", false),
    };
    let _ = tray.pause_item.set_text(pause_text);
    let _ = tray.pause_item.set_enabled(pause_enabled);
    let reviewable = snapshot
        .today_plan
        .as_ref()
        .is_some_and(|p| p.locked_at.is_some() && p.reviewed_at.is_none());
    let _ = tray.review_item.set_enabled(reviewable);
    let tomorrow_planned = snapshot
        .tomorrow_plan
        .as_ref()
        .is_some_and(|p| p.locked_at.is_some());
    let _ = tray.plan_item.set_text(if tomorrow_planned {
        "Edit tomorrow"
    } else {
        "Plan tomorrow"
    });
}

fn current_task(snapshot: &DaySnapshot) -> Option<&TaskView> {
    snapshot
        .today_plan
        .as_ref()?
        .tasks
        .iter()
        .find(|t| t.status == TaskStatus::Active || t.status == TaskStatus::Paused)
}

fn summarize(snapshot: &DaySnapshot) -> TraySummary {
    let plan = snapshot
        .today_plan
        .as_ref()
        .filter(|p| p.locked_at.is_some());
    let current = current_task(snapshot);
    TraySummary {
        has_list: plan.is_some(),
        task_count: plan.map(|p| p.task_count).unwrap_or(0),
        done_count: plan.map(|p| p.done_count).unwrap_or(0),
        all_done: plan.is_some_and(|p| p.all_done),
        active: current
            .filter(|t| t.status == TaskStatus::Active)
            .map(|t| (t.position, t.title.clone())),
        paused: current.is_some_and(|t| t.status == TaskStatus::Paused),
        after_evening: matches!(snapshot.phase, commands::snapshot::Phase::AfterEvening),
        tomorrow_planned: snapshot
            .tomorrow_plan
            .as_ref()
            .is_some_and(|p| p.locked_at.is_some()),
        compact: snapshot.settings.tray_style == "compact",
    }
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "open" => show_main(app, None),
        "plan_tomorrow" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let state = app.state::<AppState>();
                if let Ok((_, clock)) = commands::read_clock(&state).await {
                    let date = clock.tomorrow().to_string();
                    show_main(&app, Some(json!({ "name": "planner", "date": date })));
                }
            });
        }
        "pause_resume" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let Ok(snapshot) = commands::read_snapshot(&app).await else {
                    return;
                };
                let Some(task) = current_task(&snapshot) else {
                    return;
                };
                let (id, status) = (task.id.clone(), task.status);
                let result = if status == TaskStatus::Active {
                    commands::mutate_by_task(&app, &id, |day, ctx| {
                        day.pause(&id, PauseReason::Paused, ctx)
                    })
                    .await
                } else {
                    commands::mutate_by_task(&app, &id, |day, ctx| day.resume(&id, ctx)).await
                };
                if result.is_err() {
                    refresh(&app);
                }
            });
        }
        "review" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let Ok(snapshot) = commands::read_snapshot(&app).await else {
                    return;
                };
                if let Some(plan) = snapshot
                    .today_plan
                    .as_ref()
                    .filter(|p| p.locked_at.is_some())
                {
                    let id = plan.id.clone();
                    show_main(&app, Some(json!({ "name": "review", "planId": id })));
                }
            });
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

fn toggle_popover(app: &AppHandle, rect: tauri::Rect) {
    let Some(tray) = app.try_state::<Tray>() else {
        return;
    };
    let Some(popover) = app.get_webview_window(POPOVER) else {
        return;
    };
    if let Some(hidden_at) = *tray.popover_hidden_at.lock().unwrap() {
        if hidden_at.elapsed() < REOPEN_GUARD {
            return;
        }
    }
    if popover.is_visible().unwrap_or(false) {
        hide_popover(app);
        return;
    }
    place_popover(&popover, &rect);
    *tray.popover_shown_at.lock().unwrap() = Some(Instant::now());
    *tray.generation.lock().unwrap() += 1;
    let _ = popover.show();
    let _ = popover.set_focus();
    let _ = app.emit_to(POPOVER, "popover_shown", ());
    // Re-assert focus once the status item has finished handling the click.
    {
        let popover = popover.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(150)).await;
            let _ = popover.set_focus();
        });
    }
    refresh(app);
}

fn place_popover(popover: &tauri::WebviewWindow, rect: &tauri::Rect) {
    let scale = popover.scale_factor().unwrap_or(1.0);
    let position = rect.position.to_logical::<f64>(scale);
    let size = rect.size.to_logical::<f64>(scale);
    let x = position.x + size.width / 2.0 - POPOVER_WIDTH / 2.0;
    let y = position.y + size.height + 4.0;
    let _ = popover.set_position(LogicalPosition::new(x, y));
}

/// How long Six's own banner stays under the menu bar before it slips away.
const BANNER_SECS: u64 = 25;

/// Show a nudge as Six's own banner: the popover, under the tray, without taking focus,
/// gone again after a while unless the user is on it.
pub fn show_nudge(app: &AppHandle, nudge: &crate::domain::nudges::Nudge) {
    present_banner(app);
    let _ = app.emit_to(POPOVER, "popover_nudge", nudge);
}

/// The popover moved on to the next queued nudge: another spell on screen for it.
pub fn show_banner(app: &AppHandle) {
    present_banner(app);
}

/// Put the popover under the tray without taking focus and let it slip away after a
/// while unless the user is on it. Every call restarts that clock.
fn present_banner(app: &AppHandle) {
    let Some(tray) = app.try_state::<Tray>() else {
        return;
    };
    let Some(popover) = app.get_webview_window(POPOVER) else {
        return;
    };
    if let Ok(Some(rect)) = tray.icon.rect() {
        place_popover(&popover, &rect);
    }
    *tray.popover_shown_at.lock().unwrap() = Some(Instant::now());
    let generation = {
        let mut g = tray.generation.lock().unwrap();
        *g += 1;
        *g
    };
    let _ = popover.show();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(BANNER_SECS)).await;
        let still_ours = app
            .try_state::<Tray>()
            .is_some_and(|t| *t.generation.lock().unwrap() == generation);
        let focused = app
            .get_webview_window(POPOVER)
            .and_then(|w| w.is_focused().ok())
            .unwrap_or(false);
        if still_ours && !focused {
            hide_popover(&app);
        }
    });
}

pub fn hide_popover(app: &AppHandle) {
    if let Some(popover) = app.get_webview_window(POPOVER) {
        if popover.is_visible().unwrap_or(false) {
            let _ = popover.hide();
        }
    }
    if let Some(tray) = app.try_state::<Tray>() {
        *tray.popover_hidden_at.lock().unwrap() = Some(Instant::now());
    }
}

/// Show and focus the main window, optionally navigating it to a view.
pub fn show_main(app: &AppHandle, target: Option<serde_json::Value>) {
    hide_popover(app);
    let _ = app.set_activation_policy(ActivationPolicy::Regular);
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        if let Some(target) = target {
            let _ = app.emit_to(MAIN, "navigate", target);
        }
    }
}

/// The main window was closed: live in the menu bar, without a Dock icon.
pub fn main_closed(app: &AppHandle) {
    let _ = app.set_activation_policy(ActivationPolicy::Accessory);
}
