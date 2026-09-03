//! Session timing. Elapsed time is always derived from timestamps, never counted.

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;

use super::model::Session;

/// A session longer than this with no interaction is "likely idle".
pub const IDLE_THRESHOLD_SECS: i64 = 3 * 3600;

/// Seconds a single session has run (or ran). Open sessions are measured up to `now`.
pub fn session_seconds(session: &Session, now: DateTime<Utc>) -> i64 {
    let end = session.ended_at.unwrap_or(now);
    (end - session.started_at).num_seconds().max(0)
}

/// Total focus seconds recorded for a task.
pub fn focus_seconds(sessions: &[Session], task_id: &str, now: DateTime<Utc>) -> i64 {
    sessions
        .iter()
        .filter(|s| s.task_id == task_id)
        .map(|s| session_seconds(s, now))
        .sum()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IdleFlag {
    pub session_id: String,
    pub task_id: String,
    pub started_at: DateTime<Utc>,
    /// Effective end: `ended_at`, or `now` for a running session.
    pub ended_at: DateTime<Utc>,
    pub seconds: i64,
    /// Where the trim would cut: the last interaction, or the start if there was none.
    pub suggested_end: DateTime<Utc>,
    pub suggested_seconds: i64,
}

/// Sessions longer than three hours whose last interaction was more than three hours
/// before they ended. The suggested cut is the last interaction.
pub fn idle_flags(sessions: &[Session], now: DateTime<Utc>) -> Vec<IdleFlag> {
    let threshold = Duration::seconds(IDLE_THRESHOLD_SECS);
    sessions
        .iter()
        .filter_map(|s| {
            let end = s.ended_at.unwrap_or(now);
            let duration = end - s.started_at;
            if duration <= threshold {
                return None;
            }
            let last = s
                .last_interaction_at
                .unwrap_or(s.started_at)
                .clamp(s.started_at, end);
            if end - last <= threshold {
                return None;
            }
            Some(IdleFlag {
                session_id: s.id.clone(),
                task_id: s.task_id.clone(),
                started_at: s.started_at,
                ended_at: end,
                seconds: duration.num_seconds(),
                suggested_end: last,
                suggested_seconds: (last - s.started_at).num_seconds(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::model::EndedReason;
    use chrono::TimeZone;

    fn at(h: u32, m: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 3, h, m, 0).unwrap()
    }

    fn session(
        id: &str,
        task: &str,
        start: DateTime<Utc>,
        end: Option<DateTime<Utc>>,
        last: Option<DateTime<Utc>>,
    ) -> Session {
        Session {
            id: id.into(),
            task_id: task.into(),
            started_at: start,
            ended_at: end,
            ended_reason: end.map(|_| EndedReason::Paused),
            last_interaction_at: last,
            device_id: "dev".into(),
            updated_at: start,
        }
    }

    #[test]
    fn closed_sessions_sum_and_open_ones_count_to_now() {
        let sessions = vec![
            session("a", "t1", at(9, 0), Some(at(9, 30)), None),
            session("b", "t1", at(10, 0), None, None),
            session("c", "t2", at(10, 0), Some(at(11, 0)), None),
        ];
        assert_eq!(
            focus_seconds(&sessions, "t1", at(10, 45)),
            30 * 60 + 45 * 60
        );
        assert_eq!(focus_seconds(&sessions, "t2", at(12, 0)), 3600);
        assert_eq!(focus_seconds(&sessions, "t3", at(12, 0)), 0);
    }

    #[test]
    fn a_laptop_that_slept_still_measures_wall_clock_time() {
        // No counter ran while asleep; the timestamps carry the truth.
        let s = session("a", "t1", at(9, 0), Some(at(13, 0)), None);
        assert_eq!(session_seconds(&s, at(13, 0)), 4 * 3600);
    }

    #[test]
    fn duration_never_negative() {
        let s = session("a", "t1", at(9, 0), None, None);
        assert_eq!(session_seconds(&s, at(8, 0)), 0);
    }

    #[test]
    fn short_sessions_are_never_flagged() {
        let sessions = vec![session("a", "t1", at(9, 0), Some(at(11, 59)), None)];
        assert!(idle_flags(&sessions, at(12, 0)).is_empty());
    }

    #[test]
    fn long_session_with_recent_interaction_is_not_flagged() {
        let sessions = vec![session(
            "a",
            "t1",
            at(9, 0),
            Some(at(14, 0)),
            Some(at(13, 30)),
        )];
        assert!(idle_flags(&sessions, at(14, 0)).is_empty());
    }

    #[test]
    fn long_session_with_no_interaction_is_flagged_with_cut_at_last_touch() {
        let sessions = vec![session(
            "a",
            "t1",
            at(9, 0),
            Some(at(18, 0)),
            Some(at(9, 5)),
        )];
        let flags = idle_flags(&sessions, at(18, 0));
        assert_eq!(flags.len(), 1);
        assert_eq!(flags[0].suggested_end, at(9, 5));
        assert_eq!(flags[0].suggested_seconds, 5 * 60);
        assert_eq!(flags[0].seconds, 9 * 3600);
    }

    #[test]
    fn running_session_is_measured_to_now_and_cut_defaults_to_start() {
        let sessions = vec![session("a", "t1", at(9, 0), None, None)];
        let flags = idle_flags(&sessions, at(13, 0));
        assert_eq!(flags.len(), 1);
        assert_eq!(flags[0].ended_at, at(13, 0));
        assert_eq!(flags[0].suggested_end, at(9, 0));
    }
}
