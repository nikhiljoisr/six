import { api } from "./api";
import { useStore } from "../store";

// Keyboard shortcuts for the main window. Space toggles the active task between running
// and on a break (the app's one timer). Cmd+N opens the planner for the next unplanned
// day, since Six has no quick capture: the six are chosen deliberately. Cmd+, opens
// Settings. Cmd+W is the native Close Window, which hides to the menu bar.

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function installShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const store = useStore.getState();
    const snap = store.snapshot;
    if (!snap) return;
    const meta = e.metaKey && !e.ctrlKey && !e.altKey;

    if (meta && e.key.toLowerCase() === "n") {
      e.preventDefault();
      const date = snap.today_plan?.locked_at ? snap.tomorrow : snap.today;
      store.navigate({ name: "planner", date });
      return;
    }
    if (meta && e.key === ",") {
      e.preventDefault();
      store.navigate({ name: "settings" });
      return;
    }
    if (e.key === " " && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target) && store.view.name === "day") {
      const current = snap.today_plan?.tasks.find((t) => t.status === "active" || t.status === "paused");
      if (!current) return;
      e.preventDefault();
      if (current.status === "active") void store.dispatch(() => api.pause(current.id, "break"));
      else void store.dispatch(() => api.resume(current.id));
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
