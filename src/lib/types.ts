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
  tray_style: "full" | "compact";
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

export type NudgeKind =
  | "evening_ritual"
  | "check_in"
  | "break_over"
  | "unplanned_morning"
  | "end_of_day"
  | "pomodoro_done";

/** A nudge as Rust planned it: shown as an OS notification when away, a banner when here. */
export interface Nudge {
  kind: NudgeKind;
  due: string;
  title: string;
  body: string;
  actions: { id: string; label: string }[];
  task_id: string | null;
}

export interface DayStat {
  date: string;
  planned: boolean;
  tasks_total: number;
  tasks_done: number;
  focus_seconds: number;
  pomodoros: number;
}

export interface Stats {
  from: string;
  to: string;
  days_in_range: number;
  days_planned: number;
  tasks_total: number;
  tasks_done: number;
  top3_total: number;
  top3_done: number;
  rest_total: number;
  rest_done: number;
  focus_seconds: number;
  pomodoros: number;
  overrides: number;
  trend: DayStat[];
  most_carried: { title: string; days: number } | null;
}

export interface ExportResult {
  paths: string[];
  dir: string;
}

export interface NotificationStatus {
  available: boolean;
  permission: string;
}

export interface AppInfo {
  version: string;
  data_dir: string;
  exports_dir: string;
  platform: string;
}
