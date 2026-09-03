//! What the menu bar says. Pure: takes a small summary of the day and returns the text.
//! The title changes on state change only, never per second.

/// Title truncation length for the active task (SPEC §4.11).
pub const TITLE_CHARS: usize = 28;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TraySummary {
    /// Today's list exists and is locked.
    pub has_list: bool,
    pub task_count: usize,
    pub done_count: usize,
    pub all_done: bool,
    /// The active task, if one is running: (position, title).
    pub active: Option<(u8, String)>,
    /// A task is paused (holds the slot without running).
    pub paused: bool,
    pub after_evening: bool,
    pub tomorrow_planned: bool,
    /// Compact style: position only, for crowded (notched) menu bars.
    pub compact: bool,
}

/// Cut a title to `TITLE_CHARS` characters, marking the cut with an ellipsis.
pub fn truncate_title(title: &str) -> String {
    let title = title.trim();
    if title.chars().count() <= TITLE_CHARS {
        return title.to_string();
    }
    let mut cut: String = title.chars().take(TITLE_CHARS - 1).collect();
    let trimmed = cut.trim_end().to_string();
    cut = trimmed;
    cut.push('…');
    cut
}

pub fn tray_title(s: &TraySummary) -> String {
    if let Some((position, title)) = &s.active {
        if s.compact {
            return format!("{position}/{}", s.task_count);
        }
        return format!("{position}/{} · {}", s.task_count, truncate_title(title));
    }
    if s.compact && (!s.has_list || (s.after_evening && !s.tomorrow_planned)) {
        return "Six".to_string();
    }
    if s.after_evening && !s.tomorrow_planned {
        return "Six · plan tomorrow".to_string();
    }
    if !s.has_list {
        return "Six · plan today".to_string();
    }
    if s.all_done {
        return "Six · done".to_string();
    }
    // Paused, between tasks, or reviewed with carry-overs: the day's count.
    let _ = s.paused;
    format!("Six · {}/{}", s.done_count, s.task_count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> TraySummary {
        TraySummary {
            has_list: true,
            task_count: 6,
            done_count: 1,
            ..Default::default()
        }
    }

    #[test]
    fn active_task_shows_position_and_title() {
        let s = TraySummary {
            active: Some((2, "Draft Q2 playbook".into())),
            ..base()
        };
        assert_eq!(tray_title(&s), "2/6 · Draft Q2 playbook");
    }

    #[test]
    fn long_titles_are_cut_at_twenty_eight_characters() {
        let long = "Write the investor update and send it to everyone";
        let s = TraySummary {
            active: Some((1, long.into())),
            ..base()
        };
        let title = tray_title(&s);
        assert_eq!(title, "1/6 · Write the investor update a…"); // 27 chars + ellipsis
        assert_eq!(truncate_title(long).chars().count(), TITLE_CHARS);
        assert_eq!(truncate_title("Short"), "Short");
        assert_eq!(
            truncate_title("Exactly twenty-eight chars!!"),
            "Exactly twenty-eight chars!!"
        );
    }

    #[test]
    fn an_active_task_wins_even_in_the_evening() {
        let s = TraySummary {
            active: Some((4, "Walk".into())),
            after_evening: true,
            ..base()
        };
        assert_eq!(tray_title(&s), "4/6 · Walk");
    }

    #[test]
    fn no_list_says_plan_today() {
        let s = TraySummary {
            has_list: false,
            task_count: 0,
            ..Default::default()
        };
        assert_eq!(tray_title(&s), "Six · plan today");
    }

    #[test]
    fn evening_without_tomorrow_says_plan_tomorrow() {
        let s = TraySummary {
            after_evening: true,
            ..base()
        };
        assert_eq!(tray_title(&s), "Six · plan tomorrow");
        let none = TraySummary {
            has_list: false,
            after_evening: true,
            ..Default::default()
        };
        assert_eq!(tray_title(&none), "Six · plan tomorrow");
        let planned = TraySummary {
            after_evening: true,
            tomorrow_planned: true,
            ..base()
        };
        assert_eq!(tray_title(&planned), "Six · 1/6");
    }

    #[test]
    fn paused_or_between_tasks_shows_the_count() {
        let s = TraySummary {
            paused: true,
            done_count: 4,
            ..base()
        };
        assert_eq!(tray_title(&s), "Six · 4/6");
        let between = TraySummary {
            done_count: 4,
            ..base()
        };
        assert_eq!(tray_title(&between), "Six · 4/6");
    }

    #[test]
    fn compact_style_keeps_only_the_position() {
        let s = TraySummary {
            active: Some((2, "Draft Q2 playbook".into())),
            compact: true,
            ..base()
        };
        assert_eq!(tray_title(&s), "2/6");
        let idle = TraySummary {
            has_list: false,
            task_count: 0,
            compact: true,
            ..Default::default()
        };
        assert_eq!(tray_title(&idle), "Six");
        let evening = TraySummary {
            after_evening: true,
            compact: true,
            ..base()
        };
        assert_eq!(tray_title(&evening), "Six");
        let between = TraySummary {
            done_count: 4,
            compact: true,
            ..base()
        };
        assert_eq!(tray_title(&between), "Six · 4/6");
        let done = TraySummary {
            done_count: 6,
            all_done: true,
            compact: true,
            ..base()
        };
        assert_eq!(tray_title(&done), "Six · done");
    }

    #[test]
    fn all_done_says_done() {
        let s = TraySummary {
            done_count: 6,
            all_done: true,
            ..base()
        };
        assert_eq!(tray_title(&s), "Six · done");
        let evening = TraySummary {
            after_evening: true,
            tomorrow_planned: true,
            ..s
        };
        assert_eq!(tray_title(&evening), "Six · done");
    }
}
