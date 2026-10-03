//! The review that is owed: the last locked day, if it ended without one.

use chrono::NaiveDate;

use super::model::Plan;

/// How long a missed review keeps being offered. Past a week it is history.
pub const OFFER_DAYS: i64 = 7;

/// The day whose review is still owed: the most recent locked list before today, when it
/// was never reviewed and is no more than `OFFER_DAYS` old. `last_locked` is that list.
pub fn owed(last_locked: Option<&Plan>, today: NaiveDate) -> Option<(String, NaiveDate)> {
    let plan = last_locked?;
    let age = (today - plan.plan_date).num_days();
    let offered = plan.is_locked() && plan.reviewed_at.is_none() && (1..=OFFER_DAYS).contains(&age);
    offered.then(|| (plan.id.clone(), plan.plan_date))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    fn plan(day: u32, locked: bool, reviewed: bool) -> Plan {
        let at = Utc.with_ymd_and_hms(2026, 9, day, 12, 0, 0).unwrap();
        Plan {
            id: format!("p{day}"),
            plan_date: NaiveDate::from_ymd_opt(2026, 9, day).unwrap(),
            locked_at: locked.then_some(at),
            edited_after_lock: false,
            reviewed_at: reviewed.then_some(at),
            reflection: None,
            updated_at: at,
            device_id: "dev".into(),
        }
    }

    fn date(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 9, day).unwrap()
    }

    #[test]
    fn the_last_locked_day_is_owed_a_review_until_it_has_one() {
        assert_eq!(owed(Some(&plan(5, true, false)), date(7)), Some(("p5".into(), date(5))));
        assert_eq!(owed(Some(&plan(5, true, true)), date(7)), None, "already reviewed");
        assert_eq!(owed(Some(&plan(5, false, false)), date(7)), None, "a draft is not a day");
        assert_eq!(owed(None, date(7)), None);
    }

    #[test]
    fn the_offer_lasts_a_week_and_never_covers_today() {
        assert!(owed(Some(&plan(1, true, false)), date(8)).is_some(), "seven days old");
        assert!(owed(Some(&plan(1, true, false)), date(9)).is_none(), "eight days old");
        assert!(owed(Some(&plan(7, true, false)), date(7)).is_none(), "today has its own review");
    }
}
