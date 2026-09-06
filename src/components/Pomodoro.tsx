import type { ReactNode } from "react";
import { api } from "../lib/api";
import { countdown, duration } from "../lib/format";
import type { BreakView, PomodoroView, TaskView } from "../lib/types";
import type { Live } from "../lib/useElapsed";
import { useStore } from "../store";
import { Button } from "./ui";

// The second clock. Task time is recorded from timestamps whenever the task is active;
// the pomodoro is an optional countdown laid over it. The running countdown is the one
// live number on the screen, so it is set large; everything else about the clocks is
// one small line of facts. Every button says what it will do.

/** The break a "Break …" button would start now: the long one once a set is complete. */
export function breakMinutes(p: PomodoroView): number {
  return p.long_break_next ? p.long_break_minutes : p.break_minutes;
}

export function breakLabel(p: PomodoroView): string {
  return `Take a ${breakMinutes(p)}-min break`;
}

export function Dots({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-2 inline-flex items-center gap-1 align-middle" aria-label={`${count} pomodoros done on this task`}>
      {Array.from({ length: Math.min(count, 12) }).map((_, i) => (
        <span key={i} className="h-1.5 w-1.5 rounded-full bg-stone-400" />
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
 * The current task's clocks, in the main window: the note on its own 12pt line (or today's
 * recorded time, when the task has no note); then, set apart below it, one utility line
 * with the clock at the text edge in tabular figures ("12:07 left") and the verbs at the
 * margin, and, while a countdown runs, a full-measure hairline tight above that line,
 * elapsed in a darker grey.
 */
export function Clocks({
  task,
  pomodoro,
  brk,
  live,
  paused,
  note,
  children,
}: {
  task: TaskView;
  pomodoro: PomodoroView;
  brk: BreakView | null;
  live: Live;
  paused: boolean;
  note: string;
  children?: ReactNode;
}) {
  const done = task.pomodoros_completed;
  let spoken: string;
  let label: string;
  let lead = "";
  let fraction: number | null = null;
  if (paused) {
    if (brk && live.breakRemaining > 0) {
      spoken = "On a break. Task time paused.";
      lead = countdown(live.breakRemaining);
      label = " left · break";
      fraction = brk.minutes > 0 ? live.breakRemaining / (brk.minutes * 60) : null;
    } else if (brk) {
      spoken = "Break over. Task time is paused until you resume.";
      label = `Break over · paused at ${duration(live.seconds)}`;
    } else {
      spoken = "Paused. Task time paused.";
      label = `Paused at ${duration(live.seconds)}`;
    }
  } else if (!pomodoro.enabled) {
    spoken = "Recording.";
    label = recordedClause(live);
  } else if (live.pomodoro === "running") {
    const planned =
      pomodoro.started_at && pomodoro.ends_at ? (Date.parse(pomodoro.ends_at) - Date.parse(pomodoro.started_at)) / 1000 : 0;
    spoken = "Pomodoro running.";
    lead = countdown(live.remaining);
    label = " left";
    fraction = planned > 0 ? Math.max(0, Math.min(1, live.remaining / planned)) : null;
  } else if (live.pomodoro === "done") {
    spoken = "Pomodoro finished. Task time is still recording.";
    label = `Finished · ${recordedClause(live)}`;
  } else {
    spoken = "No timer running.";
    label = recordedClause(live);
  }
  return (
    <div className="text-[12px] leading-5">
      <Spoken>{spoken}</Spoken>
      <div className="truncate text-stone-500" aria-hidden>
        {note || recordedClause(live)}
      </div>
      {fraction !== null && (
        <div className="mt-4 h-px w-full bg-stone-200" aria-hidden>
          <div className="h-full bg-stone-400" style={{ width: `${(1 - fraction) * 100}%`, transition: "width 200ms linear" }} />
        </div>
      )}
      <div className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 ${fraction !== null ? "mt-1.5" : "mt-4"}`}>
        <span className="whitespace-nowrap tabular-nums text-stone-400" title={recordedClause(live)} aria-hidden>
          {lead && <span className="text-stone-900">{lead}</span>}
          {label}
          <Dots count={done} />
        </span>
        <div className="ml-auto flex flex-wrap items-baseline justify-end gap-x-6 gap-y-1">{children}</div>
      </div>
    </div>
  );
}

/** Today's recorded time, as a clause for the note line. */
export function recordedClause(live: Live): string {
  return `${duration(live.seconds)} today`;
}

/** The state's secondary actions, as quiet text buttons. The card places them. */
export function SecondaryActions({
  task,
  pomodoro,
  live,
  paused,
  onTakeFive,
  onDefer,
}: {
  task: TaskView;
  pomodoro: PomodoroView;
  live: Live;
  paused: boolean;
  onTakeFive: () => void;
  onDefer: () => void;
}) {
  const dispatch = useStore((s) => s.dispatch);
  const bm = breakMinutes(pomodoro);
  const ringing = !paused && live.pomodoro === "done";
  return (
    <div className="contents">
      {!paused && pomodoro.enabled && live.pomodoro === "idle" && (
        <Button variant="link" title={`${pomodoro.minutes} minutes`} aria-label={`Start a ${pomodoro.minutes}-minute pomodoro`} onClick={() => void dispatch(() => api.startPomodoro(task.id))}>
          Start a pomodoro
        </Button>
      )}
      {ringing && (
        <>
          <Button variant="link" aria-label={`Start another ${pomodoro.minutes}-minute pomodoro`} onClick={() => void dispatch(() => api.startPomodoro(task.id))}>
            Another {pomodoro.minutes} min
          </Button>
          <Button variant="link" aria-label="Continue without a timer; task time keeps recording" onClick={() => void dispatch(() => api.acknowledgePomodoro(task.id))}>
            Continue without timer
          </Button>
        </>
      )}
      {!paused && (
        <Button variant="link" title={`${bm}-minute break; task time pauses`} aria-label={`Pause for a ${bm}-minute break; task time pauses`} onClick={onTakeFive}>
          Pause
        </Button>
      )}
      <Button variant="link" aria-label="Defer to tomorrow" onClick={onDefer}>
        Defer
      </Button>
    </div>
  );
}


/** The popover's compact form of the clocks: one line of facts, or the ring's sentence. */
export function TimerLine({
  task,
  pomodoro,
  brk,
  live,
  paused,
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
  if (paused) {
    const over = !!brk && live.breakRemaining <= 0;
    const spoken = !brk ? "Paused. Task time paused." : over ? "Break over. Task time is paused until you resume." : "On a break. Task time paused.";
    const shown = !brk || over ? spoken : `On a break · ${countdown(live.breakRemaining)} left. Task time paused.`;
    return (
      <div className="mt-1 text-sm tabular-nums text-stone-900">
        <Spoken>{spoken}</Spoken>
        <span aria-hidden>{shown}</span>
        <Dots count={done} />
      </div>
    );
  }
  if (!pomodoro.enabled) return null;
  if (live.pomodoro === "running") {
    return (
      <div className="mt-1 text-sm tabular-nums text-stone-900">
        <Spoken>Pomodoro running.</Spoken>
        <span aria-hidden>Pomodoro · {countdown(live.remaining)} left</span>
        <Dots count={done} />
      </div>
    );
  }
  if (live.pomodoro === "done") {
    const bm = breakMinutes(pomodoro);
    return (
      <div className="mt-1 text-sm">
        <span aria-live="polite" className="font-medium text-stone-900">
          Pomodoro finished.
          <Dots count={done} />
        </span>
        <div className="mt-1 flex flex-wrap gap-x-3">
          <Button variant="link" aria-label={`Take a ${bm}-minute break; task time pauses`} onClick={() => void dispatch(() => api.pause(task.id, "break"))}>
            Break · {bm} min
          </Button>
          <Button variant="link" aria-label={`Start another ${pomodoro.minutes}-minute pomodoro`} onClick={() => void dispatch(() => api.startPomodoro(task.id))}>
            Another {pomodoro.minutes} min
          </Button>
          <Button variant="link" aria-label="Continue without a timer; task time keeps recording" onClick={() => void dispatch(() => api.acknowledgePomodoro(task.id))}>
            Continue without timer
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-stone-500">
      <Spoken>No timer running.</Spoken>
      <span aria-hidden>No timer running.</span>
      <button type="button" className="hover:text-stone-900" aria-label={`Start a ${pomodoro.minutes}-minute pomodoro`} onClick={() => void dispatch(() => api.startPomodoro(task.id))}>
        Start {pomodoro.minutes}-min pomodoro
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
