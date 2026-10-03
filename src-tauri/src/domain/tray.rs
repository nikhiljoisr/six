//! What the menu bar says. Pure: takes a small summary of the day and returns the text.
//! The title changes on state change only, never per second. With "Minutes left" switched
//! on in Settings it also carries the whole minutes left of a running pomodoro or break,
//! which changes once a minute.

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
    /// Whole minutes left of the running pomodoro, or of the break the paused task is on;
    /// `None` when neither is running or the setting is off.
    pub minutes_left: Option<u32>,
}

/// Seconds remaining as the whole minutes a person would say: 61 s is "2m", 60 s is "1m",
/// 1 s is "1m". Nothing left is no reading at all.
pub fn minutes_left(remaining_seconds: i64) -> Option<u32> {
    (remaining_seconds > 0).then(|| u32::try_from((remaining_seconds + 59) / 60).unwrap_or(u32::MAX))
}

/// The shortest a word-boundary cut may leave; below this a hard cut reads better.
const MIN_WORD_CUT: usize = 12;

/// Words a cut title should not end on ("Clean up the map and…").
const DANGLING: [&str; 12] = ["and", "or", "the", "a", "an", "to", "of", "for", "with", "in", "on", "&"];

/// Cut a title to at most `TITLE_CHARS` characters, marking the cut with an ellipsis. The
/// cut falls at the end of a word when that keeps at least `MIN_WORD_CUT` characters, and
/// never leaves a connecting word dangling; a single long word is cut where it must be.
pub fn truncate_title(title: &str) -> String {
    let title = title.trim();
    let chars: Vec<char> = title.chars().collect();
    if chars.len() <= TITLE_CHARS {
        return title.to_string();
    }
    let room = TITLE_CHARS - 1;
    let hard: String = chars[..room].iter().collect();
    let mut cut = if chars[room].is_whitespace() {
        hard.trim_end().to_string()
    } else {
        match hard.rfind(char::is_whitespace) {
            Some(i) if hard[..i].trim_end().chars().count() >= MIN_WORD_CUT => hard[..i].trim_end().to_string(),
            _ => hard.trim_end().to_string(),
        }
    };
    if let Some(i) = cut.rfind(char::is_whitespace) {
        let last = cut[i..].trim().to_lowercase();
        let kept = cut[..i].trim_end();
        if DANGLING.contains(&last.as_str()) && kept.chars().count() >= MIN_WORD_CUT {
            cut = kept.to_string();
        }
    }
    let cut = cut.trim_end_matches([',', ';', ':', '-', '–']).trim_end().to_string();
    format!("{cut}…")
}

pub fn tray_title(s: &TraySummary) -> String {
    if let Some((position, title)) = &s.active {
        // The minutes sit right after the position, where a crowded menu bar clips last.
        let clock = s.minutes_left.map(|m| format!(" · {m}m")).unwrap_or_default();
        if s.compact {
            return format!("{position}/{}{clock}", s.task_count);
        }
        return format!("{position}/{}{clock} · {}", s.task_count, truncate_title(title));
    }
    if let (true, Some(m)) = (s.paused, s.minutes_left) {
        // On a break with the minutes shown: when to come back is the one useful thing.
        return format!("Six · break {m}m");
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
    fn long_titles_are_cut_at_a_word_within_twenty_eight_characters() {
        let long = "Write the investor update and send it to everyone";
        let s = TraySummary {
            active: Some((1, long.into())),
            ..base()
        };
        // Cut at a word, and not left hanging on "and".
        assert_eq!(tray_title(&s), "1/6 · Write the investor update…");
        assert!(truncate_title(long).chars().count() <= TITLE_CHARS);
        assert_eq!(
            truncate_title("Clean up Network map and consider combining with Relationship OS"),
            "Clean up Network map…"
        );
        // The cut lands exactly on a space: nothing more is lost.
        assert_eq!(truncate_title("Send the quarterly numbers, then call Priya"), "Send the quarterly numbers…");
        // One long word, or a first word too short to stand alone: cut where it must be.
        assert_eq!(truncate_title("Supercalifragilisticexpialidocious"), "Supercalifragilisticexpiali…");
        assert_eq!(
            truncate_title("Fix internationalisationsettings now"),
            "Fix internationalisationset…"
        );
        // Never longer than the limit, whatever the script.
        assert!(truncate_title("ಕನ್ನಡ ಪಠ್ಯ ಇಲ್ಲಿ ತುಂಬಾ ಉದ್ದವಾಗಿದೆ ಮತ್ತು ಮುಂದುವರಿಯುತ್ತದೆ").chars().count() <= TITLE_CHARS);
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
    fn minutes_left_ride_with_the_position_and_a_break_shows_its_own() {
        let running = TraySummary {
            active: Some((2, "Draft Q2 playbook".into())),
            minutes_left: Some(18),
            ..base()
        };
        assert_eq!(tray_title(&running), "2/6 · 18m · Draft Q2 playbook");
        let compact = TraySummary {
            compact: true,
            ..running.clone()
        };
        assert_eq!(tray_title(&compact), "2/6 · 18m");
        let on_break = TraySummary {
            paused: true,
            minutes_left: Some(3),
            done_count: 4,
            ..base()
        };
        assert_eq!(tray_title(&on_break), "Six · break 3m");
        // A break wins over the evening prompt while it runs: it is what is happening.
        let evening_break = TraySummary {
            after_evening: true,
            ..on_break.clone()
        };
        assert_eq!(tray_title(&evening_break), "Six · break 3m");
        // Minutes without a pomodoro or a break change nothing.
        let idle = TraySummary {
            minutes_left: Some(9),
            done_count: 4,
            ..base()
        };
        assert_eq!(tray_title(&idle), "Six · 4/6");
    }

    #[test]
    fn minutes_are_whole_and_rounded_up_and_nothing_left_is_no_reading() {
        assert_eq!(minutes_left(25 * 60), Some(25));
        assert_eq!(minutes_left(24 * 60 + 1), Some(25));
        assert_eq!(minutes_left(61), Some(2));
        assert_eq!(minutes_left(60), Some(1));
        assert_eq!(minutes_left(1), Some(1));
        assert_eq!(minutes_left(0), None);
        assert_eq!(minutes_left(-30), None);
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
