//! Pure domain logic: the task state machine, session timing, day boundaries and the
//! streak. Nothing in here touches the database, the clock, or Tauri. Every function
//! takes its inputs (including "now" and "today") explicitly so it can be tested.

pub mod day;
pub mod model;
pub mod plan;
pub mod settings;
pub mod streak;
pub mod timing;

#[cfg(test)]
mod tests;

pub use model::*;
pub use plan::{Ctx, Day, DomainError, PauseReason, ReviewDecision, TaskInput};
pub use settings::{Settings, SettingsError};
