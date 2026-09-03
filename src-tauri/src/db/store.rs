//! Queries. One aggregate (`Day`) in, one aggregate out; everything else is a lookup.

use std::collections::BTreeSet;

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{Sqlite, Transaction};

use super::rows::*;
use super::{DbError, DbResult, Pool};
use crate::domain::*;

const PLAN_COLS: &str =
    "id, plan_date, locked_at, edited_after_lock, reviewed_at, reflection, updated_at, device_id";
const TASK_COLS: &str =
    "id, plan_id, position, title, note, status, carried_from, completed_at, updated_at, device_id";
const SESSION_COLS: &str =
    "id, task_id, started_at, ended_at, ended_reason, last_interaction_at, device_id, updated_at";
const EVENT_COLS: &str = "id, task_id, plan_id, kind, occurred_at, device_id";
const POMODORO_COLS: &str =
    "id, task_id, session_id, started_at, planned_seconds, ended_at, outcome, \
                             acknowledged_at, device_id, updated_at";

// ----- loading -------------------------------------------------------------------------

pub async fn load_day(pool: &Pool, date: NaiveDate) -> DbResult<Option<Day>> {
    let sql = format!("SELECT {PLAN_COLS} FROM daily_plans WHERE plan_date = ?");
    let row = sqlx::query_as::<_, PlanRow>(&sql)
        .bind(fmt_date(date))
        .fetch_optional(pool)
        .await?;
    assemble_opt(pool, row).await
}

pub async fn load_day_by_plan(pool: &Pool, plan_id: &str) -> DbResult<Option<Day>> {
    let sql = format!("SELECT {PLAN_COLS} FROM daily_plans WHERE id = ?");
    let row = sqlx::query_as::<_, PlanRow>(&sql)
        .bind(plan_id)
        .fetch_optional(pool)
        .await?;
    assemble_opt(pool, row).await
}

pub async fn load_day_by_task(pool: &Pool, task_id: &str) -> DbResult<Option<Day>> {
    let sql = format!(
        "SELECT p.id, p.plan_date, p.locked_at, p.edited_after_lock, p.reviewed_at, p.reflection, \
         p.updated_at, p.device_id FROM daily_plans p JOIN tasks t ON t.plan_id = p.id WHERE t.id = ?"
    );
    let row = sqlx::query_as::<_, PlanRow>(&sql)
        .bind(task_id)
        .fetch_optional(pool)
        .await?;
    assemble_opt(pool, row).await
}

pub async fn load_day_by_session(pool: &Pool, session_id: &str) -> DbResult<Option<Day>> {
    let sql = format!(
        "SELECT p.id, p.plan_date, p.locked_at, p.edited_after_lock, p.reviewed_at, p.reflection, \
         p.updated_at, p.device_id FROM daily_plans p JOIN tasks t ON t.plan_id = p.id \
         JOIN sessions s ON s.task_id = t.id WHERE s.id = ?"
    );
    let row = sqlx::query_as::<_, PlanRow>(&sql)
        .bind(session_id)
        .fetch_optional(pool)
        .await?;
    assemble_opt(pool, row).await
}

/// Every plan in `from..=to`, newest first.
pub async fn load_days(pool: &Pool, from: NaiveDate, to: NaiveDate) -> DbResult<Vec<Day>> {
    let sql = format!(
        "SELECT {PLAN_COLS} FROM daily_plans WHERE plan_date BETWEEN ? AND ? ORDER BY plan_date DESC"
    );
    let rows = sqlx::query_as::<_, PlanRow>(&sql)
        .bind(fmt_date(from))
        .bind(fmt_date(to))
        .fetch_all(pool)
        .await?;
    let mut days = Vec::with_capacity(rows.len());
    for row in rows {
        days.push(assemble(pool, row).await?);
    }
    Ok(days)
}

async fn assemble_opt(pool: &Pool, row: Option<PlanRow>) -> DbResult<Option<Day>> {
    match row {
        Some(r) => Ok(Some(assemble(pool, r).await?)),
        None => Ok(None),
    }
}

async fn assemble(pool: &Pool, row: PlanRow) -> DbResult<Day> {
    let plan: Plan = row.try_into()?;
    let tasks_sql = format!("SELECT {TASK_COLS} FROM tasks WHERE plan_id = ? ORDER BY position");
    let tasks = sqlx::query_as::<_, TaskRow>(&tasks_sql)
        .bind(&plan.id)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(Task::try_from)
        .collect::<Result<Vec<_>, _>>()?;
    let sessions_sql = "SELECT s.id, s.task_id, s.started_at, s.ended_at, s.ended_reason, \
                        s.last_interaction_at, s.device_id, s.updated_at FROM sessions s \
                        JOIN tasks t ON t.id = s.task_id WHERE t.plan_id = ? \
                        ORDER BY s.started_at, s.id";
    let sessions = sqlx::query_as::<_, SessionRow>(sessions_sql)
        .bind(&plan.id)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(Session::try_from)
        .collect::<Result<Vec<_>, _>>()?;
    let pomodoros_sql = "SELECT p.id, p.task_id, p.session_id, p.started_at, p.planned_seconds, \
                         p.ended_at, p.outcome, p.acknowledged_at, p.device_id, p.updated_at \
                         FROM pomodoros p JOIN tasks t ON t.id = p.task_id WHERE t.plan_id = ? \
                         ORDER BY p.started_at, p.id";
    let pomodoros = sqlx::query_as::<_, PomodoroRow>(pomodoros_sql)
        .bind(&plan.id)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(Pomodoro::try_from)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Day::from_rows(plan, tasks, sessions, pomodoros))
}

// ----- saving --------------------------------------------------------------------------

/// Write the aggregate in one transaction after checking its invariants: upsert the plan, its tasks and sessions,
/// delete tasks that were edited out (their sessions and events cascade), and append the
/// pending events, which are then cleared.
pub async fn save_day(pool: &Pool, day: &mut Day) -> DbResult<()> {
    // Belt and braces: the domain enforces the invariants by construction; refuse to
    // persist anything that breaks one rather than let a bug reach the database.
    if let Err(problem) = day.check_invariants() {
        return Err(DbError::Corrupt(format!(
            "invariant violated, not saved: {problem}"
        )));
    }
    let mut tx = pool.begin().await?;
    upsert_plan(&mut tx, &day.plan).await?;

    let existing: Vec<String> = sqlx::query_scalar("SELECT id FROM tasks WHERE plan_id = ?")
        .bind(&day.plan.id)
        .fetch_all(&mut *tx)
        .await?;
    for id in existing
        .iter()
        .filter(|id| !day.tasks.iter().any(|t| &t.id == *id))
    {
        sqlx::query("DELETE FROM tasks WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    for task in &day.tasks {
        upsert_task(&mut tx, task).await?;
    }
    for session in &day.sessions {
        upsert_session(&mut tx, session).await?;
    }
    for pomodoro in &day.pomodoros {
        upsert_pomodoro(&mut tx, pomodoro).await?;
    }
    for event in &day.pending_events {
        insert_event(&mut tx, event).await?;
    }
    tx.commit().await?;
    day.pending_events.clear();
    Ok(())
}

async fn upsert_plan(tx: &mut Transaction<'_, Sqlite>, p: &Plan) -> DbResult<()> {
    let sql = format!(
        "INSERT INTO daily_plans ({PLAN_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET plan_date = excluded.plan_date, locked_at = excluded.locked_at, \
         edited_after_lock = excluded.edited_after_lock, reviewed_at = excluded.reviewed_at, \
         reflection = excluded.reflection, updated_at = excluded.updated_at, device_id = excluded.device_id"
    );
    sqlx::query(&sql)
        .bind(&p.id)
        .bind(fmt_date(p.plan_date))
        .bind(fmt_opt_ts(p.locked_at))
        .bind(i64::from(p.edited_after_lock))
        .bind(fmt_opt_ts(p.reviewed_at))
        .bind(&p.reflection)
        .bind(fmt_ts(p.updated_at))
        .bind(&p.device_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn upsert_task(tx: &mut Transaction<'_, Sqlite>, t: &Task) -> DbResult<()> {
    let sql = format!(
        "INSERT INTO tasks ({TASK_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET plan_id = excluded.plan_id, position = excluded.position, \
         title = excluded.title, note = excluded.note, status = excluded.status, \
         carried_from = excluded.carried_from, completed_at = excluded.completed_at, \
         updated_at = excluded.updated_at, device_id = excluded.device_id"
    );
    sqlx::query(&sql)
        .bind(&t.id)
        .bind(&t.plan_id)
        .bind(i64::from(t.position))
        .bind(&t.title)
        .bind(&t.note)
        .bind(t.status.as_str())
        .bind(&t.carried_from)
        .bind(fmt_opt_ts(t.completed_at))
        .bind(fmt_ts(t.updated_at))
        .bind(&t.device_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn upsert_session(tx: &mut Transaction<'_, Sqlite>, s: &Session) -> DbResult<()> {
    let sql = format!(
        "INSERT INTO sessions ({SESSION_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET task_id = excluded.task_id, started_at = excluded.started_at, \
         ended_at = excluded.ended_at, ended_reason = excluded.ended_reason, \
         last_interaction_at = excluded.last_interaction_at, device_id = excluded.device_id, \
         updated_at = excluded.updated_at"
    );
    sqlx::query(&sql)
        .bind(&s.id)
        .bind(&s.task_id)
        .bind(fmt_ts(s.started_at))
        .bind(fmt_opt_ts(s.ended_at))
        .bind(s.ended_reason.map(EndedReason::as_str))
        .bind(fmt_opt_ts(s.last_interaction_at))
        .bind(&s.device_id)
        .bind(fmt_ts(s.updated_at))
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn upsert_pomodoro(tx: &mut Transaction<'_, Sqlite>, p: &Pomodoro) -> DbResult<()> {
    let sql = format!(
        "INSERT INTO pomodoros ({POMODORO_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET task_id = excluded.task_id, session_id = excluded.session_id, \
         started_at = excluded.started_at, planned_seconds = excluded.planned_seconds, \
         ended_at = excluded.ended_at, outcome = excluded.outcome, \
         acknowledged_at = excluded.acknowledged_at, device_id = excluded.device_id, \
         updated_at = excluded.updated_at"
    );
    sqlx::query(&sql)
        .bind(&p.id)
        .bind(&p.task_id)
        .bind(&p.session_id)
        .bind(fmt_ts(p.started_at))
        .bind(p.planned_seconds)
        .bind(fmt_opt_ts(p.ended_at))
        .bind(p.outcome.map(PomodoroOutcome::as_str))
        .bind(fmt_opt_ts(p.acknowledged_at))
        .bind(&p.device_id)
        .bind(fmt_ts(p.updated_at))
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn insert_event(tx: &mut Transaction<'_, Sqlite>, e: &Event) -> DbResult<()> {
    let sql = format!("INSERT INTO events ({EVENT_COLS}) VALUES (?, ?, ?, ?, ?, ?)");
    sqlx::query(&sql)
        .bind(&e.id)
        .bind(&e.task_id)
        .bind(&e.plan_id)
        .bind(e.kind.as_str())
        .bind(fmt_ts(e.occurred_at))
        .bind(&e.device_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

// ----- lookups -------------------------------------------------------------------------

/// The most recent locked plan before `date`: the source of carryover.
pub async fn latest_locked_date_before(
    pool: &Pool,
    date: NaiveDate,
) -> DbResult<Option<NaiveDate>> {
    let found: Option<String> = sqlx::query_scalar(
        "SELECT plan_date FROM daily_plans WHERE plan_date < ? AND locked_at IS NOT NULL \
         ORDER BY plan_date DESC LIMIT 1",
    )
    .bind(fmt_date(date))
    .fetch_optional(pool)
    .await?;
    found.as_deref().map(parse_date).transpose()
}

/// Dates in `from..=to` that have a locked plan.
pub async fn locked_dates(
    pool: &Pool,
    from: NaiveDate,
    to: NaiveDate,
) -> DbResult<BTreeSet<NaiveDate>> {
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT plan_date FROM daily_plans WHERE locked_at IS NOT NULL AND plan_date BETWEEN ? AND ?",
    )
    .bind(fmt_date(from))
    .bind(fmt_date(to))
    .fetch_all(pool)
    .await?;
    rows.iter().map(|s| parse_date(s)).collect()
}

/// Plans that still have a running session: candidates for the day-end rollover.
pub async fn plans_with_open_sessions(pool: &Pool) -> DbResult<Vec<(String, NaiveDate)>> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT DISTINCT p.id, p.plan_date FROM daily_plans p \
         JOIN tasks t ON t.plan_id = p.id JOIN sessions s ON s.task_id = t.id \
         WHERE s.ended_at IS NULL",
    )
    .fetch_all(pool)
    .await?;
    rows.into_iter()
        .map(|(id, d)| Ok((id, parse_date(&d)?)))
        .collect()
}

pub async fn events_for_plan(pool: &Pool, plan_id: &str) -> DbResult<Vec<Event>> {
    let sql = format!("SELECT {EVENT_COLS} FROM events WHERE plan_id = ? ORDER BY occurred_at, id");
    sqlx::query_as::<_, EventRow>(&sql)
        .bind(plan_id)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(Event::try_from)
        .collect()
}

/// Events on plans dated `from..=to`, oldest first. Feeds the Stats view (Step 5).
#[cfg_attr(not(test), allow(dead_code))]
pub async fn events_between(pool: &Pool, from: NaiveDate, to: NaiveDate) -> DbResult<Vec<Event>> {
    let sql =
        "SELECT e.id, e.task_id, e.plan_id, e.kind, e.occurred_at, e.device_id FROM events e \
               JOIN daily_plans p ON p.id = e.plan_id WHERE p.plan_date BETWEEN ? AND ? \
               ORDER BY e.occurred_at, e.id";
    sqlx::query_as::<_, EventRow>(sql)
        .bind(fmt_date(from))
        .bind(fmt_date(to))
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(Event::try_from)
        .collect()
}

// ----- settings -------------------------------------------------------------------------

/// Settings from the table; unknown keys are ignored and unreadable values fall back to
/// the default for that key.
pub async fn load_settings(pool: &Pool) -> DbResult<Settings> {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM settings")
        .fetch_all(pool)
        .await?;
    let mut settings = Settings::default();
    for (key, value) in rows {
        if Settings::KEYS.contains(&key.as_str()) {
            let _ = settings.apply(&key, &value);
        }
    }
    Ok(settings)
}

pub async fn get_raw_setting(pool: &Pool, key: &str) -> DbResult<Option<String>> {
    Ok(
        sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(pool)
            .await?,
    )
}

pub async fn save_setting(pool: &Pool, key: &str, value: &str, now: DateTime<Utc>) -> DbResult<()> {
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value)
    .bind(fmt_ts(now))
    .execute(pool)
    .await?;
    Ok(())
}

/// This install's id, created on first run.
pub async fn ensure_device_id(pool: &Pool) -> DbResult<String> {
    if let Some(id) = get_raw_setting(pool, "device_id").await? {
        return Ok(id);
    }
    let id = plan::new_id();
    save_setting(pool, "device_id", &id, Utc::now()).await?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use chrono::TimeZone;

    const DEV: &str = "dev-a";

    fn date(d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 9, d).unwrap()
    }

    fn ctx(d: u32, h: u32, m: u32) -> Ctx<'static> {
        Ctx::new(
            Utc.with_ymd_and_hms(2026, 9, d, h, m, 0).unwrap(),
            date(d),
            DEV,
        )
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

    #[tokio::test]
    async fn migrations_apply_with_default_settings_and_a_stable_device_id() {
        let pool = open_in_memory().await.unwrap();
        assert_eq!(load_settings(&pool).await.unwrap(), Settings::default());
        let a = ensure_device_id(&pool).await.unwrap();
        let b = ensure_device_id(&pool).await.unwrap();
        assert_eq!(a, b);
        assert!(!a.is_empty());
    }

    #[tokio::test]
    async fn a_day_round_trips_through_the_store() {
        let pool = open_in_memory().await.unwrap();
        let c = ctx(3, 9, 0);
        let mut day = Day::draft(date(3), inputs(&["One", "Two", "Three"]), &c).unwrap();
        day.lock(&c).unwrap();
        let t1 = day.tasks[0].id.clone();
        day.pause(&t1, PauseReason::Break, &ctx(3, 9, 30)).unwrap();
        day.resume(&t1, &ctx(3, 9, 35)).unwrap();
        day.set_note(&t1, Some("first thing".into()), &c).unwrap();
        let events = day.pending_events.len();
        assert!(events > 0);

        save_day(&pool, &mut day).await.unwrap();
        assert!(
            day.pending_events.is_empty(),
            "events are cleared once written"
        );

        let loaded = load_day(&pool, date(3))
            .await
            .unwrap()
            .expect("plan exists");
        assert_eq!(loaded, day);
        assert_eq!(loaded.sessions.len(), 2);
        assert_eq!(loaded.tasks[0].note.as_deref(), Some("first thing"));
        assert_eq!(
            events_for_plan(&pool, &day.plan.id).await.unwrap().len(),
            events
        );

        // Saving again appends nothing new and changes nothing.
        save_day(&pool, &mut day).await.unwrap();
        assert_eq!(
            events_for_plan(&pool, &day.plan.id).await.unwrap().len(),
            events
        );
        assert_eq!(load_day(&pool, date(3)).await.unwrap().unwrap(), day);
    }

    #[tokio::test]
    async fn lookups_by_task_and_session_find_the_same_day() {
        let pool = open_in_memory().await.unwrap();
        let c = ctx(3, 9, 0);
        let mut day = Day::draft(date(3), inputs(&["One"]), &c).unwrap();
        day.lock(&c).unwrap();
        save_day(&pool, &mut day).await.unwrap();
        let sid = day.open_session().unwrap().id.clone();
        assert_eq!(
            load_day_by_task(&pool, &day.tasks[0].id)
                .await
                .unwrap()
                .unwrap(),
            day
        );
        assert_eq!(
            load_day_by_session(&pool, &sid).await.unwrap().unwrap(),
            day
        );
        assert_eq!(
            load_day_by_plan(&pool, &day.plan.id)
                .await
                .unwrap()
                .unwrap(),
            day
        );
        assert!(load_day_by_task(&pool, "nope").await.unwrap().is_none());
        assert!(load_day(&pool, date(4)).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn editing_out_a_task_deletes_it_and_its_sessions() {
        let pool = open_in_memory().await.unwrap();
        let c = ctx(3, 9, 0);
        let mut day = Day::draft(date(3), inputs(&["One", "Two"]), &c).unwrap();
        day.lock(&c).unwrap();
        save_day(&pool, &mut day).await.unwrap();
        let (t1, t2) = (day.tasks[0].id.clone(), day.tasks[1].id.clone());
        day.edit(
            vec![TaskInput {
                id: Some(t2.clone()),
                title: "Two".into(),
                ..Default::default()
            }],
            &ctx(3, 10, 0),
        )
        .unwrap();
        save_day(&pool, &mut day).await.unwrap();

        assert!(load_day_by_task(&pool, &t1).await.unwrap().is_none());
        let orphaned: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE task_id = ?")
            .bind(&t1)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(orphaned, 0, "sessions cascade with their task");
        let loaded = load_day(&pool, date(3)).await.unwrap().unwrap();
        assert_eq!(loaded.tasks.len(), 1);
        assert_eq!(loaded.tasks[0].id, t2);
        assert_eq!(loaded.tasks[0].status, TaskStatus::Active);
        assert_eq!(loaded, day);
    }

    #[tokio::test]
    async fn reordering_a_full_list_of_six_is_allowed() {
        let pool = open_in_memory().await.unwrap();
        let c = ctx(3, 9, 0);
        let mut day = Day::draft(date(3), inputs(&["1", "2", "3", "4", "5", "6"]), &c).unwrap();
        save_day(&pool, &mut day).await.unwrap();
        let mut reversed: Vec<TaskInput> = day
            .tasks
            .iter()
            .map(|t| TaskInput {
                id: Some(t.id.clone()),
                title: t.title.clone(),
                ..Default::default()
            })
            .collect();
        reversed.reverse();
        day.edit(reversed, &c).unwrap();
        save_day(&pool, &mut day).await.unwrap();
        let loaded = load_day(&pool, date(3)).await.unwrap().unwrap();
        assert_eq!(
            loaded
                .tasks
                .iter()
                .map(|t| t.title.as_str())
                .collect::<Vec<_>>(),
            vec!["6", "5", "4", "3", "2", "1"]
        );
        loaded.check_invariants().unwrap();
    }

    #[tokio::test]
    async fn locked_dates_and_carryover_source_ignore_drafts() {
        let pool = open_in_memory().await.unwrap();
        for d in [1, 2] {
            let c = ctx(d, 9, 0);
            let mut day = Day::draft(date(d), inputs(&["One"]), &c).unwrap();
            day.lock(&c).unwrap();
            save_day(&pool, &mut day).await.unwrap();
        }
        let mut draft = Day::draft(date(3), inputs(&["Draft"]), &ctx(3, 9, 0)).unwrap();
        save_day(&pool, &mut draft).await.unwrap();

        let locked = locked_dates(&pool, date(1), date(3)).await.unwrap();
        assert_eq!(locked, [date(1), date(2)].into_iter().collect());
        assert_eq!(
            latest_locked_date_before(&pool, date(3)).await.unwrap(),
            Some(date(2))
        );
        assert_eq!(
            latest_locked_date_before(&pool, date(4)).await.unwrap(),
            Some(date(2))
        );
        assert_eq!(
            latest_locked_date_before(&pool, date(1)).await.unwrap(),
            None
        );
        let days = load_days(&pool, date(1), date(3)).await.unwrap();
        assert_eq!(
            days.iter().map(|d| d.plan.plan_date).collect::<Vec<_>>(),
            vec![date(3), date(2), date(1)]
        );
    }

    #[tokio::test]
    async fn plans_with_open_sessions_lists_only_running_ones() {
        let pool = open_in_memory().await.unwrap();
        let c = ctx(3, 9, 0);
        let mut running = Day::draft(date(3), inputs(&["One"]), &c).unwrap();
        running.lock(&c).unwrap();
        save_day(&pool, &mut running).await.unwrap();
        let mut paused = Day::draft(date(2), inputs(&["One"]), &ctx(2, 9, 0)).unwrap();
        paused.lock(&ctx(2, 9, 0)).unwrap();
        paused
            .pause(
                &paused.tasks[0].id.clone(),
                PauseReason::Paused,
                &ctx(2, 10, 0),
            )
            .unwrap();
        save_day(&pool, &mut paused).await.unwrap();

        let open = plans_with_open_sessions(&pool).await.unwrap();
        assert_eq!(open, vec![(running.plan.id.clone(), date(3))]);
    }

    #[tokio::test]
    async fn settings_persist_and_events_between_dates_are_found() {
        let pool = open_in_memory().await.unwrap();
        save_setting(&pool, "evening_hour", "20", Utc::now())
            .await
            .unwrap();
        assert_eq!(load_settings(&pool).await.unwrap().evening_hour, 20);
        save_setting(&pool, "evening_hour", "bad", Utc::now())
            .await
            .unwrap();
        assert_eq!(
            load_settings(&pool).await.unwrap().evening_hour,
            18,
            "unreadable values fall back"
        );

        let c = ctx(3, 9, 0);
        let mut day = Day::draft(date(3), inputs(&["One"]), &c).unwrap();
        day.lock(&c).unwrap();
        save_day(&pool, &mut day).await.unwrap();
        let events = events_between(&pool, date(1), date(3)).await.unwrap();
        assert_eq!(
            events.iter().map(|e| e.kind).collect::<Vec<_>>(),
            vec![EventKind::Locked, EventKind::Activated]
        );
        assert!(events_between(&pool, date(4), date(5))
            .await
            .unwrap()
            .is_empty());
    }
}
