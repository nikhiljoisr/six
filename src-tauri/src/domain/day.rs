//! Day boundaries. "Today" is the local date at (now − day_start_hour hours), so work
//! done at 01:00 still belongs to the evening before.

use chrono::{Duration, NaiveDate, NaiveDateTime};

/// The business date for a local wall-clock time.
pub fn business_date(local_now: NaiveDateTime, day_start_hour: u32) -> NaiveDate {
    (local_now - Duration::hours(i64::from(day_start_hour))).date()
}

/// The local instant at which `date`'s business day ends, i.e. the start of the next one.
pub fn day_end_local(date: NaiveDate, day_start_hour: u32) -> NaiveDateTime {
    (date + Duration::days(1))
        .and_hms_opt(day_start_hour, 0, 0)
        .expect("day_start_hour is validated to 0..=23")
}

/// The next rollover instant strictly after `local_now`. Used by the scheduler (Step 5).
#[cfg_attr(not(test), allow(dead_code))]
pub fn next_rollover_local(local_now: NaiveDateTime, day_start_hour: u32) -> NaiveDateTime {
    day_end_local(business_date(local_now, day_start_hour), day_start_hour)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ndt(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(y, mo, d)
            .unwrap()
            .and_hms_opt(h, mi, 0)
            .unwrap()
    }

    #[test]
    fn late_night_counts_toward_previous_day() {
        assert_eq!(
            business_date(ndt(2026, 9, 3, 4, 59), 5),
            NaiveDate::from_ymd_opt(2026, 9, 2).unwrap()
        );
        assert_eq!(
            business_date(ndt(2026, 9, 3, 0, 10), 5),
            NaiveDate::from_ymd_opt(2026, 9, 2).unwrap()
        );
    }

    #[test]
    fn rollover_hour_starts_the_new_day() {
        assert_eq!(
            business_date(ndt(2026, 9, 3, 5, 0), 5),
            NaiveDate::from_ymd_opt(2026, 9, 3).unwrap()
        );
        assert_eq!(
            business_date(ndt(2026, 9, 3, 23, 59), 5),
            NaiveDate::from_ymd_opt(2026, 9, 3).unwrap()
        );
    }

    #[test]
    fn midnight_rollover_when_hour_is_zero() {
        assert_eq!(
            business_date(ndt(2026, 9, 3, 0, 0), 0),
            NaiveDate::from_ymd_opt(2026, 9, 3).unwrap()
        );
        assert_eq!(
            business_date(ndt(2026, 9, 2, 23, 59), 0),
            NaiveDate::from_ymd_opt(2026, 9, 2).unwrap()
        );
    }

    #[test]
    fn day_end_is_next_calendar_day_at_rollover_hour() {
        assert_eq!(
            day_end_local(NaiveDate::from_ymd_opt(2026, 9, 3).unwrap(), 5),
            ndt(2026, 9, 4, 5, 0)
        );
        // month boundary
        assert_eq!(
            day_end_local(NaiveDate::from_ymd_opt(2026, 9, 30).unwrap(), 5),
            ndt(2026, 10, 1, 5, 0)
        );
    }

    #[test]
    fn next_rollover_is_strictly_after_now() {
        assert_eq!(
            next_rollover_local(ndt(2026, 9, 3, 4, 59), 5),
            ndt(2026, 9, 3, 5, 0)
        );
        assert_eq!(
            next_rollover_local(ndt(2026, 9, 3, 5, 0), 5),
            ndt(2026, 9, 4, 5, 0)
        );
        assert_eq!(
            next_rollover_local(ndt(2026, 9, 3, 18, 0), 5),
            ndt(2026, 9, 4, 5, 0)
        );
    }
}
