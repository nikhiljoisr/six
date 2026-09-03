import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useStore } from "../store";

// The active card's clock. Nothing is counted here: once a second, while the window is
// focused and visible, Rust is asked for the task's focus time (derived from session
// timestamps) and the answer is displayed. Unfocused or hidden, nothing ticks.

export function useElapsed(taskId: string, initial: number, ticking: boolean): number {
  const [seconds, setSeconds] = useState(initial);
  const mismatched = useRef(false);

  useEffect(() => {
    setSeconds(initial);
    mismatched.current = false;
  }, [initial, taskId]);

  useEffect(() => {
    if (!ticking) return;
    let stopped = false;
    const tick = async () => {
      if (stopped || mismatched.current || document.hidden || !document.hasFocus()) return;
      try {
        const e = await api.getElapsed();
        if (stopped) return;
        if (e && e.task_id === taskId) {
          setSeconds(e.focus_seconds);
        } else {
          // The day moved on without us (rollover, or a change from the menu bar).
          mismatched.current = true;
          void useStore.getState().refresh();
        }
      } catch {
        // Transient; try again next second.
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [taskId, ticking]);

  return seconds;
}
