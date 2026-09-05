//! Scenario tests for the state machine. Every test ends with `ok(&day)`, which checks
//! all invariants, so any transition that breaks one fails loudly.

use chrono::{DateTime, NaiveDate, TimeZone, Utc};

use super::plan::Decision;
use super::*;

const DEV: &str = "test-device";
const TITLES: [&str; 7] = ["One", "Two", "Three", "Four", "Five", "Six", "Seven"];

fn date(d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, d).unwrap()
}

fn at(d: u32, h: u32, m: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, d, h, m, 0).unwrap()
}

/// A context whose "today" is the same calendar day as `now`.
fn ctx(d: u32, h: u32, m: u32) -> Ctx<'static> {
    Ctx::new(at(d, h, m), date(d), DEV)
}

fn inputs(titles: &[&str]) -> Vec<TaskInput> {
    titles
        .iter()
        .map(|t| TaskInput {
            title: (*t).to_string(),
            ..Default::default()
        })
        .collect()
}

fn locked_today(n: usize) -> (Day, Ctx<'static>) {
    let c = ctx(3, 9, 0);
    let mut day = Day::draft(date(3), inputs(&TITLES[..n]), &c).unwrap();
    day.lock(&c).unwrap();
    ok(&day);
    (day, c)
}

fn id(day: &Day, pos: u8) -> String {
    day.tasks[usize::from(pos) - 1].id.clone()
}

fn status(day: &Day, pos: u8) -> TaskStatus {
    day.tasks[usize::from(pos) - 1].status
}

fn kinds(day: &Day) -> Vec<EventKind> {
    day.pending_events.iter().map(|e| e.kind).collect()
}

fn ok(day: &Day) {
    day.check_invariants().unwrap();
}

// ----- drafting and the six ceiling -------------------------------------------------

#[test]
fn six_is_the_ceiling_when_drafting() {
    let c = ctx(3, 9, 0);
    assert_eq!(
        Day::draft(date(3), inputs(&TITLES), &c).unwrap_err(),
        DomainError::TooManyTasks
    );
    let day = Day::draft(date(3), inputs(&TITLES[..6]), &c).unwrap();
    assert_eq!(day.tasks.len(), 6);
    ok(&day);
}

#[test]
fn six_is_the_ceiling_when_editing() {
    let (mut day, c) = locked_today(6);
    assert_eq!(
        day.edit(inputs(&TITLES), &c).unwrap_err(),
        DomainError::TooManyTasks
    );
    assert_eq!(day.tasks.len(), 6);
    ok(&day);
}

#[test]
fn draft_positions_tasks_in_order_and_leaves_them_planned() {
    let c = ctx(3, 9, 0);
    let day = Day::draft(date(3), inputs(&TITLES[..3]), &c).unwrap();
    assert_eq!(
        day.tasks.iter().map(|t| t.position).collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    assert!(day.tasks.iter().all(|t| t.status == TaskStatus::Planned));
    assert!(!day.plan.is_locked());
    assert!(day.sessions.is_empty());
    ok(&day);
}

#[test]
fn draft_rejects_empty_titles_and_empty_lists() {
    let c = ctx(3, 9, 0);
    assert_eq!(
        Day::draft(date(3), inputs(&["One", "   "]), &c).unwrap_err(),
        DomainError::EmptyTitle
    );
    assert_eq!(
        Day::draft(date(3), vec![], &c).unwrap_err(),
        DomainError::NoTasks
    );
}

#[test]
fn draft_trims_titles_and_drops_blank_notes() {
    let c = ctx(3, 9, 0);
    let day = Day::draft(
        date(3),
        vec![TaskInput {
            title: "  Write  ".into(),
            note: Some("  ".into()),
            ..Default::default()
        }],
        &c,
    )
    .unwrap();
    assert_eq!(day.tasks[0].title, "Write");
    assert_eq!(day.tasks[0].note, None);
}

// ----- locking ------------------------------------------------------------------------

#[test]
fn locking_todays_list_activates_task_one_and_starts_a_session() {
    let (day, c) = locked_today(3);
    assert_eq!(status(&day, 1), TaskStatus::Active);
    assert_eq!(status(&day, 2), TaskStatus::Planned);
    let s = day.open_session().expect("task 1 has a running session");
    assert_eq!(s.task_id, id(&day, 1));
    assert_eq!(s.started_at, c.now);
    assert_eq!(kinds(&day), vec![EventKind::Locked, EventKind::Activated]);
}

#[test]
fn locking_tomorrows_list_activates_nothing() {
    let c = ctx(3, 20, 0);
    let mut day = Day::draft(date(4), inputs(&TITLES[..3]), &c).unwrap();
    day.lock(&c).unwrap();
    assert!(day.tasks.iter().all(|t| t.status == TaskStatus::Planned));
    assert!(day.sessions.is_empty());
    assert_eq!(kinds(&day), vec![EventKind::Locked]);
    ok(&day);
}

#[test]
fn opening_the_app_on_the_lists_day_activates_task_one() {
    // Planned last night, opened this morning: ensure_active is what the read path runs.
    let mut day = Day::draft(date(4), inputs(&TITLES[..2]), &ctx(3, 20, 0)).unwrap();
    day.lock(&ctx(3, 20, 0)).unwrap();
    let morning = ctx(4, 8, 30);
    let activated = day.ensure_active(&morning);
    assert_eq!(activated, Some(id(&day, 1)));
    assert_eq!(status(&day, 1), TaskStatus::Active);
    assert_eq!(day.open_session().unwrap().started_at, morning.now);
    // A second read does nothing.
    assert_eq!(day.ensure_active(&morning), None);
    ok(&day);
}

#[test]
fn a_list_cannot_be_locked_twice_or_started_before_locking() {
    let c = ctx(3, 9, 0);
    let mut day = Day::draft(date(3), inputs(&TITLES[..2]), &c).unwrap();
    assert_eq!(
        day.activate(&id(&day, 1), false, &c).unwrap_err(),
        DomainError::NotLocked
    );
    day.lock(&c).unwrap();
    assert_eq!(day.lock(&c).unwrap_err(), DomainError::AlreadyLocked);
}

// ----- completing in order --------------------------------------------------------------

#[test]
fn completing_the_active_task_activates_the_next_one() {
    let (mut day, _) = locked_today(3);
    let later = ctx(3, 10, 0);
    day.complete(&id(&day, 1), &later).unwrap();
    assert_eq!(status(&day, 1), TaskStatus::Done);
    assert_eq!(day.tasks[0].completed_at, Some(later.now));
    assert_eq!(status(&day, 2), TaskStatus::Active);
    let first = &day.sessions[0];
    assert_eq!(first.ended_at, Some(later.now));
    assert_eq!(first.ended_reason, Some(EndedReason::Done));
    let second = day.open_session().unwrap();
    assert_eq!(second.task_id, id(&day, 2));
    assert_eq!(second.started_at, later.now);
    assert_eq!(day.done_count(), 1);
    assert!(kinds(&day).ends_with(&[EventKind::Completed, EventKind::Activated]));
    ok(&day);
}

#[test]
fn completing_every_task_ends_with_nothing_active() {
    let (mut day, c) = locked_today(2);
    day.complete(&id(&day, 1), &c).unwrap();
    day.complete(&id(&day, 2), &c).unwrap();
    assert!(day.all_done());
    assert!(day.current_task().is_none());
    assert!(day.open_session().is_none());
    ok(&day);
}

#[test]
fn only_the_current_task_can_be_completed() {
    let (mut day, c) = locked_today(3);
    assert_eq!(
        day.complete(&id(&day, 2), &c).unwrap_err(),
        DomainError::InvalidTransition {
            status: TaskStatus::Planned,
            action: "complete"
        }
    );
    ok(&day);
}

// ----- skipping ahead (override) --------------------------------------------------------

#[test]
fn skipping_ahead_needs_an_override_and_changes_nothing_without_one() {
    let (mut day, c) = locked_today(3);
    let before = day.clone();
    assert_eq!(
        day.activate(&id(&day, 3), false, &c).unwrap_err(),
        DomainError::NeedsOverride
    );
    assert_eq!(day, before);
}

#[test]
fn skipping_ahead_with_override_is_logged_and_puts_the_earlier_task_back_to_planned() {
    let (mut day, _) = locked_today(3);
    let c = ctx(3, 9, 30);
    day.activate(&id(&day, 3), true, &c).unwrap();
    assert_eq!(status(&day, 1), TaskStatus::Planned);
    assert_eq!(status(&day, 3), TaskStatus::Active);
    let superseded = day
        .sessions
        .iter()
        .find(|s| s.task_id == id(&day, 1))
        .unwrap();
    assert_eq!(superseded.ended_reason, Some(EndedReason::Superseded));
    assert_eq!(superseded.ended_at, Some(c.now));
    assert_eq!(day.open_session().unwrap().task_id, id(&day, 3));
    assert!(kinds(&day).ends_with(&[EventKind::Overridden, EventKind::Activated]));
    ok(&day);

    // Finishing the skipped-to task returns to the lowest unfinished position.
    day.complete(&id(&day, 3), &ctx(3, 11, 0)).unwrap();
    assert_eq!(status(&day, 1), TaskStatus::Active);
    assert_eq!(status(&day, 2), TaskStatus::Planned);
    ok(&day);
}

#[test]
fn skipping_past_a_paused_task_is_also_an_override() {
    let (mut day, c) = locked_today(3);
    day.pause(&id(&day, 1), PauseReason::Break, &c).unwrap();
    assert_eq!(
        day.activate(&id(&day, 2), false, &c).unwrap_err(),
        DomainError::NeedsOverride
    );
    day.activate(&id(&day, 2), true, &c).unwrap();
    assert_eq!(status(&day, 1), TaskStatus::Planned);
    assert_eq!(status(&day, 2), TaskStatus::Active);
    ok(&day);
}

#[test]
fn starting_an_earlier_task_is_never_an_override() {
    let (mut day, c) = locked_today(3);
    day.complete(&id(&day, 1), &c).unwrap(); // 2 active
    day.defer(&id(&day, 2), &c).unwrap(); // 3 active
    day.reopen(&id(&day, 2), &c).unwrap(); // 2 planned again, 3 still active
    assert_eq!(status(&day, 3), TaskStatus::Active);
    day.activate(&id(&day, 2), false, &c).unwrap();
    assert_eq!(status(&day, 2), TaskStatus::Active);
    assert_eq!(status(&day, 3), TaskStatus::Planned);
    assert!(!kinds(&day).contains(&EventKind::Overridden));
    ok(&day);
}

#[test]
fn only_planned_tasks_can_be_started() {
    let (mut day, c) = locked_today(2);
    assert_eq!(
        day.activate(&id(&day, 1), false, &c).unwrap_err(),
        DomainError::InvalidTransition {
            status: TaskStatus::Active,
            action: "start"
        }
    );
}

// ----- pausing, breaks, resuming ---------------------------------------------------------

#[test]
fn take_five_and_resume_record_separate_sessions() {
    let (mut day, _) = locked_today(1);
    let t1 = id(&day, 1);
    day.pause(&t1, PauseReason::Break, &ctx(3, 10, 0)).unwrap();
    assert_eq!(status(&day, 1), TaskStatus::Paused);
    assert!(day.open_session().is_none());
    assert_eq!(day.sessions[0].ended_reason, Some(EndedReason::Break));
    assert_eq!(
        day.focus_seconds(&t1, at(3, 10, 3)),
        3600,
        "frozen while paused"
    );

    day.resume(&t1, &ctx(3, 10, 5)).unwrap();
    assert_eq!(status(&day, 1), TaskStatus::Active);
    assert_eq!(day.sessions.len(), 2);
    assert_eq!(day.open_session().unwrap().started_at, at(3, 10, 5));
    assert_eq!(day.focus_seconds(&t1, at(3, 10, 30)), 3600 + 25 * 60);
    assert!(kinds(&day).ends_with(&[EventKind::Paused, EventKind::Resumed]));
    ok(&day);
}

#[test]
fn a_plain_pause_uses_the_paused_reason() {
    let (mut day, c) = locked_today(1);
    day.pause(&id(&day, 1), PauseReason::Paused, &c).unwrap();
    assert_eq!(day.sessions[0].ended_reason, Some(EndedReason::Paused));
}

#[test]
fn pause_and_resume_reject_the_wrong_states() {
    let (mut day, c) = locked_today(2);
    assert_eq!(
        day.pause(&id(&day, 2), PauseReason::Break, &c).unwrap_err(),
        DomainError::InvalidTransition {
            status: TaskStatus::Planned,
            action: "pause"
        }
    );
    assert_eq!(
        day.resume(&id(&day, 1), &c).unwrap_err(),
        DomainError::InvalidTransition {
            status: TaskStatus::Active,
            action: "resume"
        }
    );
}

#[test]
fn a_paused_task_can_be_completed_directly() {
    let (mut day, c) = locked_today(2);
    day.pause(&id(&day, 1), PauseReason::Break, &c).unwrap();
    day.complete(&id(&day, 1), &c).unwrap();
    assert_eq!(status(&day, 1), TaskStatus::Done);
    assert_eq!(status(&day, 2), TaskStatus::Active);
    ok(&day);
}

// ----- deferring and skipping -------------------------------------------------------------

#[test]
fn deferring_closes_the_session_activates_the_next_and_carries_over() {
    let (mut day, c) = locked_today(3);
    day.defer(&id(&day, 1), &c).unwrap();
    assert_eq!(status(&day, 1), TaskStatus::Deferred);
    assert_eq!(day.sessions[0].ended_reason, Some(EndedReason::Deferred));
    assert_eq!(status(&day, 2), TaskStatus::Active);
    let carried: Vec<&str> = day.carryover().iter().map(|t| t.title.as_str()).collect();
    assert_eq!(
        carried,
        vec!["One", "Two", "Three"],
        "deferred and unfinished both carry"
    );
    assert!(kinds(&day).contains(&EventKind::Deferred));
    ok(&day);
}

#[test]
fn deferring_a_planned_task_is_allowed_for_the_review() {
    let (mut day, c) = locked_today(3);
    day.defer(&id(&day, 3), &c).unwrap();
    assert_eq!(status(&day, 3), TaskStatus::Deferred);
    assert_eq!(
        status(&day, 1),
        TaskStatus::Active,
        "the slot holder is untouched"
    );
    ok(&day);
}

#[test]
fn skipping_drops_a_task_and_it_never_carries() {
    let (mut day, c) = locked_today(3);
    day.skip(&id(&day, 2), &c).unwrap();
    assert_eq!(status(&day, 2), TaskStatus::Skipped);
    let carried: Vec<&str> = day.carryover().iter().map(|t| t.title.as_str()).collect();
    assert_eq!(carried, vec!["One", "Three"]);
    assert!(kinds(&day).contains(&EventKind::Skipped));
    ok(&day);
}

#[test]
fn skipping_the_active_task_activates_the_next() {
    let (mut day, c) = locked_today(2);
    day.skip(&id(&day, 1), &c).unwrap();
    assert_eq!(day.sessions[0].ended_reason, Some(EndedReason::Skipped));
    assert_eq!(status(&day, 2), TaskStatus::Active);
    ok(&day);
}

#[test]
fn finished_tasks_cannot_be_deferred_or_skipped_again() {
    let (mut day, c) = locked_today(2);
    day.complete(&id(&day, 1), &c).unwrap();
    assert!(matches!(
        day.defer(&id(&day, 1), &c),
        Err(DomainError::InvalidTransition { .. })
    ));
    assert!(matches!(
        day.skip(&id(&day, 1), &c),
        Err(DomainError::InvalidTransition { .. })
    ));
}

#[test]
fn carryover_keeps_position_order_and_lineage() {
    let (mut day, c) = locked_today(4);
    day.defer(&id(&day, 4), &c).unwrap();
    day.complete(&id(&day, 1), &c).unwrap();
    day.skip(&id(&day, 3), &c).unwrap();
    let rows = day.carryover_inputs();
    assert_eq!(
        rows.iter().map(|r| r.title.as_str()).collect::<Vec<_>>(),
        vec!["Two", "Four"]
    );
    assert_eq!(rows[0].carried_from.as_deref(), Some(id(&day, 2).as_str()));
    assert_eq!(rows[1].carried_from.as_deref(), Some(id(&day, 4).as_str()));
    assert!(rows.iter().all(|r| r.id.is_none()));
}

// ----- undo / reopen ------------------------------------------------------------------------

#[test]
fn undo_puts_a_done_task_back_to_planned_without_stealing_the_slot() {
    let (mut day, c) = locked_today(2);
    day.complete(&id(&day, 1), &c).unwrap();
    day.reopen(&id(&day, 1), &c).unwrap();
    assert_eq!(status(&day, 1), TaskStatus::Planned);
    assert_eq!(day.tasks[0].completed_at, None);
    assert_eq!(status(&day, 2), TaskStatus::Active);
    assert!(kinds(&day).contains(&EventKind::Reopened));
    ok(&day);
}

#[test]
fn undo_after_six_done_makes_the_reopened_task_active() {
    let (mut day, c) = locked_today(2);
    day.complete(&id(&day, 1), &c).unwrap();
    day.complete(&id(&day, 2), &c).unwrap();
    day.reopen(&id(&day, 2), &c).unwrap();
    assert_eq!(status(&day, 2), TaskStatus::Active);
    assert_eq!(day.open_session().unwrap().task_id, id(&day, 2));
    ok(&day);
}

#[test]
fn reopen_works_for_deferred_and_skipped_but_not_open_tasks() {
    let (mut day, c) = locked_today(3);
    day.defer(&id(&day, 2), &c).unwrap();
    day.skip(&id(&day, 3), &c).unwrap();
    day.reopen(&id(&day, 2), &c).unwrap();
    day.reopen(&id(&day, 3), &c).unwrap();
    assert_eq!(status(&day, 2), TaskStatus::Planned);
    assert_eq!(status(&day, 3), TaskStatus::Planned);
    assert!(matches!(
        day.reopen(&id(&day, 1), &c),
        Err(DomainError::InvalidTransition { .. })
    ));
    ok(&day);
}

#[test]
fn undo_is_same_day_only() {
    let (mut day, c) = locked_today(2);
    day.complete(&id(&day, 1), &c).unwrap();
    assert_eq!(
        day.reopen(&id(&day, 1), &ctx(4, 9, 0)).unwrap_err(),
        DomainError::NotToday
    );
    assert_eq!(status(&day, 1), TaskStatus::Done);
}

// ----- editing --------------------------------------------------------------------------------

#[test]
fn editing_after_lock_is_logged_and_keeps_task_identity_and_sessions() {
    let (mut day, c) = locked_today(2);
    let (t1, t2) = (id(&day, 1), id(&day, 2));
    day.edit(
        vec![
            TaskInput {
                id: Some(t2.clone()),
                title: "Two, renamed".into(),
                ..Default::default()
            },
            TaskInput {
                id: Some(t1.clone()),
                title: "One".into(),
                ..Default::default()
            },
            TaskInput {
                title: "New third".into(),
                ..Default::default()
            },
        ],
        &c,
    )
    .unwrap();
    assert!(day.plan.edited_after_lock);
    assert!(kinds(&day).contains(&EventKind::EditedAfterLock));
    assert_eq!(day.tasks[0].id, t2);
    assert_eq!(day.tasks[0].title, "Two, renamed");
    assert_eq!(day.tasks[0].status, TaskStatus::Planned);
    assert_eq!(day.tasks[1].id, t1);
    assert_eq!(
        day.tasks[1].status,
        TaskStatus::Active,
        "the active task keeps working"
    );
    assert_eq!(day.tasks[2].status, TaskStatus::Planned);
    assert_eq!(day.open_session().unwrap().task_id, t1);
    ok(&day);
}

#[test]
fn editing_out_the_active_task_supersedes_its_session_and_activates_the_first_planned() {
    let (mut day, _) = locked_today(3);
    let c = ctx(3, 11, 0);
    let (t1, t2, t3) = (id(&day, 1), id(&day, 2), id(&day, 3));
    day.edit(
        vec![
            TaskInput {
                id: Some(t3.clone()),
                title: "Three".into(),
                ..Default::default()
            },
            TaskInput {
                id: Some(t2.clone()),
                title: "Two".into(),
                ..Default::default()
            },
        ],
        &c,
    )
    .unwrap();
    assert!(day.task(&t1).is_none());
    assert!(
        day.sessions.iter().all(|s| s.task_id != t1),
        "removed task's sessions go with it"
    );
    assert_eq!(day.tasks[0].id, t3);
    assert_eq!(day.tasks[0].status, TaskStatus::Active);
    assert_eq!(day.open_session().unwrap().started_at, c.now);
    ok(&day);
}

#[test]
fn editing_before_lock_is_not_logged() {
    let c = ctx(3, 9, 0);
    let mut day = Day::draft(date(3), inputs(&TITLES[..2]), &c).unwrap();
    day.edit(inputs(&TITLES[..3]), &c).unwrap();
    assert!(!day.plan.edited_after_lock);
    assert!(day.pending_events.is_empty());
    assert_eq!(day.tasks.len(), 3);
    ok(&day);
}

#[test]
fn editing_rejects_duplicate_rows_and_unknown_ids_become_new_tasks() {
    let (mut day, c) = locked_today(2);
    let t1 = id(&day, 1);
    let dup = vec![
        TaskInput {
            id: Some(t1.clone()),
            title: "One".into(),
            ..Default::default()
        },
        TaskInput {
            id: Some(t1.clone()),
            title: "One again".into(),
            ..Default::default()
        },
    ];
    assert_eq!(day.edit(dup, &c).unwrap_err(), DomainError::DuplicateTask);
    day.edit(
        vec![TaskInput {
            id: Some("not-a-task".into()),
            title: "Fresh".into(),
            ..Default::default()
        }],
        &c,
    )
    .unwrap();
    assert_eq!(day.tasks.len(), 1);
    assert_ne!(day.tasks[0].id, "not-a-task");
    assert_eq!(
        day.tasks[0].status,
        TaskStatus::Active,
        "first planned task takes the slot"
    );
    ok(&day);
}

// ----- day rollover ------------------------------------------------------------------------------

#[test]
fn rollover_closes_the_open_session_at_the_day_end_instant() {
    let (mut day, _) = locked_today(2);
    let day_end = at(3, 23, 30); // the 05:00 local rollover expressed in UTC
    let next_morning = ctx(4, 9, 0);
    assert_eq!(day.apply_rollover(day_end, &next_morning), 1);
    let s = &day.sessions[0];
    assert_eq!(s.ended_at, Some(day_end));
    assert_eq!(s.ended_reason, Some(EndedReason::DayEnd));
    assert_eq!(
        status(&day, 1),
        TaskStatus::Active,
        "status is untouched; the review decides"
    );
    assert!(day.open_session().is_none());
    // Yesterday's list never auto-activates or starts sessions again.
    assert_eq!(day.ensure_active(&next_morning), None);
    assert_eq!(
        day.activate(&id(&day, 2), true, &next_morning).unwrap_err(),
        DomainError::NotToday
    );
    // ...but it can still be finished, deferred or reviewed.
    day.complete(&id(&day, 1), &next_morning).unwrap();
    assert_eq!(status(&day, 1), TaskStatus::Done);
    assert_eq!(
        status(&day, 2),
        TaskStatus::Planned,
        "no auto-activation on a past day"
    );
    assert_eq!(
        day.focus_seconds(&id(&day, 1), next_morning.now),
        (23 - 9) * 3600 + 30 * 60
    );
    ok(&day);
}

#[test]
fn rollover_is_a_no_op_for_today_and_for_closed_sessions() {
    let (mut day, c) = locked_today(1);
    assert_eq!(day.apply_rollover(at(3, 23, 30), &c), 0);
    assert!(day.open_session().is_some());
    day.pause(&id(&day, 1), PauseReason::Break, &c).unwrap();
    assert_eq!(day.apply_rollover(at(3, 23, 30), &ctx(4, 9, 0)), 0);
    ok(&day);
}

#[test]
fn rollover_never_ends_a_session_before_it_started_or_after_now() {
    let mut day = Day::draft(date(3), inputs(&TITLES[..1]), &ctx(3, 23, 45)).unwrap();
    day.lock(&ctx(3, 23, 45)).unwrap();
    // Day end nominally 23:30 but the session started at 23:45: clamp to the start.
    day.apply_rollover(at(3, 23, 30), &ctx(4, 9, 0));
    assert_eq!(day.sessions[0].ended_at, Some(at(3, 23, 45)));

    let mut day2 = Day::draft(date(3), inputs(&TITLES[..1]), &ctx(3, 22, 0)).unwrap();
    day2.lock(&ctx(3, 22, 0)).unwrap();
    // Detected only at 23:00 the same UTC day with a day end of 23:30: clamp to now.
    let c = Ctx::new(at(3, 23, 0), date(4), DEV);
    day2.apply_rollover(at(3, 23, 30), &c);
    assert_eq!(day2.sessions[0].ended_at, Some(at(3, 23, 0)));
    ok(&day);
    ok(&day2);
}

// ----- the evening review -------------------------------------------------------------------------

#[test]
fn review_carries_by_default_drops_on_request_and_records_the_reflection() {
    let (mut day, c) = locked_today(4);
    day.complete(&id(&day, 1), &c).unwrap(); // 2 active
    let evening = ctx(3, 18, 30);
    day.complete_review(
        Some("  Good day.  ".into()),
        vec![ReviewDecision {
            task_id: id(&day, 3),
            decision: Decision::Drop,
        }],
        &evening,
    )
    .unwrap();
    assert_eq!(status(&day, 1), TaskStatus::Done);
    assert_eq!(
        status(&day, 2),
        TaskStatus::Deferred,
        "the active task is carried"
    );
    assert_eq!(status(&day, 3), TaskStatus::Skipped);
    assert_eq!(
        status(&day, 4),
        TaskStatus::Deferred,
        "undecided tasks carry"
    );
    assert_eq!(day.plan.reviewed_at, Some(evening.now));
    assert_eq!(day.plan.reflection.as_deref(), Some("Good day."));
    assert!(day.open_session().is_none());
    assert!(day.current_task().is_none());
    assert_eq!(kinds(&day).last(), Some(&EventKind::Reviewed));
    let carried: Vec<&str> = day.carryover().iter().map(|t| t.title.as_str()).collect();
    assert_eq!(carried, vec!["Two", "Four"]);
    ok(&day);

    assert_eq!(
        day.complete_review(None, vec![], &evening).unwrap_err(),
        DomainError::AlreadyReviewed
    );
}

#[test]
fn review_rejects_decisions_for_unknown_tasks() {
    let (mut day, c) = locked_today(2);
    let err = day
        .complete_review(
            None,
            vec![ReviewDecision {
                task_id: "nope".into(),
                decision: Decision::Drop,
            }],
            &c,
        )
        .unwrap_err();
    assert_eq!(err, DomainError::TaskNotFound);
    assert!(day.plan.reviewed_at.is_none());
}

#[test]
fn review_with_everything_done_records_nothing_but_the_reflection() {
    let (mut day, c) = locked_today(1);
    day.complete(&id(&day, 1), &c).unwrap();
    day.complete_review(None, vec![], &c).unwrap();
    assert!(day.plan.reviewed_at.is_some());
    assert_eq!(day.plan.reflection, None);
    ok(&day);
}

// ----- idle detection and trimming ---------------------------------------------------------------

#[test]
fn a_long_untouched_session_is_flagged_and_can_be_trimmed() {
    let (mut day, _) = locked_today(1);
    day.pause(&id(&day, 1), PauseReason::Paused, &ctx(3, 18, 0))
        .unwrap();
    let flags = day.idle_flags(at(3, 18, 0));
    assert_eq!(flags.len(), 1);
    assert_eq!(
        (flags[0].gap_start, flags[0].gap_end),
        (at(3, 9, 0), at(3, 18, 0)),
        "no interaction after the start"
    );
    let sid = flags[0].session_id.clone();

    let c = ctx(3, 18, 5);
    // Trimming away all but the first five minutes: the session ends at 09:05 and, the
    // silence having run to the end, nothing continues after it.
    day.trim_idle(&sid, at(3, 9, 5), at(3, 18, 0), &c).unwrap();
    assert_eq!(day.sessions.len(), 1);
    assert_eq!(day.sessions[0].ended_at, Some(at(3, 9, 5)));
    assert_eq!(day.sessions[0].ended_reason, Some(EndedReason::Trimmed));
    assert_eq!(day.focus_seconds(&id(&day, 1), c.now), 5 * 60);
    assert!(day.idle_flags(c.now).is_empty());
    ok(&day);
}

#[test]
fn a_trim_must_lie_inside_the_session_and_remove_something() {
    let (mut day, _) = locked_today(1);
    let sid = day.open_session().unwrap().id.clone();
    let c = ctx(3, 14, 0);
    assert_eq!(
        day.trim_idle(&sid, at(3, 8, 0), at(3, 14, 0), &c).unwrap_err(),
        DomainError::InvalidTrim
    );
    assert_eq!(
        day.trim_idle(&sid, at(3, 9, 0), at(3, 15, 0), &c).unwrap_err(),
        DomainError::InvalidTrim
    );
    assert_eq!(
        day.trim_idle(&sid, at(3, 12, 0), at(3, 12, 0), &c).unwrap_err(),
        DomainError::InvalidTrim
    );
    assert_eq!(
        day.trim_idle("nope", at(3, 9, 0), at(3, 14, 0), &c).unwrap_err(),
        DomainError::SessionNotFound
    );
    assert_eq!(day.sessions.len(), 1);
    ok(&day);
}

#[test]
fn interacting_keeps_a_long_session_from_being_flagged() {
    let (mut day, _) = locked_today(1);
    day.touch(&ctx(3, 11, 30));
    assert!(day.idle_flags(at(3, 13, 0)).is_empty());
    assert!(
        !day.idle_flags(at(3, 17, 0)).is_empty(),
        "silence after the last touch counts"
    );
    ok(&day);
}

#[test]
fn trimming_a_running_session_continues_it_from_the_return() {
    let (mut day, _) = locked_today(1);
    let sid = day.open_session().unwrap().id.clone();
    let c = ctx(3, 14, 0);
    day.trim_idle(&sid, at(3, 9, 5), at(3, 14, 0), &c).unwrap();
    assert_eq!(day.sessions.len(), 2);
    assert_eq!(day.sessions[0].ended_at, Some(at(3, 9, 5)));
    let fresh = day.open_session().unwrap();
    assert_eq!(fresh.started_at, c.now);
    assert_eq!(status(&day, 1), TaskStatus::Active);
    assert_eq!(
        day.focus_seconds(&id(&day, 1), at(3, 14, 10)),
        5 * 60 + 10 * 60
    );
    ok(&day);
}

#[test]
fn coming_back_after_a_long_silence_keeps_the_silence_for_the_review() {
    let (mut day, _) = locked_today(1);
    let t1 = id(&day, 1);
    // Nothing from 09:00 until 12:30: the first touch back records the silence instead
    // of erasing it, and the stamp still moves.
    assert!(day.touch(&ctx(3, 12, 30)));
    day.touch(&ctx(3, 12, 31));
    let s = &day.sessions[0];
    assert_eq!(s.idle_gap(), Some((at(3, 9, 0), at(3, 12, 30))));
    assert_eq!(s.last_interaction_at, Some(at(3, 12, 31)));

    let flags = day.idle_flags(at(3, 13, 0));
    assert_eq!(flags.len(), 1);
    assert_eq!(
        (flags[0].gap_start, flags[0].gap_end),
        (at(3, 9, 0), at(3, 12, 30))
    );
    assert_eq!(flags[0].gap_seconds, 3 * 3600 + 30 * 60);
    assert_eq!(flags[0].suggested_seconds, 30 * 60);

    // Trimming takes exactly that stretch out; the work since 12:30 goes on, still running.
    let sid = flags[0].session_id.clone();
    day.trim_idle(&sid, at(3, 9, 0), at(3, 12, 30), &ctx(3, 13, 0))
        .unwrap();
    assert_eq!(day.sessions.len(), 2);
    assert_eq!(day.sessions[0].ended_at, Some(at(3, 9, 0)));
    assert_eq!(day.sessions[0].ended_reason, Some(EndedReason::Trimmed));
    assert!(day.sessions[0].idle_gap().is_none());
    let rest = day.open_session().unwrap();
    assert_eq!(rest.started_at, at(3, 12, 30));
    assert_eq!(rest.last_interaction_at, Some(at(3, 12, 31)));
    assert_eq!(day.focus_seconds(&t1, at(3, 13, 0)), 30 * 60);
    assert!(day.idle_flags(at(3, 13, 0)).is_empty());
    ok(&day);
}

#[test]
fn the_longest_silence_is_the_one_kept() {
    let (mut day, _) = locked_today(1);
    day.touch(&ctx(3, 12, 10)); // 3h10 since the start: recorded
    day.touch(&ctx(3, 12, 20));
    day.touch(&ctx(3, 16, 30)); // 4h10: longer, replaces it
    assert_eq!(
        day.sessions[0].idle_gap(),
        Some((at(3, 12, 20), at(3, 16, 30)))
    );
    day.touch(&ctx(3, 19, 40)); // 3h10 again: shorter, ignored
    assert_eq!(
        day.sessions[0].idle_gap(),
        Some((at(3, 12, 20), at(3, 16, 30)))
    );
    // The silence since the last touch competes with the recorded one; the longer wins.
    let flags = day.idle_flags(at(3, 22, 0));
    assert_eq!(
        (flags[0].gap_start, flags[0].gap_end),
        (at(3, 12, 20), at(3, 16, 30))
    );
    let flags = day.idle_flags(at(4, 0, 0));
    assert_eq!(
        (flags[0].gap_start, flags[0].gap_end),
        (at(3, 19, 40), at(4, 0, 0))
    );
    ok(&day);
}

#[test]
fn work_after_the_silence_survives_the_trim_of_a_closed_session() {
    let (mut day, _) = locked_today(1);
    let t1 = id(&day, 1);
    day.touch(&ctx(3, 12, 0));
    day.touch(&ctx(3, 15, 30)); // 3h30 away over lunch
    day.pause(&t1, PauseReason::Paused, &ctx(3, 18, 0)).unwrap();
    let flags = day.idle_flags(at(3, 18, 5));
    assert_eq!(
        (flags[0].gap_start, flags[0].gap_end),
        (at(3, 12, 0), at(3, 15, 30))
    );
    let sid = flags[0].session_id.clone();
    day.trim_idle(&sid, at(3, 12, 0), at(3, 15, 30), &ctx(3, 18, 5))
        .unwrap();
    assert_eq!(day.sessions.len(), 2);
    assert_eq!(day.sessions[0].ended_at, Some(at(3, 12, 0)));
    let after = &day.sessions[1];
    assert_eq!(
        (after.started_at, after.ended_at),
        (at(3, 15, 30), Some(at(3, 18, 0)))
    );
    assert_eq!(
        after.ended_reason,
        Some(EndedReason::Paused),
        "the original reason stays with the end"
    );
    assert!(day.open_session().is_none());
    assert_eq!(
        day.focus_seconds(&t1, at(3, 18, 5)),
        3 * 3600 + 2 * 3600 + 30 * 60
    );
    assert!(day.idle_flags(at(3, 18, 5)).is_empty());
    ok(&day);
}

#[test]
fn a_pomodoro_counted_during_the_silence_is_interrupted_by_the_trim() {
    // The ring settled while nobody was there: reads settle before the review ever runs.
    let (mut day, _) = locked_today(1);
    let t1 = id(&day, 1);
    day.start_pomodoro(&t1, 1500, &ctx(3, 9, 0)).unwrap();
    assert!(day.settle_pomodoros(&ctx(3, 14, 0)));
    assert_eq!(day.pomodoros_completed(None), 1);
    let sid = day.open_session().unwrap().id.clone();
    day.trim_idle(&sid, at(3, 9, 5), at(3, 14, 0), &ctx(3, 14, 0))
        .unwrap();
    assert_eq!(pom(&day, 0).outcome, Some(PomodoroOutcome::Interrupted));
    assert_eq!(pom(&day, 0).ended_at, Some(at(3, 9, 5)));
    assert_eq!(day.pomodoros_completed(None), 0);
    assert_eq!(day.focus_seconds(&t1, at(3, 14, 0)), 5 * 60);
    ok(&day);
}

#[test]
fn a_pomodoro_that_only_started_inside_the_silence_goes_with_it() {
    // The interaction stamp is throttled to once a minute, so a pomodoro can start a
    // few seconds after the last stamp; the user then says they were not there.
    let (mut day, _) = locked_today(1);
    let t1 = id(&day, 1);
    day.touch(&ctx(3, 9, 5));
    let started = Utc.with_ymd_and_hms(2026, 9, 3, 9, 5, 30).unwrap();
    day.start_pomodoro(&t1, 1500, &Ctx::new(started, date(3), DEV)).unwrap();
    assert!(day.settle_pomodoros(&ctx(3, 13, 0)));
    let sid = day.open_session().unwrap().id.clone();
    day.trim_idle(&sid, at(3, 9, 5), at(3, 13, 5), &ctx(3, 13, 5))
        .unwrap();
    assert!(day.pomodoros.is_empty(), "nothing of it remains");
    assert_eq!(day.sessions[0].ended_at, Some(at(3, 9, 5)));
    assert_eq!(day.open_session().unwrap().started_at, at(3, 13, 5));
    ok(&day);
}

#[test]
fn the_long_break_is_offered_once_per_set() {
    let (mut day, _) = locked_today(1);
    let t1 = id(&day, 1);
    // Set of one: every completed pomodoro earns a long break, until it is taken.
    assert!(!day.long_break_due(1, None), "nothing completed yet");
    day.start_pomodoro(&t1, 60, &ctx(3, 9, 0)).unwrap();
    day.settle_pomodoros(&ctx(3, 9, 1));
    assert!(day.long_break_due(1, None));
    day.pause(&t1, PauseReason::Break, &ctx(3, 9, 2)).unwrap();
    let brk = day.last_closed_session(&t1).unwrap().id.clone();
    assert!(
        day.long_break_due(1, Some(&brk)),
        "the break being taken is the long one"
    );
    day.resume(&t1, &ctx(3, 9, 4)).unwrap();
    assert!(!day.long_break_due(1, None), "taken; the next one is ordinary");
    day.pause(&t1, PauseReason::Break, &ctx(3, 9, 10)).unwrap();
    let next = day.last_closed_session(&t1).unwrap().id.clone();
    assert!(!day.long_break_due(1, Some(&next)));
    // Another completed pomodoro earns it again.
    day.resume(&t1, &ctx(3, 9, 12)).unwrap();
    day.start_pomodoro(&t1, 60, &ctx(3, 9, 12)).unwrap();
    day.settle_pomodoros(&ctx(3, 9, 13));
    assert!(day.long_break_due(1, None));
    // With a set of four, two completed pomodoros earn nothing.
    assert!(!day.long_break_due(4, None));
    ok(&day);
}

#[test]
fn a_pomodoro_after_the_silence_moves_to_the_session_that_continues() {
    let (mut day, _) = locked_today(1);
    let t1 = id(&day, 1);
    day.touch(&ctx(3, 13, 0)); // 4h of silence, recorded
    day.start_pomodoro(&t1, 1500, &ctx(3, 13, 5)).unwrap();
    let sid = day.open_session().unwrap().id.clone();
    day.trim_idle(&sid, at(3, 9, 0), at(3, 13, 0), &ctx(3, 13, 10))
        .unwrap();
    let rest = day.open_session().unwrap();
    assert_eq!(pom(&day, 0).session_id.as_deref(), Some(rest.id.as_str()));
    assert!(
        pom(&day, 0).is_open(),
        "a pomodoro that started after the silence is untouched"
    );
    ok(&day);
}

#[test]
fn touch_only_applies_to_a_running_session() {
    let (mut day, c) = locked_today(1);
    assert!(day.touch(&ctx(3, 9, 30)));
    assert_eq!(day.sessions[0].last_interaction_at, Some(at(3, 9, 30)));
    day.pause(&id(&day, 1), PauseReason::Break, &c).unwrap();
    assert!(!day.touch(&ctx(3, 9, 40)));
}

#[test]
fn notes_are_trimmed_and_blank_notes_are_cleared() {
    let (mut day, c) = locked_today(1);
    day.set_note(&id(&day, 1), Some("  call first  ".into()), &c)
        .unwrap();
    assert_eq!(day.tasks[0].note.as_deref(), Some("call first"));
    day.set_note(&id(&day, 1), Some("   ".into()), &c).unwrap();
    assert_eq!(day.tasks[0].note, None);
    assert_eq!(
        day.set_note("nope", None, &c).unwrap_err(),
        DomainError::TaskNotFound
    );
}

// ----- a whole day -----------------------------------------------------------------------------

#[test]
fn a_full_day_keeps_every_invariant() {
    let (mut day, _) = locked_today(6);
    let ids: Vec<String> = (1..=6).map(|p| id(&day, p)).collect();
    let steps: Vec<(
        u32,
        u32,
        Box<dyn Fn(&mut Day, &Ctx) -> Result<(), DomainError>>,
    )> = vec![
        (
            9,
            30,
            Box::new({
                let t = ids[0].clone();
                move |d, c| d.pause(&t, PauseReason::Break, c)
            }),
        ),
        (
            9,
            35,
            Box::new({
                let t = ids[0].clone();
                move |d, c| d.resume(&t, c)
            }),
        ),
        (
            10,
            0,
            Box::new({
                let t = ids[0].clone();
                move |d, c| d.complete(&t, c)
            }),
        ),
        (
            10,
            5,
            Box::new({
                let t = ids[3].clone();
                move |d, c| d.activate(&t, true, c)
            }),
        ),
        (
            11,
            0,
            Box::new({
                let t = ids[3].clone();
                move |d, c| d.defer(&t, c)
            }),
        ),
        (
            11,
            1,
            Box::new({
                let t = ids[1].clone();
                move |d, c| d.complete(&t, c)
            }),
        ),
        (
            11,
            2,
            Box::new({
                let t = ids[1].clone();
                move |d, c| d.reopen(&t, c)
            }),
        ),
        (
            12,
            0,
            Box::new({
                let t = ids[2].clone();
                move |d, c| d.complete(&t, c)
            }),
        ),
        (
            12,
            1,
            Box::new({
                let t = ids[1].clone();
                move |d, c| d.complete(&t, c)
            }),
        ),
        (
            13,
            0,
            Box::new({
                let t = ids[4].clone();
                move |d, c| d.pause(&t, PauseReason::Paused, c)
            }),
        ),
        (
            18,
            0,
            Box::new({
                let t = ids[5].clone();
                move |d, c| d.skip(&t, c)
            }),
        ),
        (
            18,
            30,
            Box::new(|d, c| d.complete_review(Some("ok".into()), vec![], c)),
        ),
    ];
    for (h, m, step) in steps {
        let c = ctx(3, h, m);
        step(&mut day, &c).unwrap_or_else(|e| panic!("step at {h}:{m:02} failed: {e}"));
        ok(&day);
    }
    let statuses: Vec<TaskStatus> = day.tasks.iter().map(|t| t.status).collect();
    assert_eq!(
        statuses,
        vec![
            TaskStatus::Done,
            TaskStatus::Done,
            TaskStatus::Done,
            TaskStatus::Deferred,
            TaskStatus::Deferred,
            TaskStatus::Skipped,
        ]
    );
    assert_eq!(day.done_count(), 3);
    assert_eq!(day.focus_seconds(&ids[0], at(3, 19, 0)), 30 * 60 + 25 * 60);
    // Sessions: 1 (30m + 25m), 2 (5m superseded + 1m + 1m), 4 (55m), 3 (59m), 5 (59m).
    assert_eq!(
        day.total_focus_seconds(at(3, 19, 0)),
        (30 + 25 + 5 + 1 + 1 + 55 + 59 + 59) * 60
    );
    assert_eq!(day.focus_seconds(&ids[1], at(3, 19, 0)), 7 * 60);
    assert_eq!(day.carryover().len(), 2);
}

// ----- pomodoro (Step 4b) -------------------------------------------------------------

const POM: i64 = 25 * 60;

fn pom(day: &Day, n: usize) -> &Pomodoro {
    &day.pomodoros[n]
}

#[test]
fn a_pomodoro_needs_the_active_task() {
    let (mut day, c) = locked_today(2);
    assert_eq!(
        day.start_pomodoro(&id(&day, 2), POM, &c).unwrap_err(),
        DomainError::InvalidTransition {
            status: TaskStatus::Planned,
            action: "start a pomodoro"
        }
    );
    day.pause(&id(&day, 1), PauseReason::Break, &c).unwrap();
    assert!(matches!(
        day.start_pomodoro(&id(&day, 1), POM, &c),
        Err(DomainError::InvalidTransition { .. })
    ));
    assert_eq!(
        day.start_pomodoro(&id(&day, 1), 0, &c).unwrap_err(),
        DomainError::InvalidPomodoroLength
    );
    ok(&day);
}

#[test]
fn a_pomodoro_counts_down_rings_at_its_planned_end_and_waits_for_a_tap() {
    let (mut day, _) = locked_today(1);
    let t1 = id(&day, 1);
    day.start_pomodoro(&t1, POM, &ctx(3, 9, 0)).unwrap();
    ok(&day);
    assert_eq!(
        pom(&day, 0).session_id.as_deref(),
        Some(day.sessions[0].id.as_str())
    );
    let (phase, p) = day.pomodoro_state(at(3, 9, 24));
    assert_eq!(phase, PomodoroPhase::Running);
    assert_eq!(p.unwrap().remaining_seconds(at(3, 9, 24)), 60);

    // Read at 9:26: it rang at 9:25 exactly, whatever the clock said when we looked.
    assert!(day.settle_pomodoros(&ctx(3, 9, 26)));
    assert!(
        !day.settle_pomodoros(&ctx(3, 9, 27)),
        "settling is idempotent"
    );
    let p = pom(&day, 0);
    assert_eq!(p.ended_at, Some(at(3, 9, 25)));
    assert_eq!(p.outcome, Some(PomodoroOutcome::Completed));
    assert!(p.is_awaiting_ack());
    assert_eq!(day.pomodoro_state(at(3, 9, 26)).0, PomodoroPhase::Done);
    assert_eq!(day.pomodoros_completed(Some(&t1)), 1);
    assert_eq!(day.pomodoros_completed(None), 1);
    assert!(
        day.open_session().is_some(),
        "the session keeps running; only the pomodoro ended"
    );

    // "Keep going" answers the ring; nothing starts by itself.
    day.acknowledge_pomodoro(&t1, &ctx(3, 9, 30)).unwrap();
    assert_eq!(day.pomodoro_state(at(3, 9, 30)).0, PomodoroPhase::Idle);
    assert_eq!(pom(&day, 0).acknowledged_at, Some(at(3, 9, 30)));
    ok(&day);
}

#[test]
fn only_one_pomodoro_runs_at_a_time_and_the_next_answers_the_last_ring() {
    let (mut day, _) = locked_today(1);
    let t1 = id(&day, 1);
    day.start_pomodoro(&t1, POM, &ctx(3, 9, 0)).unwrap();
    assert_eq!(
        day.start_pomodoro(&t1, POM, &ctx(3, 9, 10)).unwrap_err(),
        DomainError::PomodoroRunning
    );
    // Past the ring, "One more" settles the old one and starts the next.
    day.start_pomodoro(&t1, POM, &ctx(3, 9, 30)).unwrap();
    assert_eq!(day.pomodoros.len(), 2);
    assert_eq!(pom(&day, 0).outcome, Some(PomodoroOutcome::Completed));
    assert_eq!(pom(&day, 0).acknowledged_at, Some(at(3, 9, 30)));
    assert_eq!(day.pomodoro_state(at(3, 9, 31)).0, PomodoroPhase::Running);
    ok(&day);
}

#[test]
fn taking_a_break_interrupts_the_pomodoro_and_resuming_starts_nothing() {
    let (mut day, _) = locked_today(1);
    let t1 = id(&day, 1);
    day.start_pomodoro(&t1, POM, &ctx(3, 9, 0)).unwrap();
    day.pause(&t1, PauseReason::Break, &ctx(3, 9, 10)).unwrap();
    let p = pom(&day, 0);
    assert_eq!(p.ended_at, Some(at(3, 9, 10)));
    assert_eq!(p.outcome, Some(PomodoroOutcome::Interrupted));
    assert_eq!(
        day.pomodoros_completed(None),
        0,
        "an interruption is a fact, not a count"
    );
    day.resume(&t1, &ctx(3, 9, 15)).unwrap();
    assert_eq!(day.pomodoro_state(at(3, 9, 15)).0, PomodoroPhase::Idle);
    assert!(
        day.open_pomodoro().is_none(),
        "the next pomodoro waits for a tap"
    );
    ok(&day);
}

#[test]
fn finishing_the_task_early_or_after_the_ring_is_recorded_as_such() {
    let (mut day, _) = locked_today(2);
    let t1 = id(&day, 1);
    day.start_pomodoro(&t1, POM, &ctx(3, 9, 0)).unwrap();
    day.complete(&t1, &ctx(3, 9, 12)).unwrap();
    assert_eq!(pom(&day, 0).outcome, Some(PomodoroOutcome::FinishedEarly));
    assert_eq!(pom(&day, 0).ended_at, Some(at(3, 9, 12)));
    assert_eq!(status(&day, 2), TaskStatus::Active);
    assert_eq!(
        day.pomodoro_state(at(3, 9, 12)).0,
        PomodoroPhase::Idle,
        "the next task starts without a pomodoro"
    );

    let t2 = id(&day, 2);
    day.start_pomodoro(&t2, POM, &ctx(3, 9, 12)).unwrap();
    day.complete(&t2, &ctx(3, 9, 50)).unwrap();
    let p = pom(&day, 1);
    assert_eq!(
        p.outcome,
        Some(PomodoroOutcome::Completed),
        "it rang at 9:37 first"
    );
    assert_eq!(p.ended_at, Some(at(3, 9, 37)));
    assert_eq!(
        p.acknowledged_at,
        Some(at(3, 9, 50)),
        "completing the task answers the ring"
    );
    assert_eq!(day.pomodoros_completed(None), 1);
    ok(&day);
}

#[test]
fn skipping_ahead_and_deferring_interrupt_the_running_pomodoro() {
    let (mut day, _) = locked_today(3);
    let t1 = id(&day, 1);
    day.start_pomodoro(&t1, POM, &ctx(3, 9, 0)).unwrap();
    day.activate(&id(&day, 3), true, &ctx(3, 9, 5)).unwrap();
    assert_eq!(pom(&day, 0).outcome, Some(PomodoroOutcome::Interrupted));
    assert_eq!(pom(&day, 0).ended_at, Some(at(3, 9, 5)));
    assert!(day.open_pomodoro().is_none());

    let t3 = id(&day, 3);
    day.start_pomodoro(&t3, POM, &ctx(3, 9, 5)).unwrap();
    day.defer(&t3, &ctx(3, 9, 20)).unwrap();
    assert_eq!(pom(&day, 1).outcome, Some(PomodoroOutcome::Interrupted));
    ok(&day);
}

#[test]
fn the_day_rollover_interrupts_a_pomodoro_unless_it_had_rung() {
    let (mut day, _) = locked_today(1);
    let t1 = id(&day, 1);
    day.start_pomodoro(&t1, POM, &ctx(3, 23, 50)).unwrap();
    // Rollover at 05:00 the next day; the app is opened at 09:00.
    let next = Ctx::new(at(4, 9, 0), date(4), DEV);
    assert_eq!(day.apply_rollover(at(4, 5, 0), &next), 1);
    let p = pom(&day, 0);
    assert_eq!(
        p.outcome,
        Some(PomodoroOutcome::Completed),
        "it rang at 00:15, before the day ended"
    );
    assert_eq!(p.ended_at, Some(at(4, 0, 15)));

    // Started ten minutes before the rollover: the day ends before it can ring.
    let (mut day2, _) = locked_today(1);
    let t = id(&day2, 1);
    day2.start_pomodoro(&t, POM, &ctx(4, 4, 50)).unwrap();
    day2.apply_rollover(at(4, 5, 0), &next);
    let p = pom(&day2, 0);
    assert_eq!(p.outcome, Some(PomodoroOutcome::Interrupted));
    assert_eq!(p.ended_at, Some(at(4, 5, 0)));
    ok(&day);
    ok(&day2);
}

#[test]
fn trimming_an_idle_session_ends_the_pomodoro_at_the_trim_point() {
    let (mut day, _) = locked_today(1);
    let t1 = id(&day, 1);
    day.start_pomodoro(&t1, POM, &ctx(3, 9, 0)).unwrap();
    let session = day.sessions[0].id.clone();
    day.trim_idle(&session, at(3, 9, 5), at(3, 14, 0), &ctx(3, 14, 0))
        .unwrap();
    assert_eq!(pom(&day, 0).outcome, Some(PomodoroOutcome::Interrupted));
    assert_eq!(pom(&day, 0).ended_at, Some(at(3, 9, 5)));
    assert!(
        day.open_session().is_some(),
        "a fresh session starts at the trim"
    );
    assert!(day.open_pomodoro().is_none());
    ok(&day);
}

#[test]
fn editing_a_task_away_drops_its_pomodoros() {
    let (mut day, c) = locked_today(2);
    let t1 = id(&day, 1);
    day.start_pomodoro(&t1, POM, &c).unwrap();
    let keep = TaskInput {
        id: Some(id(&day, 2)),
        title: "Two".into(),
        ..Default::default()
    };
    day.edit(vec![keep], &ctx(3, 9, 10)).unwrap();
    assert!(day.pomodoros.is_empty());
    ok(&day);
}
