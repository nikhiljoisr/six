import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import type { DaySnapshot } from "../lib/types";

// The store is a mirror of the Rust snapshot plus UI-only navigation state. Every
// mutation goes through `api`, and the Rust side answers with a fresh snapshot which
// replaces this one wholesale: no optimistic updates.

interface AppStore {
  snapshot: DaySnapshot | null;
  error: string | null;
  apply: (snapshot: DaySnapshot) => void;
  refresh: () => Promise<void>;
}

export const useStore = create<AppStore>((set) => ({
  snapshot: null,
  error: null,
  apply: (snapshot) => set({ snapshot, error: null }),
  refresh: async () => {
    try {
      set({ snapshot: await api.getSnapshot(), error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : JSON.stringify(e) });
    }
  },
}));

let started = false;

/** Load the first snapshot and subscribe to `state_changed`. Idempotent. */
export async function bootstrap(): Promise<void> {
  if (started) return;
  started = true;
  await listen<DaySnapshot>("state_changed", (event) => useStore.getState().apply(event.payload));
  await useStore.getState().refresh();
  window.addEventListener("focus", () => void useStore.getState().refresh());
}
