import { api } from "../lib/api";
import { countdown } from "../lib/format";
import type { BreakView, PomodoroView, TaskView } from "../lib/types";
import type { Live } from "../lib/useElapsed";
import { useStore } from "../store";
import { Button } from "./ui";

// The second clock. Task time is recorded from timestamps whenever the task is active;
// the pomodoro is an optional countdown laid over it. Every state says, in words, which
// clock is doing what, and every button says what it will do. Facts, no fanfare.

/** The break a "Take …" button would start now: the long one once a set is complete. */
export function breakMinutes(p: PomodoroView): number {
  return p.long_break_next ? p.long_break_minutes : p.break_minutes;
}

export function breakLabel(p: PomodoroView): string {
  return `Take ${breakMinutes(p)}`;
}

export function Dots({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-2 inline-flex items-center gap-1 align-middle" aria-label={`${count} pomodoros done on this task`}>
      {Array.from({ length: Math.min(count, 12) }).map((_, i) => (
        <span key={i} className="h-1.5 w-1.5 rounded-full bg-stone-900" />
      ))}
    </span>
  );
}

/** Spoken on a change of state only; the ticking numbers stay out of it. */
function Spoken({ children }: { children: string }) {
  return (
    <span className="sr-only" aria-live="polite">
      {children}
    </span>
  );
}

/**
 * The timer/break line under the recorded time. `line` draws the optional thin line
 * showing what remains of a running pomodoro (a prototype, off unless switched on).
 */
export function TimerLine({
  task,
  pomodoro,
  brk,
  live,
  paused,
  compact = false,
  line = false,
}: {
  task: TaskView;
  pomodoro: PomodoroView;
  brk: BreakView | null;
  live: Live;
  paused: boolean;
  compact?: boolean;
  line?: boolean;
}) {
  const dispatch = useStore((s) => s.dispatch);
  const done = task.pomodoros_completed;
  const cls = compact ? "mt-1 text-sm" : "mt-1.5 text-sm";

  if (paused) {
    const over = !!brk && live.breakRemaining <= 0;
    const spoken = !brk
      ? "Paused. Task time paused."
      : over
        ? "Break over. Task time is paused until you resume."
        : "On a break. Task time paused.";
    const shown = !brk ? spoken : over ? spoken : `On a break · ${countdown(live.breakRemaining)} left. Task time paused.`;
    return (
      <div className={`${cls} tabular-nums text-stone-900`}>
        <Spoken>{spoken}</Spoken>
        <span aria-hidden>{shown}</span>
        <Dots count={done} />
      </div>
    );
  }

  if (!pomodoro.enabled) return null;

  if (live.pomodoro === "running") {
    const planned =
      pomodoro.started_at && pomodoro.ends_at ? (Date.parse(pomodoro.ends_at) - Date.parse(pomodoro.started_at)) / 1000 : 0;
    const fraction = planned > 0 ? Math.max(0, Math.min(1, live.remaining / planned)) : 0;
    return (
      <div className={`${cls} tabular-nums text-stone-900`}>
        <Spoken>Pomodoro running.</Spoken>
        <span aria-hidden>Pomodoro · {countdown(live.remaining)} left</span>
        <Dots count={done} />
        {line && (
          <div className="mt-1.5 h-0.5 w-full bg-stone-200" aria-hidden>
            <div className="h-full bg-stone-900" style={{ width: `${fraction * 100}%`, transition: "width 200ms linear" }} />
          </div>
        )}
      </div>
    );
  }

  if (live.pomodoro === "done") {
    const bm = breakMinutes(pomodoro);
    const actions = (
      <div className={`mt-1 flex flex-wrap ${compact ? "gap-x-3" : "gap-x-4"}`}>
        <Button variant="link" className={compact ? "px-0" : ""} aria-label={`Take a ${bm}-minute break; task time pauses`} onClick={() => void dispatch(() => api.pause(task.id, "break"))}>
          Take {bm}
        </Button>
        <Button variant="link" className={compact ? "px-0" : ""} aria-label={`Start another ${pomodoro.minutes}-minute pomodoro`} onClick={() => void dispatch(() => api.startPomodoro(task.id))}>
          Another {pomodoro.minutes} min
        </Button>
        <Button variant="link" className={compact ? "px-0" : ""} aria-label="Continue without a timer; task time keeps recording" onClick={() => void dispatch(() => api.acknowledgePomodoro(task.id))}>
          Continue without timer
        </Button>
      </div>
    );
    if (compact) {
      return (
        <div className="mt-1 text-sm">
          <span aria-live="polite" className="font-medium text-stone-900">
            Pomodoro finished.
            <Dots count={done} />
          </span>
          {actions}
        </div>
      );
    }
    return (
      <div className="mt-3 rounded-control border border-stone-200 bg-stone-50 px-3 py-2.5">
        <div aria-live="polite" className="text-sm font-medium text-stone-900">
          Pomodoro finished. Task time is still recording.
          <Dots count={done} />
        </div>
        {actions}
      </div>
    );
  }

  return (
    <div className={`${cls} flex flex-wrap items-center gap-x-2 text-stone-500`}>
      <Spoken>No timer running.</Spoken>
      <span aria-hidden>No timer running.</span>
      <button
        type="button"
        className="underline decoration-stone-300 underline-offset-4 hover:text-stone-900"
        aria-label={`Start a ${pomodoro.minutes}-minute pomodoro`}
        onClick={() => void dispatch(() => api.startPomodoro(task.id))}
      >
        Start a {pomodoro.minutes}-minute pomodoro
      </button>
      <Dots count={done} />
    </div>
  );
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
