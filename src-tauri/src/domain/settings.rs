//! User settings: parsed from the `settings` table, validated here.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    /// Hour (0–23) at which the evening ritual begins.
    pub evening_hour: u32,
    /// Minutes after a session starts before the check-in nudge.
    pub checkin_minutes: u32,
    /// Length of a "Take 5" break, in minutes.
    pub break_minutes: u32,
    /// Hour (0–23) at which a new day begins; late-night work belongs to the evening before.
    pub day_start_hour: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            evening_hour: 18,
            checkin_minutes: 75,
            break_minutes: 5,
            day_start_hour: 5,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SettingsError {
    #[error("unknown setting: {0}")]
    UnknownKey(String),
    #[error("{key} must be a whole number between {min} and {max}")]
    OutOfRange {
        key: &'static str,
        min: u32,
        max: u32,
    },
}

impl Settings {
    pub const KEYS: [&'static str; 4] = [
        "evening_hour",
        "checkin_minutes",
        "break_minutes",
        "day_start_hour",
    ];

    /// Apply one key/value pair as stored in the settings table.
    pub fn apply(&mut self, key: &str, value: &str) -> Result<(), SettingsError> {
        let (slot, name, min, max): (&mut u32, &'static str, u32, u32) = match key {
            "evening_hour" => (&mut self.evening_hour, "evening_hour", 0, 23),
            "checkin_minutes" => (&mut self.checkin_minutes, "checkin_minutes", 5, 480),
            "break_minutes" => (&mut self.break_minutes, "break_minutes", 1, 60),
            "day_start_hour" => (&mut self.day_start_hour, "day_start_hour", 0, 23),
            other => return Err(SettingsError::UnknownKey(other.to_string())),
        };
        let parsed: u32 = value
            .trim()
            .parse()
            .map_err(|_| SettingsError::OutOfRange {
                key: name,
                min,
                max,
            })?;
        if parsed < min || parsed > max {
            return Err(SettingsError::OutOfRange {
                key: name,
                min,
                max,
            });
        }
        *slot = parsed;
        Ok(())
    }

    /// Validate a key/value pair without applying it.
    pub fn validate(key: &str, value: &str) -> Result<(), SettingsError> {
        Settings::default().apply(key, value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_brief() {
        let s = Settings::default();
        assert_eq!(
            (
                s.evening_hour,
                s.checkin_minutes,
                s.break_minutes,
                s.day_start_hour
            ),
            (18, 75, 5, 5)
        );
    }

    #[test]
    fn applies_valid_values_and_rejects_bad_ones() {
        let mut s = Settings::default();
        s.apply("evening_hour", "20").unwrap();
        s.apply("day_start_hour", " 4 ").unwrap();
        assert_eq!(s.evening_hour, 20);
        assert_eq!(s.day_start_hour, 4);
        assert!(matches!(
            s.apply("evening_hour", "24"),
            Err(SettingsError::OutOfRange { .. })
        ));
        assert!(matches!(
            s.apply("break_minutes", "0"),
            Err(SettingsError::OutOfRange { .. })
        ));
        assert!(matches!(
            s.apply("checkin_minutes", "soon"),
            Err(SettingsError::OutOfRange { .. })
        ));
        assert!(matches!(
            s.apply("theme", "dark"),
            Err(SettingsError::UnknownKey(_))
        ));
        assert_eq!(s.evening_hour, 20, "a rejected value changes nothing");
    }
}
