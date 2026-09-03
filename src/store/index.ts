import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import { isAppError, type AppError, type DaySnapshot } from "../lib/types";

// The store mirrors the Rust snapshot and holds UI-only navigation state. Every
// mutation goes through `dispatch`, and the Rust side answers with a fresh snapshot
// that replaces the old one wholesale: no optimistic updates.

export type View =
  | { name: "day" }
  | { name: "planner"; date: string }
  | { name: "history" }
  | { name: "review"; planId: string };

interface AppStore {
  snapshot: DaySnapshot | null;
  view: View;
  error: string | null;
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

const SILENT_CODES = new Set(["needs_override"]);

function describe(e: unknown): AppError {
  if (isAppError(e)) return e;
  if (e instanceof Error) return { code: "unknown", message: e.message };
  return { code: "unknown", message: typeof e === "string" ? e : JSON.stringify(e) };
}

export const useStore = create<AppStore>((set) => ({
  snapshot: null,
  view: { name: "day" },
  error: null,
  apply: (snapshot) => set({ snapshot }),
  refresh: async () => {
    try {
      set({ snapshot: await api.getSnapshot() });
    } catch (e) {
      set({ error: describe(e).message });
    }
  },
  navigate: (view) => {
    window.scrollTo(0, 0);
    set({ view, error: null });
  },
  clearError: () => set({ error: null }),
  dispatch: async (run) => {
    try {
      set({ snapshot: await run(), error: null });
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
  // The tray menu and popover ask the main window to open a view.
  await listen<View>("navigate", (event) => {
    const v = event.payload;
    if (v && typeof v === "object" && "name" in v) useStore.getState().navigate(v);
  });
  await useStore.getState().refresh();
  window.addEventListener("focus", () => void useStore.getState().refresh());
}
