//! Pomodoro: a planned stretch of focus on the active task, 25 minutes by default. A
//! pomodoro annotates a session; the session remains the truth for focus time. It rings
//! when its planned end passes; leaving the task before then records an interruption,
//! finishing the task early records that. Facts only, never a penalty.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PomodoroOutcome {
    /// Ran to its planned end.
    Completed,
    /// The task left the active slot before the end (pause, defer, skip, day end…).
    Interrupted,
    /// The task was completed before the end.
    FinishedEarly,
}

impl PomodoroOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            PomodoroOutcome::Completed => "completed",
            PomodoroOutcome::Interrupted => "interrupted",
            PomodoroOutcome::FinishedEarly => "finished_early",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "completed" => PomodoroOutcome::Completed,
            "interrupted" => PomodoroOutcome::Interrupted,
            "finished_early" => PomodoroOutcome::FinishedEarly,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pomodoro {
    pub id: String,
    pub task_id: String,
    pub session_id: Option<String>,
    pub started_at: DateTime<Utc>,
    pub planned_seconds: i64,
    pub ended_at: Option<DateTime<Utc>>,
    pub outcome: Option<PomodoroOutcome>,
    /// When the ring was answered (a break, one more, or keep going).
    pub acknowledged_at: Option<DateTime<Utc>>,
    pub device_id: String,
    pub updated_at: DateTime<Utc>,
}

impl Pomodoro {
    pub fn is_open(&self) -> bool {
        self.ended_at.is_none()
    }

    pub fn planned_end(&self) -> DateTime<Utc> {
        self.started_at + Duration::seconds(self.planned_seconds)
    }

    pub fn remaining_seconds(&self, now: DateTime<Utc>) -> i64 {
        (self.planned_end() - now).num_seconds().max(0)
    }

    /// Rang, and the user has not yet said what comes next.
    pub fn is_awaiting_ack(&self) -> bool {
        self.outcome == Some(PomodoroOutcome::Completed) && self.acknowledged_at.is_none()
    }
}

/// What the active card shows about pomodoros right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PomodoroPhase {
    /// Nothing running; a pomodoro can be started.
    Idle,
    /// Counting down.
    Running,
    /// Rang; waiting for a tap (break, one more, keep going).
    Done,
}
