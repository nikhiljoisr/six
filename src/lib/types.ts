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
  /** Thoughts parked during the day, oldest first. */
  jots: JotView[];
}

/** One line parked mid-task for the evening review. Never a task. */
export interface JotView {
  id: string;
  text: string;
  created_at: string;
  /** Position of the task in hand when it was written, if that task is still on the list. */
  position: number | null;
}

/** The last locked day, when it ended without a review and is no more than a week old. */
export interface UnreviewedDay {
  plan_id: string;
  date: string;
}

export type PomodoroPhase = "idle" | "running" | "done";

/** The pomodoro layer for today's active task, as Rust reports it. */
export interface PomodoroView {
  enabled: boolean;
  minutes: number;
  break_minutes: number;
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
  sound_enabled: boolean;
  onboarded: boolean;
  nudge_style: "banner" | "system";
  /** A thin line under a running countdown. */
  countdown_line: boolean;
  /** The system-wide shortcut that shows or hides Six, or "off". */
  global_shortcut: GlobalShortcut;
  /** The minutes left of a pomodoro or a break, in the menu bar. Off by default. */
  tray_minutes: boolean;
  sound_style: "two_note" | "bell" | "knock";
  sound_level: "soft" | "normal" | "loud";
  /** Light unless chosen otherwise; "auto" follows macOS. */
  appearance: "light" | "dark" | "auto";
}

export type GlobalShortcut = "off" | "alt+cmd+6" | "ctrl+alt+6" | "ctrl+cmd+6";

/** The break the paused task is on. */
export interface BreakView {
  started_at: string;
  ends_at: string;
  minutes: number;
  long: boolean;
}

export type Phase = "before_evening" | "after_evening";

export interface DaySnapshot {
  /** Counts up with every snapshot Rust builds; an older one arriving late is ignored. */
  revision: number;
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
  break: BreakView | null;
  unreviewed: UnreviewedDay | null;
  /** A silence on the running session that has not been answered: take it out, or keep it. */
  return_gap: IdleFlag | null;
}

export interface IdleFlag {
  session_id: string;
  task_id: string;
  started_at: string;
  ended_at: string;
  seconds: number;
  /** The silence: nothing touched between these two instants. */
  gap_start: string;
  gap_end: string;
  gap_seconds: number;
  /** What the session would measure with the silence taken out. */
  suggested_seconds: number;
}

export interface ReviewView {
  plan: PlanView;
  top_three_done: boolean;
  overrides: number;
  idle_flags: IdleFlag[];
  unfinished: string[];
  /** What carries from this day still reaches a planner that is not locked yet. */
  still_carries: boolean;
  jots: JotView[];
}

/** Focus time of today's current task, from Rust, for the ticking display. */
export interface Elapsed {
  task_id: string;
  status: TaskStatus;
  focus_seconds: number;
  pomodoro: PomodoroPhase;
  pomodoro_remaining: number;
  on_break: boolean;
  break_remaining: number;
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
  /** Pomodoros the task left before their end. */
  pomodoros_interrupted: number;
  overrides: number;
  /** Planned days in range that ended with a review. */
  days_reviewed: number;
  /** Positions 1 to 6, always all six. */
  by_position: { position: number; total: number; done: number }[];
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
  backups_dir: string;
  platform: string;
}
