// Typed wrappers around the Rust commands. The frontend dispatches intents; it never
// computes durations, transitions or streaks.

import { invoke } from "@tauri-apps/api/core";
import type {
  CarryoverPreview,
  AppInfo,
  DaySnapshot,
  Elapsed,
  ExportResult,
  NotificationStatus,
  Stats,
  PauseReason,
  PlanView,
  ReviewDecision,
  ReviewView,
  Settings,
  TaskInput,
} from "./types";

export const api = {
  getSnapshot: () => invoke<DaySnapshot>("get_snapshot"),
  getDay: (date: string) => invoke<PlanView | null>("get_day", { date }),
  getRange: (from: string, to: string) => invoke<PlanView[]>("get_range", { from, to }),
  getCarryover: (date: string) => invoke<CarryoverPreview | null>("get_carryover", { date }),
  draftPlan: (date: string, tasks: TaskInput[]) => invoke<DaySnapshot>("draft_plan", { date, tasks }),
  lockPlan: (plan_id: string) => invoke<DaySnapshot>("lock_plan", { plan_id }),
  editPlan: (plan_id: string, tasks: TaskInput[]) => invoke<DaySnapshot>("edit_plan", { plan_id, tasks }),

  activate: (task_id: string, override_order = false) =>
    invoke<DaySnapshot>("activate", { task_id, override_order }),
  complete: (task_id: string) => invoke<DaySnapshot>("complete", { task_id }),
  pause: (task_id: string, reason: PauseReason = "paused") => invoke<DaySnapshot>("pause", { task_id, reason }),
  resume: (task_id: string) => invoke<DaySnapshot>("resume", { task_id }),
  defer: (task_id: string) => invoke<DaySnapshot>("defer", { task_id }),
  skip: (task_id: string) => invoke<DaySnapshot>("skip", { task_id }),
  reopen: (task_id: string) => invoke<DaySnapshot>("reopen", { task_id }),
  setNote: (task_id: string, note: string | null) => invoke<DaySnapshot>("set_note", { task_id, note }),
  touch: () => invoke<boolean>("touch"),
  getElapsed: () => invoke<Elapsed | null>("get_elapsed"),
  startPomodoro: (taskId: string) => invoke<DaySnapshot>("start_pomodoro", { task_id: taskId }),
  acknowledgePomodoro: (taskId: string) => invoke<DaySnapshot>("acknowledge_pomodoro", { task_id: taskId }),

  getReview: (plan_id: string) => invoke<ReviewView>("get_review", { plan_id }),
  trimSession: (session_id: string, gap_start: string, gap_end: string) =>
    invoke<DaySnapshot>("trim_session", { session_id, gap_start, gap_end }),
  completeReview: (plan_id: string, reflection: string | null, decisions: ReviewDecision[]) =>
    invoke<DaySnapshot>("complete_review", { plan_id, reflection, decisions }),

  getStreak: () => invoke<number>("get_streak"),
  /** Show the main window, optionally navigating it (used by the popover and tray menu). */
  showMain: (target?: unknown) => invoke<void>("show_main", { target: target ?? null }),
  hidePopover: () => invoke<void>("hide_popover"),
  /** Keep Six's banner under the menu bar on screen for the nudge now showing. */
  showBanner: () => invoke<void>("show_banner"),
  nudgeAction: (kind: string, action: string, task_id: string | null = null) =>
    invoke<DaySnapshot>("nudge_action", { kind, action, task_id }),
  snooze: (kind: string, minutes: number) => invoke<DaySnapshot>("snooze", { kind, minutes }),
  notificationStatus: () => invoke<NotificationStatus>("notification_status"),
  requestNotificationPermission: () => invoke<NotificationStatus>("request_notification_permission"),
  getAppInfo: () => invoke<AppInfo>("get_app_info"),
  getStats: (from: string, to: string) => invoke<Stats>("get_stats", { from, to }),
  exportRange: (from: string, to: string, format: "text" | "json" | "both") =>
    invoke<ExportResult>("export_range", { from, to, format }),
  exportAll: () => invoke<ExportResult>("export_all"),
  getSettings: () => invoke<Settings>("get_settings"),
  setSetting: (key: keyof Settings, value: string) => invoke<DaySnapshot>("set_setting", { key, value }),
};
