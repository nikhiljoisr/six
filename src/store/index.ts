import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { api } from "../lib/api";
import { applyAppearance } from "../lib/appearance";
import { stillApplies } from "../lib/nudgeRules";
import { chime } from "../lib/sound";
import { isAppError, type AppError, type DaySnapshot, type Nudge } from "../lib/types";

// The store mirrors the Rust snapshot and holds UI-only navigation state. Every
// mutation goes through `dispatch`, and the Rust side answers with a fresh snapshot
// that replaces the old one wholesale: no optimistic updates. Snapshots carry a
// revision, so an answer that arrives after a newer broadcast is ignored.

export type View =
  | { name: "day" }
  | { name: "planner"; date: string }
  | { name: "history" }
  | { name: "review"; planId: string }
  | { name: "stats" }
  | { name: "settings" };

interface AppStore {
  snapshot: DaySnapshot | null;
  view: View;
  /** Where the current view was opened from, for screens with a "Back". */
  previous: View | null;
  error: string | null;
  /** A quiet confirmation after Rust reported a save; clears itself. */
  notice: string | null;
  notify: (text: string) => void;
  /** The day view's one-line field for parking a thought is open (the J key, or its link). */
  jotting: boolean;
  setJotting: (open: boolean) => void;
  /** In-app banners waiting to be answered, oldest first. */
  nudges: Nudge[];
  pushNudge: (n: Nudge) => void;
  dismissNudge: (kind: Nudge["kind"]) => void;
  apply: (snapshot: DaySnapshot) => void;
  refresh: () => Promise<void>;
  navigate: (view: View) => void;
  clearError: () => void;
  /**
   * Run a command that returns a snapshot. Returns the error (if any) so the caller can
   * react to control-flow codes such as `needs_override`; other errors are also shown.
   */
  dispatch: (run: () => Promise<DaySnapshot>) => Promise<AppError | null>;
}

const SILENT_CODES = new Set(["needs_override", "stale_nudge"]);

function describe(e: unknown): AppError {
  if (isAppError(e)) return e;
  if (e instanceof Error) return { code: "unknown", message: e.message };
  return { code: "unknown", message: typeof e === "string" ? e : JSON.stringify(e) };
}

let noticeTimer: number | null = null;

export const useStore = create<AppStore>((set, get) => ({
  snapshot: null,
  view: { name: "day" },
  previous: null,
  error: null,
  notice: null,
  notify: (text) => {
    set({ notice: text });
    if (noticeTimer !== null) window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => set({ notice: null }), 2500);
  },
  jotting: false,
  setJotting: (open) => set({ jotting: open }),
  nudges: [],
  pushNudge: (n) =>
    set((s) => {
      // A nudge that no longer applies (the task moved on between planning and delivery)
      // never shows, not even for a moment.
      if (s.snapshot && !stillApplies(n, s.snapshot)) return {};
      // On the day view the active card already holds the ring's three answers; a
      // banner would be the same group twice. The optional sound still plays.
      if (n.kind === "pomodoro_done" && s.view.name === "day") {
        if (s.snapshot?.settings.sound_enabled) chime(s.snapshot.settings.sound_style, s.snapshot.settings.sound_level);
        return {};
      }
      return { nudges: [...s.nudges.filter((x) => x.kind !== n.kind), n] };
    }),
  dismissNudge: (kind) => set((s) => ({ nudges: s.nudges.filter((x) => x.kind !== kind) })),
  apply: (snapshot) =>
    set((s) => {
      if (s.snapshot && snapshot.revision < s.snapshot.revision) return {};
      if (snapshot.settings.appearance !== s.snapshot?.settings.appearance) applyAppearance(snapshot.settings.appearance);
      return { snapshot, nudges: s.nudges.filter((n) => stillApplies(n, snapshot)) };
    }),
  refresh: async () => {
    try {
      get().apply(await api.getSnapshot());
    } catch (e) {
      set({ error: describe(e).message });
    }
  },
  navigate: (view) => {
    window.scrollTo(0, 0);
    set((s) => ({
      view,
      previous: s.view,
      error: null,
      jotting: false,
      // Back on the day view, the card takes over from a ring's banner.
      nudges: view.name === "day" ? s.nudges.filter((n) => n.kind !== "pomodoro_done") : s.nudges,
    }));
  },
  clearError: () => set({ error: null }),
  dispatch: async (run) => {
    try {
      const snapshot = await run();
      get().apply(snapshot);
      set({ error: null });
      return null;
    } catch (e) {
      const error = describe(e);
      if (!SILENT_CODES.has(error.code)) set({ error: error.message });
      return error;
    }
  },
}));

let started = false;

/** Load the first snapshot and subscribe to `state_changed`. Idempotent. */
export async function bootstrap(): Promise<void> {
  if (started) return;
  started = true;
  await listen<DaySnapshot>("state_changed", (event) => useStore.getState().apply(event.payload));
  // These two are addressed to one window. A plain listen() would hear the other
  // window's too: Tauri hands an addressed event to every listener that named no target.
  const here = getCurrentWebviewWindow();
  // The tray menu and popover ask the main window to open a view.
  await here.listen<View>("navigate", (event) => {
    const v = event.payload;
    if (v && typeof v === "object" && "name" in v) useStore.getState().navigate(v);
  });
  await here.listen<Nudge>("nudge", (event) => useStore.getState().pushNudge(event.payload));
  await useStore.getState().refresh();
  window.addEventListener("focus", () => void useStore.getState().refresh());
}
