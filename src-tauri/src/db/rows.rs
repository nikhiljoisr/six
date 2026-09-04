//! Row structs and conversions. Timestamps are ISO 8601 UTC text; dates are YYYY-MM-DD.

use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use sqlx::FromRow;

use super::DbError;
use crate::domain::*;

pub fn fmt_ts(dt: DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn fmt_opt_ts(dt: Option<DateTime<Utc>>) -> Option<String> {
    dt.map(fmt_ts)
}

pub fn parse_ts(s: &str) -> Result<DateTime<Utc>, DbError> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .map_err(|e| DbError::Corrupt(format!("timestamp {s:?}: {e}")))
}

pub fn parse_opt_ts(s: Option<&str>) -> Result<Option<DateTime<Utc>>, DbError> {
    s.map(parse_ts).transpose()
}

pub fn fmt_date(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

pub fn parse_date(s: &str) -> Result<NaiveDate, DbError> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .map_err(|e| DbError::Corrupt(format!("date {s:?}: {e}")))
}

#[derive(Debug, FromRow)]
pub struct PlanRow {
    pub id: String,
    pub plan_date: String,
    pub locked_at: Option<String>,
    pub edited_after_lock: i64,
    pub reviewed_at: Option<String>,
    pub reflection: Option<String>,
    pub updated_at: String,
    pub device_id: String,
}

impl TryFrom<PlanRow> for Plan {
    type Error = DbError;
    fn try_from(r: PlanRow) -> Result<Self, DbError> {
        Ok(Plan {
            id: r.id,
            plan_date: parse_date(&r.plan_date)?,
            locked_at: parse_opt_ts(r.locked_at.as_deref())?,
            edited_after_lock: r.edited_after_lock != 0,
            reviewed_at: parse_opt_ts(r.reviewed_at.as_deref())?,
            reflection: r.reflection,
            updated_at: parse_ts(&r.updated_at)?,
            device_id: r.device_id,
        })
    }
}

#[derive(Debug, FromRow)]
pub struct TaskRow {
    pub id: String,
    pub plan_id: String,
    pub position: i64,
    pub title: String,
    pub note: Option<String>,
    pub status: String,
    pub carried_from: Option<String>,
    pub completed_at: Option<String>,
    pub updated_at: String,
    pub device_id: String,
}

impl TryFrom<TaskRow> for Task {
    type Error = DbError;
    fn try_from(r: TaskRow) -> Result<Self, DbError> {
        Ok(Task {
            status: TaskStatus::parse(&r.status)
                .ok_or_else(|| DbError::Corrupt(format!("task status {:?}", r.status)))?,
            position: u8::try_from(r.position)
                .map_err(|_| DbError::Corrupt(format!("task position {}", r.position)))?,
            id: r.id,
            plan_id: r.plan_id,
            title: r.title,
            note: r.note,
            carried_from: r.carried_from,
            completed_at: parse_opt_ts(r.completed_at.as_deref())?,
            updated_at: parse_ts(&r.updated_at)?,
            device_id: r.device_id,
        })
    }
}

#[derive(Debug, FromRow)]
pub struct SessionRow {
    pub id: String,
    pub task_id: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub ended_reason: Option<String>,
    pub last_interaction_at: Option<String>,
    pub idle_from: Option<String>,
    pub idle_until: Option<String>,
    pub device_id: String,
    pub updated_at: String,
}

impl TryFrom<SessionRow> for Session {
    type Error = DbError;
    fn try_from(r: SessionRow) -> Result<Self, DbError> {
        let ended_reason = match r.ended_reason.as_deref() {
            None => None,
            Some(s) => Some(
                EndedReason::parse(s)
                    .ok_or_else(|| DbError::Corrupt(format!("ended_reason {s:?}")))?,
            ),
        };
        Ok(Session {
            id: r.id,
            task_id: r.task_id,
            started_at: parse_ts(&r.started_at)?,
            ended_at: parse_opt_ts(r.ended_at.as_deref())?,
            ended_reason,
            last_interaction_at: parse_opt_ts(r.last_interaction_at.as_deref())?,
            idle_from: parse_opt_ts(r.idle_from.as_deref())?,
            idle_until: parse_opt_ts(r.idle_until.as_deref())?,
            device_id: r.device_id,
            updated_at: parse_ts(&r.updated_at)?,
        })
    }
}

#[derive(Debug, FromRow)]
pub struct EventRow {
    pub id: String,
    pub task_id: Option<String>,
    pub plan_id: Option<String>,
    pub kind: String,
    pub occurred_at: String,
    pub device_id: String,
}

impl TryFrom<EventRow> for Event {
    type Error = DbError;
    fn try_from(r: EventRow) -> Result<Self, DbError> {
        Ok(Event {
            kind: EventKind::parse(&r.kind)
                .ok_or_else(|| DbError::Corrupt(format!("event kind {:?}", r.kind)))?,
            id: r.id,
            task_id: r.task_id,
            plan_id: r.plan_id,
            occurred_at: parse_ts(&r.occurred_at)?,
            device_id: r.device_id,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn timestamps_round_trip_in_utc_with_millis() {
        let dt = Utc.with_ymd_and_hms(2026, 9, 3, 12, 34, 56).unwrap();
        assert_eq!(fmt_ts(dt), "2026-09-03T12:34:56.000Z");
        assert_eq!(parse_ts("2026-09-03T12:34:56.000Z").unwrap(), dt);
        assert_eq!(parse_ts("2026-09-03T18:04:56+05:30").unwrap(), dt);
        assert!(parse_ts("yesterday").is_err());
    }

    #[test]
    fn dates_round_trip() {
        let d = NaiveDate::from_ymd_opt(2026, 9, 3).unwrap();
        assert_eq!(fmt_date(d), "2026-09-03");
        assert_eq!(parse_date("2026-09-03").unwrap(), d);
        assert!(parse_date("3/9/2026").is_err());
    }
}

#[derive(Debug, sqlx::FromRow)]
pub struct PomodoroRow {
    pub id: String,
    pub task_id: String,
    pub session_id: Option<String>,
    pub started_at: String,
    pub planned_seconds: i64,
    pub ended_at: Option<String>,
    pub outcome: Option<String>,
    pub acknowledged_at: Option<String>,
    pub device_id: String,
    pub updated_at: String,
}

impl TryFrom<PomodoroRow> for Pomodoro {
    type Error = DbError;
    fn try_from(r: PomodoroRow) -> Result<Self, DbError> {
        let outcome = match r.outcome.as_deref() {
            None => None,
            Some(s) => Some(
                PomodoroOutcome::parse(s)
                    .ok_or_else(|| DbError::Corrupt(format!("unknown pomodoro outcome {s}")))?,
            ),
        };
        Ok(Pomodoro {
            id: r.id,
            task_id: r.task_id,
            session_id: r.session_id,
            started_at: parse_ts(&r.started_at)?,
            planned_seconds: r.planned_seconds,
            ended_at: parse_opt_ts(r.ended_at.as_deref())?,
            outcome,
            acknowledged_at: parse_opt_ts(r.acknowledged_at.as_deref())?,
            device_id: r.device_id,
            updated_at: parse_ts(&r.updated_at)?,
        })
    }
}
