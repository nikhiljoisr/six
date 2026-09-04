//! Session timing. Elapsed time is always derived from timestamps, never counted.

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;

use super::model::Session;

/// A stretch of a session longer than this with no interaction is "likely idle".
pub const IDLE_THRESHOLD_SECS: i64 = 3 * 3600;

pub fn idle_threshold() -> Duration {
    Duration::seconds(IDLE_THRESHOLD_SECS)
}

/// Seconds a single session has run (or ran). Open sessions are measured up to `now`.
pub fn session_seconds(session: &Session, now: DateTime<Utc>) -> i64 {
    let end = session.ended_at.unwrap_or(now);
    (end - session.started_at).num_seconds().max(0)
}

/// "1h 15m" / "12m" / "0m": the app's one way of writing a duration.
pub fn describe(seconds: i64) -> String {
    let minutes = seconds.max(0) / 60;
    if minutes >= 60 {
        format!("{}h {}m", minutes / 60, minutes % 60)
    } else {
        format!("{minutes}m")
    }
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
    /// The silence: from the last interaction before it to the first one after it, or
    /// to the end of the session when nothing followed.
    pub gap_start: DateTime<Utc>,
    pub gap_end: DateTime<Utc>,
    pub gap_seconds: i64,
    /// What the session would measure with the silence taken out.
    pub suggested_seconds: i64,
}

/// Sessions with a silence of more than three hours: the one the session recorded when
/// the user came back, or the stretch since the last interaction when nothing followed.
/// Whichever is longer is the one offered.
pub fn idle_flags(sessions: &[Session], now: DateTime<Utc>) -> Vec<IdleFlag> {
    let threshold = idle_threshold();
    sessions
        .iter()
        .filter_map(|s| {
            let end = s.ended_at.unwrap_or(now).max(s.started_at);
            let duration = end - s.started_at;
            let last = s
                .last_interaction_at
                .unwrap_or(s.started_at)
                .clamp(s.started_at, end);
            let trailing = Some((last, end)).filter(|(a, b)| *b - *a > threshold);
            let recorded = s
                .idle_gap()
                .map(|(a, b)| (a.clamp(s.started_at, end), b.clamp(s.started_at, end)))
                .filter(|(a, b)| *b - *a > threshold);
            let (gap_start, gap_end) = [recorded, trailing]
                .into_iter()
                .flatten()
                .max_by_key(|(a, b)| *b - *a)?;
            let gap = gap_end - gap_start;
            Some(IdleFlag {
                session_id: s.id.clone(),
                task_id: s.task_id.clone(),
                started_at: s.started_at,
                ended_at: end,
                seconds: duration.num_seconds(),
                gap_start,
                gap_end,
                gap_seconds: gap.num_seconds(),
                suggested_seconds: (duration - gap).num_seconds().max(0),
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
            idle_from: None,
            idle_until: None,
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
        assert!(idle_flags(&[s], at(8, 0)).is_empty(), "a clock set back flags nothing");
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
    fn long_session_with_no_interaction_is_flagged_from_the_last_touch_to_the_end() {
        let sessions = vec![session(
            "a",
            "t1",
            at(9, 0),
            Some(at(18, 0)),
            Some(at(9, 5)),
        )];
        let flags = idle_flags(&sessions, at(18, 0));
        assert_eq!(flags.len(), 1);
        assert_eq!((flags[0].gap_start, flags[0].gap_end), (at(9, 5), at(18, 0)));
        assert_eq!(flags[0].gap_seconds, 8 * 3600 + 55 * 60);
        assert_eq!(flags[0].suggested_seconds, 5 * 60);
        assert_eq!(flags[0].seconds, 9 * 3600);
    }

    #[test]
    fn running_session_is_measured_to_now_and_the_silence_starts_at_the_start() {
        let sessions = vec![session("a", "t1", at(9, 0), None, None)];
        let flags = idle_flags(&sessions, at(13, 0));
        assert_eq!(flags.len(), 1);
        assert_eq!(flags[0].ended_at, at(13, 0));
        assert_eq!((flags[0].gap_start, flags[0].gap_end), (at(9, 0), at(13, 0)));
    }

    #[test]
    fn a_recorded_silence_is_offered_even_after_the_user_came_back() {
        let mut s = session("a", "t1", at(9, 0), Some(at(18, 0)), Some(at(17, 55)));
        s.idle_from = Some(at(10, 0));
        s.idle_until = Some(at(14, 0));
        let flags = idle_flags(&[s], at(18, 0));
        assert_eq!((flags[0].gap_start, flags[0].gap_end), (at(10, 0), at(14, 0)));
        assert_eq!(flags[0].suggested_seconds, 5 * 3600);
    }

    #[test]
    fn the_longer_of_recorded_and_trailing_silence_wins() {
        let mut s = session("a", "t1", at(9, 0), None, Some(at(14, 0)));
        s.idle_from = Some(at(10, 0));
        s.idle_until = Some(at(13, 30));
        // Trailing 4h since 14:00 beats the recorded 3h30.
        let flags = idle_flags(&[s.clone()], at(18, 0));
        assert_eq!((flags[0].gap_start, flags[0].gap_end), (at(14, 0), at(18, 0)));
        // Earlier, the recorded one is the only candidate over three hours.
        let flags = idle_flags(&[s], at(16, 0));
        assert_eq!((flags[0].gap_start, flags[0].gap_end), (at(10, 0), at(13, 30)));
    }

    #[test]
    fn a_recorded_silence_under_the_threshold_is_ignored() {
        let mut s = session("a", "t1", at(9, 0), Some(at(12, 0)), Some(at(11, 59)));
        s.idle_from = Some(at(9, 0));
        s.idle_until = Some(at(11, 0));
        assert!(idle_flags(&[s], at(12, 0)).is_empty());
    }
}
