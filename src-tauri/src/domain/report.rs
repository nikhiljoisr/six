//! The plain-text export: a readable week, facts only.

use chrono::{DateTime, Utc};

use super::analytics::{percent, Stats};
use super::model::TaskStatus;
use super::plan::Day;
use super::timing::describe;

fn status_word(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Done => "done",
        TaskStatus::Active | TaskStatus::Paused | TaskStatus::Planned => "unfinished",
        TaskStatus::Deferred => "carried",
        TaskStatus::Skipped => "dropped",
    }
}

/// A week (or any range) as text. `days` are the locked days in the range, any order.
pub fn text_report(stats: &Stats, days: &[Day], now: DateTime<Utc>) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "Six — {} to {}\n\n",
        stats.from.format("%a %-d %b %Y"),
        stats.to.format("%a %-d %b %Y")
    ));
    out.push_str(&format!(
        "Days planned: {}/{}\n",
        stats.days_planned, stats.days_in_range
    ));
    out.push_str(&format!(
        "Tasks done: {} of {}\n",
        stats.tasks_done, stats.tasks_total
    ));
    out.push_str(&format!(
        "Top 3 done: {} of {} ({}%)\n",
        stats.top3_done,
        stats.top3_total,
        percent(stats.top3_done, stats.top3_total)
    ));
    out.push_str(&format!(
        "Tasks 4–6 done: {} of {} ({}%)\n",
        stats.rest_done,
        stats.rest_total,
        percent(stats.rest_done, stats.rest_total)
    ));
    out.push_str(&format!("Focus: {}\n", describe(stats.focus_seconds)));
    out.push_str(&format!("Pomodoros: {}\n", stats.pomodoros));
    out.push_str(&format!("Overrides: {}\n", stats.overrides));
    if let Some(mc) = &stats.most_carried {
        out.push_str(&format!(
            "Most carried: {} ({} {})\n",
            mc.title,
            mc.days,
            if mc.days == 1 { "day" } else { "days" }
        ));
    }

    let mut sorted: Vec<&Day> = days.iter().filter(|d| d.plan.is_locked()).collect();
    sorted.sort_by_key(|d| d.plan.plan_date);
    for d in sorted {
        out.push_str(&format!(
            "\n{} — {}/{} done, {}\n",
            d.plan.plan_date.format("%a %-d %b"),
            d.done_count(),
            d.tasks.len(),
            describe(d.total_focus_seconds(now))
        ));
        for t in &d.tasks {
            let focus = d.focus_seconds(&t.id, now);
            let poms = d.pomodoros_completed(Some(&t.id));
            let mut line = format!("  {}. {} — {}", t.position, t.title, status_word(t.status));
            if focus > 0 {
                line.push_str(&format!(", {}", describe(focus)));
            }
            if poms > 0 {
                line.push_str(&format!(
                    ", {} pomodoro{}",
                    poms,
                    if poms == 1 { "" } else { "s" }
                ));
            }
            out.push_str(&line);
            out.push('\n');
        }
        if let Some(r) = d
            .plan
            .reflection
            .as_deref()
            .filter(|r| !r.trim().is_empty())
        {
            out.push_str(&format!("  Thought: {}\n", r.trim()));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::analytics::stats;
    use crate::domain::plan::{Ctx, TaskInput};
    use chrono::{NaiveDate, TimeZone};

    #[test]
    fn the_report_reads_as_plain_facts() {
        let date = NaiveDate::from_ymd_opt(2026, 9, 3).unwrap();
        let at = |h: u32| Utc.with_ymd_and_hms(2026, 9, 3, h, 0, 0).unwrap();
        let c = Ctx::new(at(9), date, "dev");
        let mut day = Day::draft(
            date,
            vec![
                TaskInput {
                    title: "Ship it".into(),
                    ..Default::default()
                },
                TaskInput {
                    title: "Call mum".into(),
                    ..Default::default()
                },
            ],
            &c,
        )
        .unwrap();
        day.lock(&c).unwrap();
        let t1 = day.tasks[0].id.clone();
        day.complete(&t1, &Ctx::new(at(10), date, "dev")).unwrap();
        day.complete_review(
            Some("Good day.".into()),
            vec![],
            &Ctx::new(at(18), date, "dev"),
        )
        .unwrap();
        let s = stats(std::slice::from_ref(&day), &[], date, date, at(19));
        let text = text_report(&s, std::slice::from_ref(&day), at(19));
        assert!(text.starts_with("Six — Thu 3 Sep 2026 to Thu 3 Sep 2026\n"));
        assert!(text.contains("Days planned: 1/1\n"));
        assert!(text.contains("Tasks done: 1 of 2\n"));
        assert!(text.contains("Top 3 done: 1 of 2 (50%)\n"));
        assert!(text.contains("\nThu 3 Sep — 1/2 done, "));
        assert!(text.contains("  1. Ship it — done, 1h 0m\n"));
        assert!(text.contains("  2. Call mum — carried, 8h 0m\n"), "{text}");
        assert!(text.contains("  Thought: Good day.\n"));
    }
}
