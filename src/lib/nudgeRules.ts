// When a queued nudge still means what it says, and which nudge an OS notification was.
// Pure: the store and the notification listener call these; the tests exercise them.

import type { DaySnapshot, Nudge, NudgeKind } from "./types.ts";

export function sameInstant(a: string | null, b: string): boolean {
  return a !== null && Date.parse(a) === Date.parse(b);
}

/** A queued nudge is kept only while what it says is still true. */
export function stillApplies(n: Nudge, snap: DaySnapshot): boolean {
  const plan = snap.today_plan?.locked_at ? snap.today_plan : null;
  if (n.task_id) {
    const task = plan?.tasks.find((t) => t.id === n.task_id);
    if (!task) return false;
    switch (n.kind) {
      case "break_over":
        return task.status === "paused";
      case "pomodoro_done": {
        if (task.status !== "active" || snap.pomodoro.task_id !== task.id) return false;
        if (snap.pomodoro.phase === "done") return true;
        // A ring is delivered just before it is settled, so the snapshot in hand may still
        // show that same pomodoro counting down. A different pomodoro counting down means
        // the ring was answered with "one more"; "idle" means "keep going" or a break.
        return snap.pomodoro.phase === "running" && sameInstant(snap.pomodoro.ends_at, n.due);
      }
      case "check_in":
        return task.status === "active" && snap.pomodoro.phase !== "running";
      default:
        return task.status === "active";
    }
  }
  switch (n.kind) {
    case "evening_ritual":
      return !snap.tomorrow_plan?.locked_at;
    case "end_of_day":
      return !!plan && !plan.reviewed_at;
    case "unplanned_morning":
      return !plan;
    default:
      return true;
  }
}

const KIND_BY_ID: Record<number, NudgeKind> = {
  601: "evening_ritual",
  602: "check_in",
  603: "break_over",
  604: "unplanned_morning",
  605: "end_of_day",
  606: "pomodoro_done",
};
const BY_TYPE: NudgeKind[] = ["evening_ritual", "check_in", "break_over", "unplanned_morning", "end_of_day"];

/** Which nudge an OS notification's action came from: by its id, else by its action type. */
export function kindOf(payload: Record<string, unknown>): NudgeKind | null {
  const notification = (payload.notification ?? {}) as Record<string, unknown>;
  const id = Number(notification.id ?? payload.id);
  if (KIND_BY_ID[id]) return KIND_BY_ID[id];
  const type = String(notification.actionTypeId ?? payload.actionTypeId ?? "");
  if (type.startsWith("pomodoro_done")) return "pomodoro_done";
  return BY_TYPE.find((k) => k === type) ?? null;
}
