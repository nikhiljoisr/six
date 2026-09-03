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
  tasks: TaskView[];
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
