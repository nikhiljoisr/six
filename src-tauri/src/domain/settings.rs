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
    /// Pomodoro layer on or off (on by default).
    pub pomodoro_enabled: bool,
    /// Length of one pomodoro, in minutes.
    pub pomodoro_minutes: u32,
    /// Length of the long break after a set, in minutes.
    pub long_break_minutes: u32,
    /// Pomodoros in a set before the long break.
    pub pomodoros_before_long_break: u32,
    /// Menu bar style: "full" (task title) or "compact" (position only).
    pub tray_style: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            evening_hour: 18,
            checkin_minutes: 75,
            break_minutes: 5,
            day_start_hour: 5,
            pomodoro_enabled: true,
            pomodoro_minutes: 25,
            long_break_minutes: 15,
            pomodoros_before_long_break: 4,
            tray_style: "full".to_string(),
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
    pub const KEYS: [&'static str; 9] = [
        "evening_hour",
        "checkin_minutes",
        "break_minutes",
        "day_start_hour",
        "pomodoro_enabled",
        "pomodoro_minutes",
        "long_break_minutes",
        "pomodoros_before_long_break",
        "tray_style",
    ];

    /// Apply one key/value pair as stored in the settings table.
    pub fn apply(&mut self, key: &str, value: &str) -> Result<(), SettingsError> {
        if key == "tray_style" {
            self.tray_style = match value.trim() {
                "full" => "full".to_string(),
                "compact" => "compact".to_string(),
                _ => {
                    return Err(SettingsError::OutOfRange {
                        key: "tray_style",
                        min: 0,
                        max: 1,
                    })
                }
            };
            return Ok(());
        }
        if key == "pomodoro_enabled" {
            self.pomodoro_enabled = match value.trim() {
                "1" | "true" | "on" => true,
                "0" | "false" | "off" => false,
                _ => {
                    return Err(SettingsError::OutOfRange {
                        key: "pomodoro_enabled",
                        min: 0,
                        max: 1,
                    })
                }
            };
            return Ok(());
        }
        let (slot, name, min, max): (&mut u32, &'static str, u32, u32) = match key {
            "evening_hour" => (&mut self.evening_hour, "evening_hour", 0, 23),
            "checkin_minutes" => (&mut self.checkin_minutes, "checkin_minutes", 5, 480),
            "break_minutes" => (&mut self.break_minutes, "break_minutes", 1, 60),
            "day_start_hour" => (&mut self.day_start_hour, "day_start_hour", 0, 23),
            "pomodoro_minutes" => (&mut self.pomodoro_minutes, "pomodoro_minutes", 1, 180),
            "long_break_minutes" => (&mut self.long_break_minutes, "long_break_minutes", 1, 120),
            "pomodoros_before_long_break" => (
                &mut self.pomodoros_before_long_break,
                "pomodoros_before_long_break",
                1,
                12,
            ),
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
        assert!(
            s.pomodoro_enabled,
            "pomodoro is on by default (Nikhil, 3 Sep 2026)"
        );
        assert_eq!(
            (
                s.pomodoro_minutes,
                s.long_break_minutes,
                s.pomodoros_before_long_break
            ),
            (25, 15, 4)
        );
    }

    #[test]
    fn pomodoro_settings_apply_and_validate() {
        let mut s = Settings::default();
        s.apply("pomodoro_enabled", "0").unwrap();
        assert!(!s.pomodoro_enabled);
        s.apply("pomodoro_enabled", "true").unwrap();
        assert!(s.pomodoro_enabled);
        assert!(s.apply("pomodoro_enabled", "maybe").is_err());
        s.apply("pomodoro_minutes", "50").unwrap();
        assert_eq!(s.pomodoro_minutes, 50);
        assert!(s.apply("pomodoro_minutes", "0").is_err());
        assert!(s.apply("pomodoros_before_long_break", "13").is_err());
        assert!(Settings::validate("long_break_minutes", "30").is_ok());
        s.apply("tray_style", "compact").unwrap();
        assert_eq!(s.tray_style, "compact");
        assert!(s.apply("tray_style", "huge").is_err());
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
