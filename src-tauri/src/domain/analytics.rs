//! Weekly facts for the Stats view and the export. Pure functions over loaded days.

use std::collections::HashMap;

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::Serialize;

use super::model::{Event, EventKind, TaskStatus};
use super::plan::Day;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DayStat {
    pub date: NaiveDate,
    pub planned: bool,
    pub tasks_total: usize,
    pub tasks_done: usize,
    pub focus_seconds: i64,
    pub pomodoros: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MostCarried {
    pub title: String,
    /// How many days it rolled forward before this copy.
    pub days: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Stats {
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub days_in_range: usize,
    pub days_planned: usize,
    pub tasks_total: usize,
    pub tasks_done: usize,
    pub top3_total: usize,
    pub top3_done: usize,
    pub rest_total: usize,
    pub rest_done: usize,
    pub focus_seconds: i64,
    pub pomodoros: usize,
    pub overrides: usize,
    /// One entry per calendar day in the range, oldest first; unplanned days are zeros.
    pub trend: Vec<DayStat>,
    pub most_carried: Option<MostCarried>,
}

/// Facts for `from..=to` over the locked days given (drafts are ignored).
pub fn stats(
    days: &[Day],
    events: &[Event],
    from: NaiveDate,
    to: NaiveDate,
    now: DateTime<Utc>,
) -> Stats {
    let locked: Vec<&Day> = days
        .iter()
        .filter(|d| d.plan.is_locked() && d.plan.plan_date >= from && d.plan.plan_date <= to)
        .collect();
    let by_date: HashMap<NaiveDate, &Day> = locked.iter().map(|d| (d.plan.plan_date, *d)).collect();

    let mut trend = Vec::new();
    let mut cursor = from;
    while cursor <= to {
        trend.push(match by_date.get(&cursor) {
            Some(d) => DayStat {
                date: cursor,
                planned: true,
                tasks_total: d.tasks.len(),
                tasks_done: d.done_count(),
                focus_seconds: d.total_focus_seconds(now),
                pomodoros: d.pomodoros_completed(None),
            },
            None => DayStat {
                date: cursor,
                planned: false,
                tasks_total: 0,
                tasks_done: 0,
                focus_seconds: 0,
                pomodoros: 0,
            },
        });
        cursor += Duration::days(1);
    }

    let plan_ids: Vec<&str> = locked.iter().map(|d| d.plan.id.as_str()).collect();
    let overrides = events
        .iter()
        .filter(|e| e.kind == EventKind::Overridden)
        .filter(|e| {
            e.plan_id
                .as_deref()
                .is_some_and(|id| plan_ids.contains(&id))
        })
        .count();

    let mut s = Stats {
        from,
        to,
        days_in_range: trend.len(),
        days_planned: locked.len(),
        tasks_total: 0,
        tasks_done: 0,
        top3_total: 0,
        top3_done: 0,
        rest_total: 0,
        rest_done: 0,
        focus_seconds: 0,
        pomodoros: 0,
        overrides,
        trend,
        most_carried: most_carried(days),
    };
    for d in &locked {
        for t in &d.tasks {
            let done = t.status == TaskStatus::Done;
            s.tasks_total += 1;
            s.tasks_done += usize::from(done);
            if t.position <= 3 {
                s.top3_total += 1;
                s.top3_done += usize::from(done);
            } else {
                s.rest_total += 1;
                s.rest_done += usize::from(done);
            }
        }
        s.focus_seconds += d.total_focus_seconds(now);
        s.pomodoros += d.pomodoros_completed(None);
    }
    s
}

/// The task that rolled forward the most days before finishing (or not). Ties go to the
/// most recent copy. Follows `carried_from` lineage across all days given.
pub fn most_carried(days: &[Day]) -> Option<MostCarried> {
    let mut parent: HashMap<&str, Option<&str>> = HashMap::new();
    let mut dates: HashMap<&str, NaiveDate> = HashMap::new();
    let mut titles: HashMap<&str, &str> = HashMap::new();
    for d in days {
        for t in &d.tasks {
            parent.insert(&t.id, t.carried_from.as_deref());
            dates.insert(&t.id, d.plan.plan_date);
            titles.insert(&t.id, &t.title);
        }
    }
    let mut best: Option<(usize, NaiveDate, &str)> = None;
    for (&id, _) in &parent {
        let mut hops = 0;
        let mut cur = id;
        let mut seen = 0;
        while let Some(Some(p)) = parent.get(cur) {
            hops += 1;
            seen += 1;
            if seen > 1000 {
                break; // a cycle would be corrupt data; never loop forever
            }
            cur = p;
        }
        if hops == 0 {
            continue;
        }
        let date = dates[id];
        let better = match best {
            None => true,
            Some((h, d, _)) => hops > h || (hops == h && date > d),
        };
        if better {
            best = Some((hops, date, id));
        }
    }
    best.map(|(days, _, id)| MostCarried {
        title: titles[id].to_string(),
        days,
    })
}

/// Top-3 completion as a percentage (0 when there was nothing to complete).
pub fn percent(done: usize, total: usize) -> u32 {
    if total == 0 {
        0
    } else {
        u32::try_from(done * 100 / total).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::plan::{Ctx, TaskInput};
    use chrono::TimeZone;

    fn date(d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 9, d).unwrap()
    }

    fn at(d: u32, h: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, d, h, 0, 0).unwrap()
    }

    fn day(d: u32, titles: &[&str], carried: &[Option<&str>]) -> Day {
        let c = Ctx::new(at(d, 9), date(d), "dev");
        let inputs = titles
            .iter()
            .enumerate()
            .map(|(i, t)| TaskInput {
                title: (*t).to_string(),
                carried_from: carried.get(i).copied().flatten().map(str::to_string),
                ..Default::default()
            })
            .collect();
        let mut day = Day::draft(date(d), inputs, &c).unwrap();
        day.lock(&c).unwrap();
        day
    }

    #[test]
    fn counts_days_tasks_top_three_focus_and_overrides() {
        let mut d1 = day(1, &["A", "B", "C", "D"], &[]);
        let ids: Vec<String> = d1.tasks.iter().map(|t| t.id.clone()).collect();
        let c = Ctx::new(at(1, 10), date(1), "dev");
        d1.complete(&ids[0], &c).unwrap(); // 1h focus, task 1 done, task 2 active
        let c2 = Ctx::new(at(1, 12), date(1), "dev");
        d1.activate(&ids[3], true, &c2).unwrap(); // override: task 4 active, task 2 back
        let c3 = Ctx::new(at(1, 13), date(1), "dev");
        d1.complete(&ids[3], &c3).unwrap();
        let events: Vec<Event> = d1.pending_events.clone();
        let d2 = day(2, &["E"], &[]);
        let s = stats(&[d1, d2], &events, date(1), date(7), at(2, 10));
        assert_eq!(s.days_in_range, 7);
        assert_eq!(s.days_planned, 2);
        assert_eq!((s.tasks_total, s.tasks_done), (5, 2));
        assert_eq!((s.top3_total, s.top3_done), (4, 1));
        assert_eq!((s.rest_total, s.rest_done), (1, 1));
        assert_eq!(s.overrides, 1);
        // day 1: 1h (task 1) + 2h (task 2 superseded at 12) + 1h (task 4) + task 2 re-activated
        // at 13 and still open → measured to `now` (next day 10:00 = 21h) — sessions are
        // facts; the rollover would have closed it in the app.
        assert!(s.focus_seconds >= 4 * 3600);
        assert_eq!(s.trend.len(), 7);
        assert!(s.trend[0].planned && !s.trend[2].planned);
        assert_eq!(s.trend[0].tasks_done, 2);
        assert_eq!(s.trend[1].tasks_done, 0);
        assert_eq!(percent(s.top3_done, s.top3_total), 25);
        assert_eq!(percent(0, 0), 0);
    }

    #[test]
    fn most_carried_follows_lineage_and_prefers_the_longest_chain() {
        let d1 = day(1, &["Renew domain", "Other"], &[]);
        let r1 = d1.tasks[0].id.clone();
        let o1 = d1.tasks[1].id.clone();
        let d2 = day(2, &["Renew domain", "Other"], &[Some(&r1), Some(&o1)]);
        let r2 = d2.tasks[0].id.clone();
        let d3 = day(3, &["Renew domain"], &[Some(&r2)]);
        let mc = most_carried(&[d1, d2, d3]).unwrap();
        assert_eq!(mc.title, "Renew domain");
        assert_eq!(mc.days, 2);
        assert!(most_carried(&[day(4, &["Fresh"], &[])]).is_none());
    }
}
