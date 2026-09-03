import { onAction } from "@choochmeque/tauri-plugin-notifications-api";
import { api } from "./api";
import type { NudgeKind } from "./types";
import { useStore } from "../store";

// OS notification buttons come back through the plugin's listener; the main window
// forwards them to the same Rust command the in-app banner uses. In dev builds the
// plugin is not registered and this quietly does nothing.

const KIND_BY_ID: Record<number, NudgeKind> = {
  601: "evening_ritual",
  602: "check_in",
  603: "break_over",
  604: "unplanned_morning",
  605: "end_of_day",
  606: "pomodoro_done",
};

function kindOf(payload: Record<string, unknown>): NudgeKind | null {
  const notification = (payload.notification ?? {}) as Record<string, unknown>;
  const id = Number(notification.id ?? payload.id);
  if (KIND_BY_ID[id]) return KIND_BY_ID[id];
  const type = String(notification.actionTypeId ?? payload.actionTypeId ?? "");
  if (type.startsWith("pomodoro_done")) return "pomodoro_done";
  return (["evening_ritual", "check_in", "break_over", "unplanned_morning", "end_of_day"] as NudgeKind[]).find((k) => k === type) ?? null;
}

export async function installNotificationActions(): Promise<void> {
  try {
    await onAction((event: unknown) => {
      const payload = (event ?? {}) as Record<string, unknown>;
      const kind = kindOf(payload);
      const action = String(payload.actionId ?? payload.action_id ?? "");
      if (!kind || !action) return;
      void useStore.getState().dispatch(() => api.nudgeAction(kind, action));
    });
  } catch {
    // No notification plugin in this build (unbundled dev run): banners only.
  }
}
