import { api } from "../lib/api";
import { breakMinutes, clockFacts } from "../lib/clocks";
import type { BreakView, PomodoroView, TaskView } from "../lib/types";
import type { Live } from "../lib/useElapsed";
import { useStore } from "../store";
import { Button } from "./ui";

// The second clock. Task time is recorded from timestamps whenever the task is active;
// the pomodoro is an optional countdown laid over it. The running countdown is the one
// live number on the screen, so it is set large; everything else about the clocks is
// one small line of facts. Every button says what it will do.

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
 * The current task's clocks, in the main window. Two labelled facts on one line ("Task
 * time 45 min" at the text edge, "Pomodoro 12:07 left" at the margin) and, while a
 * countdown runs, a full-measure hairline under them whose dark part, anchored under the
 * clock it measures, is what remains; a timer that has ended leaves the empty track. A
 * screen reader hears the state sentence on a change and never the ticking numbers.
 */
export function Clocks({
  task,
  pomodoro,
  brk,
  live,
  paused,
  line = true,
}: {
  task: TaskView;
  pomodoro: PomodoroView;
  brk: BreakView | null;
  live: Live;
  paused: boolean;
  /** Settings → "Line under the countdown": the track under the clocks, on by default. */
  line?: boolean;
}) {
  const f = clockFacts(task, pomodoro, brk, live, paused);
  if (!line) f.fraction = null;
  return (
    <div className="mt-2 text-[13px] leading-5">
      <Spoken>{f.spoken}</Spoken>
      <div className="grid grid-cols-2 gap-x-4" aria-hidden>
        <span className="whitespace-nowrap">
          <span className="text-stone-500">Task time </span>
          <span className="tabular-nums text-stone-900">{f.taskFact}</span>
        </span>
        <span className="whitespace-nowrap text-right">
          {f.label && (
            <>
              <span className="text-stone-500">{f.label} </span>
              <span className={`tabular-nums ${f.quiet ? "text-stone-500" : "font-medium text-stone-900"}`}>{f.fact}</span>
            </>
          )}
          <Dots count={f.dots} />
        </span>
      </div>
      {f.fraction !== null && (
        <div className="mt-1.5 h-px w-full bg-stone-300" aria-hidden>
          <div className="ml-auto h-full bg-stone-900" style={{ width: `${f.fraction * 100}%`, transition: "width 200ms linear" }} />
        </div>
      )}
    </div>
  );
}

/** A rung pomodoro's two answers: the next one, or none. */
export function RingAnswers({ task, pomodoro }: { task: TaskView; pomodoro: PomodoroView }) {
  const dispatch = useStore((s) => s.dispatch);
  return (
    <>
      <Button variant="link" aria-label={`Start another ${pomodoro.minutes}-minute pomodoro`} onClick={() => void dispatch(() => api.startPomodoro(task.id))}>
        Another {pomodoro.minutes} min
      </Button>
      <Button variant="link" aria-label="Continue without a timer; task time keeps recording" onClick={() => void dispatch(() => api.acknowledgePomodoro(task.id))}>
        Continue without timer
      </Button>
    </>
  );
}

/** The state's secondary actions, as quiet text buttons. The card places them. */
export function SecondaryActions({
  task,
  pomodoro,
  live,
  paused,
  onTakeFive,
  onDefer,
  withRing = true,
}: {
  task: TaskView;
  pomodoro: PomodoroView;
  live: Live;
  paused: boolean;
  onTakeFive: () => void;
  onDefer: () => void;
  /** Include the ring's two answers here; false when the surface sets them on their own line. */
  withRing?: boolean;
}) {
  const dispatch = useStore((s) => s.dispatch);
  const bm = breakMinutes(pomodoro);
  const ringing = !paused && live.pomodoro === "done";
  return (
    <div className="contents">
      {ringing && withRing && <RingAnswers task={task} pomodoro={pomodoro} />}
      {!paused && pomodoro.enabled && live.pomodoro === "idle" && (
        <Button variant="link" title={`${pomodoro.minutes} minutes`} aria-label={`Start a ${pomodoro.minutes}-minute pomodoro`} onClick={() => void dispatch(() => api.startPomodoro(task.id))}>
          Start a pomodoro
        </Button>
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
