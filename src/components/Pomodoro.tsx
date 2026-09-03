import { api } from "../lib/api";
import { countdown } from "../lib/format";
import type { PomodoroPhase, PomodoroView, TaskView } from "../lib/types";
import { useStore } from "../store";
import { Button } from "./ui";

// The pomodoro line on the active card and in the popover. Idle: a quiet offer to start.
// Running: the countdown. Done: the ring, answered by a tap — a break, one more, or keep
// going. Dots count the pomodoros this task has finished today. Facts, no fanfare.

export function breakLabel(p: PomodoroView): string {
  return p.long_break_next ? `Take ${p.long_break_minutes}` : "Take 5";
}

export function Dots({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-2 inline-flex items-center gap-1 align-middle" aria-label={`${count} pomodoros done`}>
      {Array.from({ length: Math.min(count, 12) }).map((_, i) => (
        <span key={i} className="h-1.5 w-1.5 rounded-full bg-stone-900" />
      ))}
    </span>
  );
}

export function PomodoroLine({
  task,
  pomodoro,
  phase,
  remaining,
  paused,
  compact = false,
}: {
  task: TaskView;
  pomodoro: PomodoroView;
  phase: PomodoroPhase;
  remaining: number;
  paused: boolean;
  compact?: boolean;
}) {
  const dispatch = useStore((s) => s.dispatch);
  if (!pomodoro.enabled) return null;
  const done = task.pomodoros_completed;

  if (paused) {
    return done > 0 ? (
      <div className="mt-1.5 text-xs text-stone-400">
        {done} {done === 1 ? "pomodoro" : "pomodoros"} done
        <Dots count={done} />
      </div>
    ) : null;
  }

  if (phase === "running") {
    return (
      <div className={`mt-1.5 tabular-nums text-stone-900 ${compact ? "text-sm" : "text-sm"}`}>
        {countdown(remaining)} <span className="text-stone-500">left in this pomodoro</span>
        <Dots count={done} />
      </div>
    );
  }

  if (phase === "done" && compact) {
    // The popover is 220 points tall and its button row already offers the break.
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-sm">
        <span className="font-medium text-stone-900">
          Pomodoro done.
          <Dots count={done} />
        </span>
        <Button variant="link" className="px-0" onClick={() => void dispatch(() => api.startPomodoro(task.id))}>
          One more
        </Button>
        <Button variant="link" className="px-0" onClick={() => void dispatch(() => api.acknowledgePomodoro(task.id))}>
          Keep going
        </Button>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="mt-3 rounded-control border border-stone-200 bg-stone-50 px-3 py-2.5">
        <div className="text-sm font-medium text-stone-900">
          Pomodoro done.
          <Dots count={done} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4">
          <Button variant="link" onClick={() => void dispatch(() => api.pause(task.id, "break"))}>
            {breakLabel(pomodoro)}
          </Button>
          <Button variant="link" onClick={() => void dispatch(() => api.startPomodoro(task.id))}>
            One more
          </Button>
          <Button variant="link" onClick={() => void dispatch(() => api.acknowledgePomodoro(task.id))}>
            Keep going
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex items-center text-xs text-stone-400">
      <button
        type="button"
        className="underline decoration-stone-300 underline-offset-4 hover:text-stone-600"
        onClick={() => void dispatch(() => api.startPomodoro(task.id))}
      >
        Start a {pomodoro.minutes}-minute pomodoro
      </button>
      <Dots count={done} />
    </div>
  );
}

/** The live values the clock hook starts from, taken from the snapshot. */
export function initialLive(task: TaskView, pomodoro: PomodoroView) {
  const mine = pomodoro.task_id === task.id;
  return {
    seconds: task.focus_seconds,
    pomodoro: mine ? pomodoro.phase : ("idle" as PomodoroPhase),
    remaining: mine ? pomodoro.remaining_seconds : 0,
  };
}
