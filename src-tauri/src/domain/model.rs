use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

/// Six is the ceiling, always.
pub const MAX_TASKS: usize = 6;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Planned,
    Active,
    Paused,
    Done,
    Deferred,
    Skipped,
}

impl TaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            TaskStatus::Planned => "planned",
            TaskStatus::Active => "active",
            TaskStatus::Paused => "paused",
            TaskStatus::Done => "done",
            TaskStatus::Deferred => "deferred",
            TaskStatus::Skipped => "skipped",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "planned" => TaskStatus::Planned,
            "active" => TaskStatus::Active,
            "paused" => TaskStatus::Paused,
            "done" => TaskStatus::Done,
            "deferred" => TaskStatus::Deferred,
            "skipped" => TaskStatus::Skipped,
            _ => return None,
        })
    }

    /// Unfinished: still on the day's list (planned, active or paused).
    pub fn is_open(self) -> bool {
        matches!(
            self,
            TaskStatus::Planned | TaskStatus::Active | TaskStatus::Paused
        )
    }

    /// Finished one way or another (done, deferred or skipped).
    pub fn is_terminal(self) -> bool {
        !self.is_open()
    }

    /// Holding the day's single slot (active or paused).
    pub fn is_current(self) -> bool {
        matches!(self, TaskStatus::Active | TaskStatus::Paused)
    }
}

impl std::fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EndedReason {
    Done,
    Paused,
    Break,
    Deferred,
    Skipped,
    Superseded,
    DayEnd,
    Trimmed,
}

impl EndedReason {
    pub fn as_str(self) -> &'static str {
        match self {
            EndedReason::Done => "done",
            EndedReason::Paused => "paused",
            EndedReason::Break => "break",
            EndedReason::Deferred => "deferred",
            EndedReason::Skipped => "skipped",
            EndedReason::Superseded => "superseded",
            EndedReason::DayEnd => "day_end",
            EndedReason::Trimmed => "trimmed",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "done" => EndedReason::Done,
            "paused" => EndedReason::Paused,
            "break" => EndedReason::Break,
            "deferred" => EndedReason::Deferred,
            "skipped" => EndedReason::Skipped,
            "superseded" => EndedReason::Superseded,
            "day_end" => EndedReason::DayEnd,
            "trimmed" => EndedReason::Trimmed,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    Locked,
    EditedAfterLock,
    Activated,
    Completed,
    Paused,
    Resumed,
    Deferred,
    Skipped,
    Overridden,
    Reopened,
    Reviewed,
}

impl EventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EventKind::Locked => "locked",
            EventKind::EditedAfterLock => "edited_after_lock",
            EventKind::Activated => "activated",
            EventKind::Completed => "completed",
            EventKind::Paused => "paused",
            EventKind::Resumed => "resumed",
            EventKind::Deferred => "deferred",
            EventKind::Skipped => "skipped",
            EventKind::Overridden => "overridden",
            EventKind::Reopened => "reopened",
            EventKind::Reviewed => "reviewed",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "locked" => EventKind::Locked,
            "edited_after_lock" => EventKind::EditedAfterLock,
            "activated" => EventKind::Activated,
            "completed" => EventKind::Completed,
            "paused" => EventKind::Paused,
            "resumed" => EventKind::Resumed,
            "deferred" => EventKind::Deferred,
            "skipped" => EventKind::Skipped,
            "overridden" => EventKind::Overridden,
            "reopened" => EventKind::Reopened,
            "reviewed" => EventKind::Reviewed,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Plan {
    pub id: String,
    pub plan_date: NaiveDate,
    pub locked_at: Option<DateTime<Utc>>,
    pub edited_after_lock: bool,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub reflection: Option<String>,
    pub updated_at: DateTime<Utc>,
    pub device_id: String,
}

impl Plan {
    pub fn is_locked(&self) -> bool {
        self.locked_at.is_some()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub plan_id: String,
    pub position: u8,
    pub title: String,
    pub note: Option<String>,
    pub status: TaskStatus,
    pub carried_from: Option<String>,
    pub completed_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
    pub device_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub task_id: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub ended_reason: Option<EndedReason>,
    pub last_interaction_at: Option<DateTime<Utc>>,
    pub device_id: String,
    pub updated_at: DateTime<Utc>,
}

impl Session {
    pub fn is_open(&self) -> bool {
        self.ended_at.is_none()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub task_id: Option<String>,
    pub plan_id: Option<String>,
    pub kind: EventKind,
    pub occurred_at: DateTime<Utc>,
    pub device_id: String,
}
