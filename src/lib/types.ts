// Mirrors the Rust read model (src-tauri/src/commands/snapshot.rs). No logic lives here.

export type TaskStatus = "planned" | "active" | "paused" | "done" | "deferred" | "skipped";

export interface TaskView {
  id: string;
  position: number;
  title: string;
  note: string | null;
  status: TaskStatus;
  carried_from: string | null;
  completed_at: string | null;
  /** Recorded focus time in seconds, including the running session up to `now`. */
  focus_seconds: number;
  /** Start of the running session, if this task is active. */
  session_started_at: string | null;
  pomodoros_completed: number;
}

export interface PlanView {
  id: string;
  date: string;
  locked_at: string | null;
  edited_after_lock: boolean;
  reviewed_at: string | null;
  reflection: string | null;
  is_today: boolean;
  task_count: number;
  done_count: number;
  all_done: boolean;
  total_focus_seconds: number;
  pomodoros_completed: number;
  tasks: TaskView[];
}

export type PomodoroPhase = "idle" | "running" | "done";

/** The pomodoro layer for today's active task, as Rust reports it. */
export interface PomodoroView {
  enabled: boolean;
  minutes: number;
  long_break_minutes: number;
  set_size: number;
  phase: PomodoroPhase;
  task_id: string | null;
  started_at: string | null;
  ends_at: string | null;
  remaining_seconds: number;
  completed_today: number;
  completed_for_task: number;
  long_break_next: boolean;
}

export interface TaskInput {
  id?: string | null;
  title: string;
  note?: string | null;
  carried_from?: string | null;
}

export interface CarryoverPreview {
  from_date: string;
  tasks: TaskInput[];
}

export interface Settings {
  evening_hour: number;
  checkin_minutes: number;
  break_minutes: number;
  day_start_hour: number;
  pomodoro_enabled: boolean;
  pomodoro_minutes: number;
  long_break_minutes: number;
  pomodoros_before_long_break: number;
}

export type Phase = "before_evening" | "after_evening";

export interface DaySnapshot {
  today: string;
  tomorrow: string;
  now: string;
  phase: Phase;
  settings: Settings;
  streak: number;
  today_plan: PlanView | null;
  tomorrow_plan: PlanView | null;
  carryover_preview: CarryoverPreview | null;
  pomodoro: PomodoroView;
}

export interface IdleFlag {
  session_id: string;
  task_id: string;
  started_at: string;
  ended_at: string;
  seconds: number;
  suggested_end: string;
  suggested_seconds: number;
}

export interface ReviewView {
  plan: PlanView;
  top_three_done: boolean;
  overrides: number;
  idle_flags: IdleFlag[];
  unfinished: string[];
}

/** Focus time of today's current task, from Rust, for the ticking display. */
export interface Elapsed {
  task_id: string;
  status: TaskStatus;
  focus_seconds: number;
  pomodoro: PomodoroPhase;
  pomodoro_remaining: number;
}

export type Decision = "carry" | "drop";

export interface ReviewDecision {
  task_id: string;
  decision: Decision;
}

export type PauseReason = "paused" | "break";

export interface AppError {
  code: string;
  message: string;
}

export function isAppError(e: unknown): e is AppError {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}
