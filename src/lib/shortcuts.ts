import { api } from "./api";
import { backFrom } from "./nav";
import { useStore } from "../store";

// Keyboard shortcuts for the main window. Space toggles the active task between running
// and on a break (the app's one timer); P starts a pomodoro on it; Cmd+Return completes
// it. Cmd+N opens the planner for the next unplanned day, since Six has no quick capture:
// the six are chosen deliberately. Cmd+E edits today's list. Cmd+, opens Settings. Esc
// goes back from History, Stats and Settings. Cmd+W is the native Close Window, which
// hides to the menu bar.

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Space belongs to a focused control (it activates it) and to an open dialog. */
function spaceTakenBy(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return typing(el) || !!el.closest("button, a, [role='dialog']");
}

export function installShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    // A key the screen in front has already handled (the planner's Cmd+Return saves the
    // list) is not also a global shortcut.
    if (e.defaultPrevented) return;
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
    if (meta && e.key.toLowerCase() === "e" && store.view.name === "day" && snap.today_plan?.locked_at) {
      e.preventDefault();
      store.navigate({ name: "planner", date: snap.today });
      return;
    }
    const dialogOpen = !!document.querySelector("[role='dialog']");
    // Not on a repeat (a held Cmd+Return that saved the planner must not go on to
    // complete a task on the day view it returns to), and never behind an open dialog.
    if (meta && e.key === "Enter" && !e.repeat && !dialogOpen && store.view.name === "day") {
      const active = snap.today_plan?.tasks.find((t) => t.status === "active");
      if (!active) return;
      e.preventDefault();
      void store.dispatch(() => api.complete(active.id));
      return;
    }
    const bare = !e.metaKey && !e.ctrlKey && !e.altKey;
    if (e.key === "Escape" && bare && !e.repeat && !dialogOpen && !typing(e.target)) {
      const back = backFrom(store.view, store.previous);
      if (!back) return;
      e.preventDefault();
      store.navigate(back);
      return;
    }
    if (bare && !e.shiftKey && !e.repeat && !dialogOpen && !typing(e.target) && store.view.name === "day" && e.key.toLowerCase() === "p") {
      const active = snap.today_plan?.tasks.find((t) => t.status === "active");
      if (!active || !snap.pomodoro.enabled || snap.pomodoro.phase === "running") return;
      e.preventDefault();
      void store.dispatch(() => api.startPomodoro(active.id));
      return;
    }
    if (e.key === " " && bare && !e.repeat && !dialogOpen && !spaceTakenBy(e.target) && store.view.name === "day") {
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
