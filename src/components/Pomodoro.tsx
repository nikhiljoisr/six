import { api } from "../lib/api";
import { breakMinutes, clockFacts } from "../lib/clocks";
import type { BreakView, PomodoroView, TaskView } from "../lib/types";
import type { Live } from "../lib/useElapsed";
import { useStore } from "../store";
import { Button } from "./ui";

// The second clock. Task time is recorded from timestamps whenever the task is active;
// the pomodoro is an optional countdown laid over it. The clocks are one small line of
// facts; the countdown itself is drawn by the rule above the current task (TimerRule),
// which shortens as the time runs. Every button says what it will do.

/** Spoken on a change of state only; the ticking numbers stay out of it. */
function Spoken({ children }: { children: string }) {
  return (
    <span className="sr-only" aria-live="polite">
      {children}
    </span>
  );
}

/**
 * The rule over the current task, which is also its countdown. With no countdown running
 * it is one ink line: "you are here". While a pomodoro or a break runs, the ink is what
 * remains, shortening from the right over a hairline track. When the timer ends the line is
 * whole again: the task is still here, waiting for an answer. `fraction` null means no
 * countdown to show.
 */
export function TimerRule({ fraction }: { fraction: number | null }) {
  if (fraction === null) return <div className="h-px w-full bg-rule" aria-hidden />;
  return (
    <div className="h-px w-full bg-stone-200" aria-hidden>
      <div className="h-full bg-rule" style={{ width: `${fraction * 100}%`, transition: "width 200ms linear" }} />
    </div>
  );
}

/**
 * The current task's clocks, in the main window: two labelled facts on one line ("Task
 * time 45 min" at the text edge, "Pomodoro 12:07 left" at the margin). A screen reader
 * hears the state sentence on a change and never the ticking numbers.
 */
export function Clocks({
  pomodoro,
  brk,
  live,
  paused,
}: {
  pomodoro: PomodoroView;
  brk: BreakView | null;
  live: Live;
  paused: boolean;
}) {
  const f = clockFacts(pomodoro, brk, live, paused);
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
        </span>
      </div>
    </div>
  );
}

/**
 * A rung pomodoro's answers, in the card's own action row, so nothing moves: a break (the
 * main answer, unless `quiet`, as in the nudge), another one, or carry on with no timer.
 * Done stays beside them as a quiet action.
 */
export function RingRow({
  task,
  pomodoro,
  quiet,
  onTakeFive,
  onDone,
}: {
  task: TaskView;
  pomodoro: PomodoroView;
  /** Another surface holds this screen's one filled button. */
  quiet: boolean;
  onTakeFive: () => void;
  onDone: () => void;
}) {
  const dispatch = useStore((s) => s.dispatch);
  const bm = breakMinutes(pomodoro);
  return (
    <>
      <Button
        variant={quiet ? "text" : "primary"}
        size="sm"
        className={quiet ? "" : "px-3"}
        aria-label={`Take a ${bm}-minute break; task time pauses`}
        onClick={onTakeFive}
      >
        Break {bm} min
      </Button>
      <Button
        variant="link"
        aria-label={`Start another ${pomodoro.minutes}-minute pomodoro`}
        onClick={() => void dispatch(() => api.startPomodoro(task.id))}
      >
        Another {pomodoro.minutes} min
      </Button>
      <Button variant="link" aria-label="Carry on with no timer; task time keeps recording" onClick={() => void dispatch(() => api.acknowledgePomodoro(task.id))}>
        No timer
      </Button>
      <Button variant="link" title="⌘↩" aria-label="Done (⌘↩)" onClick={onDone}>
        Done
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
  return (
    <div className="contents">
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
