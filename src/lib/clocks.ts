// What the two clocks say, as plain values. Display only: every number here was computed
// in Rust and arrives in the snapshot or the elapsed poll. Pure, so it can be tested.

import { countdown, duration } from "./format.ts";
import type { BreakView, PomodoroView, TaskView } from "./types.ts";
import type { Live } from "./useElapsed.ts";

/** The break a "Pause" would start now: the long one once a set is complete. */
export function breakMinutes(p: PomodoroView): number {
  return p.long_break_next ? p.long_break_minutes : p.break_minutes;
}

export interface ClockFacts {
  /** One sentence for a screen reader, spoken on a change of state only. */
  spoken: string;
  /** "45 min", or "45 min · paused". */
  taskFact: string;
  /** "Pomodoro", "Break", or empty when there is no second clock to name. */
  label: string;
  /** "12:07 left", "finished", "not running", "over". */
  fact: string;
  /** The second clock is not doing anything; show it quietly. */
  quiet: boolean;
  /** What remains of the running countdown, 0 to 1; null when none is running, ended ones included. */
  fraction: number | null;
}

/** The two clocks as facts: what task time is doing, and what the pomodoro (or break) is doing. */
export function clockFacts(pomodoro: PomodoroView, brk: BreakView | null, live: Live, paused: boolean): ClockFacts {
  const recorded = duration(live.seconds);
  let spoken: string;
  let taskFact: string;
  let label = "";
  let fact = "";
  let quiet = false;
  let fraction: number | null = null;
  if (paused) {
    taskFact = `${recorded} · paused`;
    if (brk && live.breakRemaining > 0) {
      spoken = "On a break. Task time paused.";
      label = "Break";
      fact = `${countdown(live.breakRemaining)} left`;
      fraction = brk.minutes > 0 ? Math.max(0, Math.min(1, live.breakRemaining / (brk.minutes * 60))) : null;
    } else if (brk) {
      spoken = "Break over. Task time is paused until you resume.";
      label = "Break";
      fact = "over";
    } else {
      spoken = "Paused. Task time paused.";
    }
  } else {
    taskFact = recorded;
    if (!pomodoro.enabled) {
      spoken = "Recording.";
    } else if (live.pomodoro === "running") {
      const planned =
        pomodoro.started_at && pomodoro.ends_at ? (Date.parse(pomodoro.ends_at) - Date.parse(pomodoro.started_at)) / 1000 : 0;
      spoken = "Pomodoro running.";
      label = "Pomodoro";
      fact = `${countdown(live.remaining)} left`;
      fraction = planned > 0 ? Math.max(0, Math.min(1, live.remaining / planned)) : null;
    } else if (live.pomodoro === "done") {
      spoken = "Pomodoro finished. Task time is still recording.";
      label = "Pomodoro";
      fact = "finished";
    } else {
      spoken = "No timer running.";
      label = "Pomodoro";
      fact = "not running";
      quiet = true;
    }
  }
  return { spoken, taskFact, label, fact, quiet, fraction };
}

/** The live values the clock hook starts from, taken from the snapshot. */
export function initialLive(task: TaskView, pomodoro: PomodoroView, brk: BreakView | null, now: string): Live {
  const mine = pomodoro.task_id === task.id;
  const breakRemaining = brk ? Math.max(0, Math.round((Date.parse(brk.ends_at) - Date.parse(now)) / 1000)) : 0;
  return {
    seconds: task.focus_seconds,
    pomodoro: mine ? pomodoro.phase : "idle",
    remaining: mine ? pomodoro.remaining_seconds : 0,
    onBreak: !!brk,
    breakRemaining,
  };
}
