//! Nudge planning: which silent notifications should be pending right now, and when.
//! Pure. The scheduler reconciles this list against the OS (one pending per kind,
//! re-scheduling replaces) and, while the window is focused, shows them in-app instead.

use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;

use super::model::EndedReason;
use super::plan::Day;
use super::pomodoro::PomodoroPhase;
use super::settings::Settings;
use super::timing;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NudgeKind {
    EveningRitual,
    CheckIn,
    BreakOver,
    UnplannedMorning,
    EndOfDay,
    PomodoroDone,
}

impl NudgeKind {
    pub const ALL: [NudgeKind; 6] = [
        NudgeKind::EveningRitual,
        NudgeKind::CheckIn,
        NudgeKind::BreakOver,
        NudgeKind::UnplannedMorning,
        NudgeKind::EndOfDay,
        NudgeKind::PomodoroDone,
    ];

    /// Stable OS notification id: one slot per kind, so re-scheduling replaces.
    pub fn id(self) -> i32 {
        match self {
            NudgeKind::EveningRitual => 601,
            NudgeKind::CheckIn => 602,
            NudgeKind::BreakOver => 603,
            NudgeKind::UnplannedMorning => 604,
            NudgeKind::EndOfDay => 605,
            NudgeKind::PomodoroDone => 606,
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            NudgeKind::EveningRitual => "evening_ritual",
            NudgeKind::CheckIn => "check_in",
            NudgeKind::BreakOver => "break_over",
            NudgeKind::UnplannedMorning => "unplanned_morning",
            NudgeKind::EndOfDay => "end_of_day",
            NudgeKind::PomodoroDone => "pomodoro_done",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        NudgeKind::ALL.into_iter().find(|k| k.key() == s)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NudgeAction {
    /// Stable action id shared by the OS button and the in-app banner.
    pub id: &'static str,
    pub label: String,
}

fn act(id: &'static str, label: impl Into<String>) -> NudgeAction {
    NudgeAction {
        id,
        label: label.into(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Nudge {
    pub kind: NudgeKind,
    pub due: DateTime<Utc>,
    pub title: String,
    pub body: String,
    pub actions: Vec<NudgeAction>,
    /// The task the nudge is about, if any (for the actions).
    pub task_id: Option<String>,
}

/// Everything the planner needs, resolved by the caller (clock, settings, today's day).
pub struct NudgeInput<'a> {
    pub now: DateTime<Utc>,
    /// The rollover instant that began today, and the next one.
    pub today_start: DateTime<Utc>,
    pub tomorrow_start: DateTime<Utc>,
    /// Today's and tomorrow's evening-hour instants.
    pub evening_today: DateTime<Utc>,
    pub evening_tomorrow: DateTime<Utc>,
    pub settings: &'a Settings,
    pub today: Option<&'a Day>,
    pub tomorrow_locked: bool,
    /// "Not before" times set by Later / Keep going / 5 more.
    pub snoozes: &'a HashMap<NudgeKind, DateTime<Utc>>,
}

/// A "not before" time set by Later, Keep going or 5 more. Task nudges carry the session
/// (or break) they were given on, so a snooze never outlives it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snooze {
    pub until: DateTime<Utc>,
    pub scope: Option<String>,
}

/// The snoozes that still apply to `today`: unscoped ones always; a check-in snooze only
/// while the session it was set on is still the open one; a break-over snooze only while
/// the break it was set on is still the current task's last break.
pub fn scope_snoozes(
    raw: &HashMap<NudgeKind, Snooze>,
    today: Option<&Day>,
) -> HashMap<NudgeKind, DateTime<Utc>> {
    raw.iter()
        .filter(|(kind, s)| {
            let Some(scope) = s.scope.as_deref() else {
                return true;
            };
            let Some(day) = today else {
                return false;
            };
            match kind {
                NudgeKind::CheckIn => day.open_session().is_some_and(|s| s.id == scope),
                NudgeKind::BreakOver => day
                    .current_task()
                    .and_then(|t| day.last_closed_session(&t.id))
                    .is_some_and(|s| s.id == scope),
                _ => true,
            }
        })
        .map(|(kind, s)| (*kind, s.until))
        .collect()
}

const UNPLANNED_AFTER: Duration = Duration::hours(3);

pub fn plan(input: &NudgeInput) -> Vec<Nudge> {
    let mut out = Vec::new();
    let snooze = |kind: NudgeKind| input.snoozes.get(&kind).copied().filter(|t| *t > input.now);
    let today_locked = input.today.is_some_and(|d| d.plan.is_locked());

    // Evening ritual: daily at the evening hour, only while tomorrow is unplanned.
    if !input.tomorrow_locked {
        let natural = if input.evening_today > input.now {
            input.evening_today
        } else {
            input.evening_tomorrow
        };
        out.push(Nudge {
            kind: NudgeKind::EveningRitual,
            due: snooze(NudgeKind::EveningRitual).unwrap_or(natural),
            title: "Set tomorrow's six.".into(),
            body: "Plan it now so morning starts clear.".into(),
            actions: vec![act("plan", "Plan"), act("later", "Later")],
            task_id: None,
        });
    }

    if let Some(day) = input.today.filter(|d| d.plan.is_locked()) {
        let current = day.current_task();

        // Check-in: some time after a session starts, unless a pomodoro carries the rhythm.
        if let (Some(task), Some(session)) = (current, day.open_session()) {
            let (phase, _) = day.pomodoro_state(input.now);
            let pomodoro_running =
                input.settings.pomodoro_enabled && phase == PomodoroPhase::Running;
            if !pomodoro_running {
                let natural = session.started_at
                    + Duration::minutes(i64::from(input.settings.checkin_minutes));
                let due = snooze(NudgeKind::CheckIn).or(Some(natural).filter(|t| *t > input.now));
                if let Some(due) = due {
                    let elapsed = day.focus_seconds(&task.id, due);
                    out.push(Nudge {
                        kind: NudgeKind::CheckIn,
                        due,
                        title: format!("Still on {}?", task.title),
                        body: format!("{} so far.", timing::describe(elapsed)),
                        actions: vec![
                            act("done", "Done"),
                            act("keep_going", "Keep going"),
                            act("take_break", "Take 5"),
                        ],
                        task_id: Some(task.id.clone()),
                    });
                }
            }
        }

        // Break over: after "Take 5" (or the long break after a set).
        if let Some(task) = current.filter(|t| t.status == super::model::TaskStatus::Paused) {
            let last = day.last_closed_session(&task.id);
            if let Some(s) = last.filter(|s| s.ended_reason == Some(EndedReason::Break)) {
                let completed = day.pomodoros_completed(None);
                let set =
                    usize::try_from(input.settings.pomodoros_before_long_break.max(1)).unwrap_or(4);
                let long = input.settings.pomodoro_enabled && completed > 0 && completed % set == 0;
                let minutes = if long {
                    input.settings.long_break_minutes
                } else {
                    input.settings.break_minutes
                };
                let natural =
                    s.ended_at.unwrap_or(input.now) + Duration::minutes(i64::from(minutes));
                let due = snooze(NudgeKind::BreakOver).or(Some(natural).filter(|t| *t > input.now));
                if let Some(due) = due {
                    out.push(Nudge {
                        kind: NudgeKind::BreakOver,
                        due,
                        title: format!("Back to {}?", task.title),
                        body: String::new(),
                        actions: vec![act("resume", "Resume"), act("five_more", "5 more")],
                        task_id: Some(task.id.clone()),
                    });
                }
            }
        }

        // End of day: at the evening hour, while today's list is unreviewed.
        if day.plan.reviewed_at.is_none() {
            let due = snooze(NudgeKind::EndOfDay)
                .or(Some(input.evening_today).filter(|t| *t > input.now));
            if let Some(due) = due {
                out.push(Nudge {
                    kind: NudgeKind::EndOfDay,
                    due,
                    title: format!(
                        "{} of {} done, {} focused.",
                        day.done_count(),
                        day.tasks.len(),
                        timing::describe(day.total_focus_seconds(due))
                    ),
                    body: "Review today?".into(),
                    actions: vec![act("review", "Review"), act("later", "Later")],
                    task_id: None,
                });
            }
        }

        // Pomodoro done: at the planned end of the running pomodoro.
        if input.settings.pomodoro_enabled {
            let (phase, pomodoro) = day.pomodoro_state(input.now);
            if let (PomodoroPhase::Running, Some(p), Some(task)) = (phase, pomodoro, current) {
                let completed = day.pomodoros_completed(None) + 1;
                let set =
                    usize::try_from(input.settings.pomodoros_before_long_break.max(1)).unwrap_or(4);
                let long = completed % set == 0;
                let (body, label) = if long {
                    (
                        format!("Long break, {} minutes?", input.settings.long_break_minutes),
                        format!("Take {}", input.settings.long_break_minutes),
                    )
                } else {
                    ("Take 5?".to_string(), "Take 5".to_string())
                };
                out.push(Nudge {
                    kind: NudgeKind::PomodoroDone,
                    due: p.planned_end(),
                    title: "Pomodoro done.".into(),
                    body,
                    actions: vec![act("take_break", label), act("one_more", "One more")],
                    task_id: Some(task.id.clone()),
                });
            }
        }
    }

    // Unplanned morning: three hours into a day with no locked list.
    let morning = if !today_locked && input.today_start + UNPLANNED_AFTER > input.now {
        Some(input.today_start + UNPLANNED_AFTER)
    } else if !input.tomorrow_locked {
        Some(input.tomorrow_start + UNPLANNED_AFTER)
    } else {
        None
    };
    if let Some(due) = morning {
        out.push(Nudge {
            kind: NudgeKind::UnplannedMorning,
            due: snooze(NudgeKind::UnplannedMorning).unwrap_or(due),
            title: "No list for today yet.".into(),
            body: "Six tasks, most important first.".into(),
            actions: vec![act("plan", "Plan now")],
            task_id: None,
        });
    }

    out.sort_by_key(|n| n.due);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::plan::{Ctx, PauseReason, TaskInput};
    use chrono::{NaiveDate, TimeZone};

    fn at(d: u32, h: u32, m: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, d, h, m, 0).unwrap()
    }

    fn locked(n: usize) -> Day {
        let c = Ctx::new(
            at(3, 9, 0),
            NaiveDate::from_ymd_opt(2026, 9, 3).unwrap(),
            "dev",
        );
        let inputs = (1..=n)
            .map(|i| TaskInput {
                title: format!("Task {i}"),
                ..Default::default()
            })
            .collect();
        let mut day = Day::draft(NaiveDate::from_ymd_opt(2026, 9, 3).unwrap(), inputs, &c).unwrap();
        day.lock(&c).unwrap();
        day
    }

    fn ctx(h: u32, m: u32) -> Ctx<'static> {
        Ctx::new(
            at(3, h, m),
            NaiveDate::from_ymd_opt(2026, 9, 3).unwrap(),
            "dev",
        )
    }

    struct Fixture {
        settings: Settings,
        snoozes: HashMap<NudgeKind, DateTime<Utc>>,
    }

    impl Fixture {
        fn new() -> Self {
            Self {
                settings: Settings::default(),
                snoozes: HashMap::new(),
            }
        }
        fn input<'a>(
            &'a self,
            now: DateTime<Utc>,
            today: Option<&'a Day>,
            tomorrow_locked: bool,
        ) -> NudgeInput<'a> {
            NudgeInput {
                now,
                today_start: at(3, 5, 0),
                tomorrow_start: at(4, 5, 0),
                evening_today: at(3, 18, 0),
                evening_tomorrow: at(4, 18, 0),
                settings: &self.settings,
                today,
                tomorrow_locked,
                snoozes: &self.snoozes,
            }
        }
    }

    fn find(nudges: &[Nudge], kind: NudgeKind) -> Option<&Nudge> {
        nudges.iter().find(|n| n.kind == kind)
    }

    #[test]
    fn evening_ritual_only_while_tomorrow_is_unplanned_and_moves_to_tomorrow_after_the_hour() {
        let f = Fixture::new();
        let day = locked(2);
        let n = plan(&f.input(at(3, 9, 0), Some(&day), false));
        assert_eq!(
            find(&n, NudgeKind::EveningRitual).unwrap().due,
            at(3, 18, 0)
        );
        let n = plan(&f.input(at(3, 19, 0), Some(&day), false));
        assert_eq!(
            find(&n, NudgeKind::EveningRitual).unwrap().due,
            at(4, 18, 0)
        );
        let n = plan(&f.input(at(3, 9, 0), Some(&day), true));
        assert!(find(&n, NudgeKind::EveningRitual).is_none());
    }

    #[test]
    fn later_snoozes_the_ritual_by_the_given_time() {
        let mut f = Fixture::new();
        f.snoozes.insert(NudgeKind::EveningRitual, at(3, 18, 30));
        let n = plan(&f.input(at(3, 18, 5), None, false));
        assert_eq!(
            find(&n, NudgeKind::EveningRitual).unwrap().due,
            at(3, 18, 30)
        );
    }

    #[test]
    fn check_in_fires_after_the_interval_and_is_rearmed_by_keep_going_and_by_resume() {
        let mut f = Fixture::new();
        let mut day = locked(2);
        let t1 = day.tasks[0].id.clone();
        // A pomodoro is not running (none started), so the check-in applies.
        let n = plan(&f.input(at(3, 9, 30), Some(&day), true));
        let c = find(&n, NudgeKind::CheckIn).unwrap();
        assert_eq!(c.due, at(3, 10, 15));
        assert_eq!(c.title, "Still on Task 1?");
        assert_eq!(c.body, "1h 15m so far.");
        assert_eq!(
            c.actions.iter().map(|a| a.id).collect::<Vec<_>>(),
            ["done", "keep_going", "take_break"]
        );

        // Past due with no snooze: nothing pending (it already fired).
        let n = plan(&f.input(at(3, 11, 0), Some(&day), true));
        assert!(find(&n, NudgeKind::CheckIn).is_none());
        // "Keep going" re-arms from now.
        f.snoozes.insert(NudgeKind::CheckIn, at(3, 12, 15));
        let n = plan(&f.input(at(3, 11, 0), Some(&day), true));
        assert_eq!(find(&n, NudgeKind::CheckIn).unwrap().due, at(3, 12, 15));
        f.snoozes.clear();

        // Resume starts a new session: the interval restarts.
        day.pause(&t1, PauseReason::Break, &ctx(11, 0)).unwrap();
        day.resume(&t1, &ctx(11, 10)).unwrap();
        let n = plan(&f.input(at(3, 11, 11), Some(&day), true));
        assert_eq!(find(&n, NudgeKind::CheckIn).unwrap().due, at(3, 12, 25));
        assert_eq!(find(&n, NudgeKind::CheckIn).unwrap().body, "3h 15m so far.");
    }

    #[test]
    fn a_running_pomodoro_replaces_the_check_in() {
        let f = Fixture::new();
        let mut day = locked(1);
        let t1 = day.tasks[0].id.clone();
        day.start_pomodoro(&t1, 1500, &ctx(9, 0)).unwrap();
        let n = plan(&f.input(at(3, 9, 5), Some(&day), true));
        assert!(find(&n, NudgeKind::CheckIn).is_none());
        let p = find(&n, NudgeKind::PomodoroDone).unwrap();
        assert_eq!(p.due, at(3, 9, 25));
        assert_eq!(p.body, "Take 5?");
        assert_eq!(p.actions[0].label, "Take 5");
        assert_eq!(p.actions[1].id, "one_more");
    }

    #[test]
    fn the_fourth_pomodoro_offers_the_long_break() {
        let f = Fixture::new();
        let mut day = locked(1);
        let t1 = day.tasks[0].id.clone();
        for i in 0..3 {
            day.start_pomodoro(&t1, 60, &ctx(9, i * 2)).unwrap();
            day.settle_pomodoros(&ctx(9, i * 2 + 1));
        }
        assert_eq!(day.pomodoros_completed(None), 3);
        day.start_pomodoro(&t1, 60, &ctx(9, 10)).unwrap();
        let n = plan(&f.input(at(3, 9, 10), Some(&day), true));
        let p = find(&n, NudgeKind::PomodoroDone).unwrap();
        assert_eq!(p.body, "Long break, 15 minutes?");
        assert_eq!(p.actions[0].label, "Take 15");
    }

    #[test]
    fn break_over_follows_take_five_and_stretches_after_a_set() {
        let f = Fixture::new();
        let mut day = locked(1);
        let t1 = day.tasks[0].id.clone();
        day.pause(&t1, PauseReason::Break, &ctx(10, 0)).unwrap();
        let n = plan(&f.input(at(3, 10, 1), Some(&day), true));
        let b = find(&n, NudgeKind::BreakOver).unwrap();
        assert_eq!(b.due, at(3, 10, 5));
        assert_eq!(b.title, "Back to Task 1?");
        assert_eq!(
            b.actions.iter().map(|a| a.id).collect::<Vec<_>>(),
            ["resume", "five_more"]
        );
        // A plain pause is not a break.
        day.resume(&t1, &ctx(10, 6)).unwrap();
        day.pause(&t1, PauseReason::Paused, &ctx(10, 7)).unwrap();
        let n = plan(&f.input(at(3, 10, 8), Some(&day), true));
        assert!(find(&n, NudgeKind::BreakOver).is_none());

        // After four completed pomodoros the break is the long one.
        let mut day = locked(1);
        let t1 = day.tasks[0].id.clone();
        for i in 0..4 {
            day.start_pomodoro(&t1, 60, &ctx(9, i * 2)).unwrap();
            day.settle_pomodoros(&ctx(9, i * 2 + 1));
        }
        day.pause(&t1, PauseReason::Break, &ctx(10, 0)).unwrap();
        let n = plan(&f.input(at(3, 10, 1), Some(&day), true));
        assert_eq!(find(&n, NudgeKind::BreakOver).unwrap().due, at(3, 10, 15));
    }

    #[test]
    fn end_of_day_reports_the_facts_and_stops_once_reviewed() {
        let f = Fixture::new();
        let mut day = locked(3);
        let t1 = day.tasks[0].id.clone();
        day.complete(&t1, &ctx(10, 0)).unwrap();
        let n = plan(&f.input(at(3, 10, 30), Some(&day), true));
        let e = find(&n, NudgeKind::EndOfDay).unwrap();
        assert_eq!(e.due, at(3, 18, 0));
        assert_eq!(e.title, "1 of 3 done, 9h 0m focused.");
        assert_eq!(e.body, "Review today?");
        day.complete_review(None, vec![], &ctx(18, 30)).unwrap();
        let n = plan(&f.input(at(3, 18, 31), Some(&day), true));
        assert!(find(&n, NudgeKind::EndOfDay).is_none());
    }

    #[test]
    fn unplanned_morning_is_three_hours_after_the_rollover() {
        let f = Fixture::new();
        let n = plan(&f.input(at(3, 6, 0), None, false));
        assert_eq!(
            find(&n, NudgeKind::UnplannedMorning).unwrap().due,
            at(3, 8, 0)
        );
        // Past eight with no list: the next chance is tomorrow morning.
        let n = plan(&f.input(at(3, 9, 0), None, false));
        assert_eq!(
            find(&n, NudgeKind::UnplannedMorning).unwrap().due,
            at(4, 8, 0)
        );
        // Today planned, tomorrow planned: nothing.
        let day = locked(1);
        let n = plan(&f.input(at(3, 9, 0), Some(&day), true));
        assert!(find(&n, NudgeKind::UnplannedMorning).is_none());
    }

    #[test]
    fn one_pending_per_kind_sorted_by_time() {
        let f = Fixture::new();
        let day = locked(2);
        let n = plan(&f.input(at(3, 9, 30), Some(&day), false));
        let kinds: Vec<NudgeKind> = n.iter().map(|x| x.kind).collect();
        assert_eq!(
            kinds,
            [
                NudgeKind::CheckIn,
                NudgeKind::EveningRitual,
                NudgeKind::EndOfDay,
                NudgeKind::UnplannedMorning
            ]
        );
        let mut sorted = n.iter().map(|x| x.due).collect::<Vec<_>>();
        sorted.dedup();
        assert!(n.windows(2).all(|w| w[0].due <= w[1].due));
    }

    #[test]
    fn a_check_in_snooze_dies_with_the_session_it_was_given_on() {
        let mut day = locked(2);
        let t1 = day.tasks[0].id.clone();
        let sid = day.open_session().unwrap().id.clone();
        let mut raw = HashMap::new();
        raw.insert(
            NudgeKind::CheckIn,
            Snooze {
                until: at(3, 11, 30),
                scope: Some(sid),
            },
        );
        raw.insert(
            NudgeKind::EveningRitual,
            Snooze {
                until: at(3, 18, 30),
                scope: None,
            },
        );
        let scoped = scope_snoozes(&raw, Some(&day));
        assert_eq!(scoped.get(&NudgeKind::CheckIn), Some(&at(3, 11, 30)));

        // Task 1 done at 10:20: task 2's session is another one, so the snooze is gone
        // and task 2 gets its own 75 minutes.
        day.complete(&t1, &ctx(10, 20)).unwrap();
        let scoped = scope_snoozes(&raw, Some(&day));
        assert!(scoped.get(&NudgeKind::CheckIn).is_none());
        assert_eq!(scoped.get(&NudgeKind::EveningRitual), Some(&at(3, 18, 30)));
        let f = Fixture {
            settings: Settings::default(),
            snoozes: scoped,
        };
        let n = plan(&f.input(at(3, 10, 21), Some(&day), true));
        assert_eq!(find(&n, NudgeKind::CheckIn).unwrap().due, at(3, 11, 35));
        assert!(scope_snoozes(&raw, None).get(&NudgeKind::CheckIn).is_none());
    }

    #[test]
    fn five_more_belongs_to_one_break() {
        let mut day = locked(1);
        let t1 = day.tasks[0].id.clone();
        day.pause(&t1, PauseReason::Break, &ctx(10, 0)).unwrap();
        let brk = day.last_closed_session(&t1).unwrap().id.clone();
        let mut raw = HashMap::new();
        raw.insert(
            NudgeKind::BreakOver,
            Snooze {
                until: at(3, 10, 10),
                scope: Some(brk),
            },
        );
        assert_eq!(
            scope_snoozes(&raw, Some(&day)).get(&NudgeKind::BreakOver),
            Some(&at(3, 10, 10))
        );
        day.resume(&t1, &ctx(10, 6)).unwrap();
        day.pause(&t1, PauseReason::Break, &ctx(10, 30)).unwrap();
        assert!(
            scope_snoozes(&raw, Some(&day))
                .get(&NudgeKind::BreakOver)
                .is_none(),
            "a later break is its own"
        );
    }
}
