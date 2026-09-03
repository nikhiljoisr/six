import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { PomodoroPhase } from "./types";
import { useStore } from "../store";

// The active card's clock. Nothing is counted here: once a second, while the window is
// focused and visible, Rust is asked for the task's focus time and pomodoro state
// (derived from timestamps) and the answer is displayed. Unfocused or hidden, nothing
// ticks. A ring is Rust's to notice; it broadcasts a new snapshot when one happens.

export interface Live {
  seconds: number;
  pomodoro: PomodoroPhase;
  remaining: number;
}

export function useElapsed(taskId: string, initial: Live, ticking: boolean): Live {
  const [live, setLive] = useState<Live>(initial);
  const mismatched = useRef(false);

  useEffect(() => {
    setLive(initial);
    mismatched.current = false;
  }, [initial.seconds, initial.pomodoro, initial.remaining, taskId]);

  useEffect(() => {
    if (!ticking) return;
    let stopped = false;
    const tick = async () => {
      if (stopped || mismatched.current || document.hidden || !document.hasFocus()) return;
      try {
        const e = await api.getElapsed();
        if (stopped) return;
        if (e && e.task_id === taskId) {
          setLive({ seconds: e.focus_seconds, pomodoro: e.pomodoro, remaining: e.pomodoro_remaining });
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

  return live;
}
