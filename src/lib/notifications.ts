import { onAction } from "@choochmeque/tauri-plugin-notifications-api";
import { api } from "./api";
import { kindOf } from "./nudgeRules";
import { useStore } from "../store";

// OS notification buttons come back through the plugin's listener; the main window
// forwards them to the same Rust command the in-app banner uses. In dev builds the
// plugin is not registered and this quietly does nothing.

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
