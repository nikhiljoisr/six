//! Parked thoughts: one line jotted down mid-task so it can be let go of. They are
//! read back in the evening review. Six is still the ceiling: a parked thought never
//! becomes a task by itself.

use super::plan::DomainError;

/// The longest a parked thought may be, in characters. One line, not a document.
pub const MAX_CHARS: usize = 200;
/// The most a day holds. Past this the list has stopped being a place to let go.
pub const MAX_PER_DAY: usize = 30;

/// One line of text: whitespace runs collapsed, ends trimmed, cut at `MAX_CHARS`.
pub fn clean(text: &str) -> Result<String, DomainError> {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.is_empty() {
        return Err(DomainError::EmptyJot);
    }
    Ok(line.chars().take(MAX_CHARS).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_thought_is_one_trimmed_line() {
        assert_eq!(clean("  call   the\n bank \t back ").unwrap(), "call the bank back");
        assert_eq!(clean("\n \t "), Err(DomainError::EmptyJot));
        assert_eq!(clean(""), Err(DomainError::EmptyJot));
    }

    #[test]
    fn a_long_thought_is_cut_at_the_limit_by_characters() {
        let long = "ಅ".repeat(MAX_CHARS + 50);
        assert_eq!(clean(&long).unwrap().chars().count(), MAX_CHARS);
        let exact = "a".repeat(MAX_CHARS);
        assert_eq!(clean(&exact).unwrap(), exact);
    }
}
