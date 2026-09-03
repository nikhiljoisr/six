//! The streak is counted from data, never stored: consecutive calendar days, ending
//! today or tomorrow, that have a locked plan.

use std::collections::BTreeSet;

use chrono::{Duration, NaiveDate};

pub fn streak(locked_dates: &BTreeSet<NaiveDate>, today: NaiveDate) -> u32 {
    let tomorrow = today + Duration::days(1);
    let mut cursor = if locked_dates.contains(&tomorrow) {
        tomorrow
    } else if locked_dates.contains(&today) {
        today
    } else {
        return 0;
    };
    let mut count = 0;
    while locked_dates.contains(&cursor) {
        count += 1;
        cursor -= Duration::days(1);
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 9, day).unwrap()
    }

    fn set(days: &[u32]) -> BTreeSet<NaiveDate> {
        days.iter().map(|&x| d(x)).collect()
    }

    #[test]
    fn no_plans_no_streak() {
        assert_eq!(streak(&set(&[]), d(10)), 0);
    }

    #[test]
    fn only_today_planned_is_one() {
        assert_eq!(streak(&set(&[10]), d(10)), 1);
    }

    #[test]
    fn planning_tomorrow_tonight_extends_the_streak() {
        assert_eq!(streak(&set(&[8, 9, 10]), d(10)), 3);
        assert_eq!(streak(&set(&[8, 9, 10, 11]), d(10)), 4);
    }

    #[test]
    fn tomorrow_alone_counts_when_today_was_missed() {
        // Today has no plan but tomorrow is locked: the chain ending tomorrow is length 1.
        assert_eq!(streak(&set(&[8, 11]), d(10)), 1);
    }

    #[test]
    fn a_missed_day_resets() {
        assert_eq!(streak(&set(&[5, 6, 8, 9, 10]), d(10)), 3);
    }

    #[test]
    fn old_plans_do_not_count_if_today_and_tomorrow_are_unplanned() {
        assert_eq!(streak(&set(&[5, 6, 7, 8, 9]), d(10)), 0);
    }
}
