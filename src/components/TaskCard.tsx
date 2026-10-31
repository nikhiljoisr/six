import { useState } from "react";
import { clockTime } from "../lib/format";
import type { BreakView, PomodoroView, TaskView } from "../lib/types";
import { useElapsed } from "../lib/useElapsed";
import { clockFacts, initialLive } from "../lib/clocks";
import { Clocks, RingRow, SecondaryActions, TimerRule } from "./Pomodoro";
import { Button, Numeral } from "./ui";

// The list is a table of contents: one column of serif numerals, one column of titles,
// one right edge for the row's action. A title is never cut: a long one wraps, and its
// row grows (a one-line row is 32pt, as it always was). The three cells share a baseline;
// the right-hand cell's line is a little shorter than the row so that, sitting a pixel
// lower than the title as it does, it cannot make a one-line row taller. The page is the surface; state is carried by
// type. The current task is the one row that is set apart, by air and a pair of
// hairlines, with its clocks and its actions inside it.

interface Actions {
  onComplete?: (task: TaskView) => void;
  onUndo?: (task: TaskView) => void;
  onStart?: (task: TaskView) => void;
  onTakeFive?: (task: TaskView) => void;
  onResume?: (task: TaskView) => void;
  onDefer?: (task: TaskView) => void;
}

interface Props extends Actions {
  task: TaskView;
  pomodoro: PomodoroView;
  /** The break the current task is on, if it is on one. */
  brk: BreakView | null;
  /** The snapshot's clock, so the break countdown starts from Rust's reading. */
  now: string;
  /** Settings → "Line under the countdown". */
  countdownLine?: boolean;
  /** True while an earlier task is still unfinished, so starting this one breaks order. */
  isAhead: boolean;
  /** Undo and starting are only offered on today's list. */
  isToday: boolean;
  /** The screen's one filled button is elsewhere (the evening's "Review today"): the
   *  current task's main action is set as an ink text button instead. */
  quietPrimary?: boolean;
}

/**
 * The numeral hangs in the left margin, right-aligned, so every title, the masthead
 * and the footer share one text edge. Numeral column, title column, action column.
 */
const ROW = "-ml-10 grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-baseline";
const GUTTER = "pr-3 text-right";

/**
 * A row fades in when it is made: a task taking the current slot, or leaving it, is a new
 * row (SPEC §3). An undo that returns a row to the list keeps the row, and the keyboard
 * focus on it. The fade is chosen once, at that moment, and only while the page is on
 * screen: a hidden web view does not advance animations, and a row must never wait at
 * zero opacity.
 */
function useFadeIn(): string {
  const [fade] = useState(() => (typeof document !== "undefined" && !document.hidden ? "fade-in" : ""));
  return fade;
}

export function TaskCard({ task, pomodoro, brk, now, isAhead, isToday, countdownLine = true, quietPrimary = false, ...on }: Props) {
  switch (task.status) {
    case "active":
    case "paused":
      return <CurrentRow task={task} pomodoro={pomodoro} brk={brk} now={now} line={countdownLine} quiet={quietPrimary} {...on} />;
    case "done": {
      // A done row keeps its numeral and carries the time it was finished, in the serif's figures.
      const at = task.completed_at ? clockTime(task.completed_at) : undefined;
      return (
        <Row task={task} tone="done" struck>
          {isToday && on.onUndo ? (
            <RowAction tag={at} onClick={() => on.onUndo?.(task)}>
              undo
            </RowAction>
          ) : (
            at && <span className="clock text-[12px] text-stone-500">{at}</span>
          )}
        </Row>
      );
    }
    case "deferred":
      return (
        <Row task={task} tone="dim">
          {isToday && on.onUndo ? <RowAction tag="tomorrow" onClick={() => on.onUndo?.(task)}>undo</RowAction> : <span className="clock text-[12px] text-stone-500">tomorrow</span>}
        </Row>
      );
    case "skipped":
      return (
        <Row task={task} tone="done" struck>
          {isToday && on.onUndo ? <RowAction tag="dropped" onClick={() => on.onUndo?.(task)}>undo</RowAction> : <span className="clock text-[12px] text-stone-500">dropped</span>}
        </Row>
      );
    case "planned":
      return (
        <Row task={task} tone="upcoming">
          {isToday && on.onStart && <RowAction onClick={() => on.onStart?.(task)}>{isAhead ? "skip ahead" : "start"}</RowAction>}
        </Row>
      );
  }
}

function Row({
  task,
  tone,
  struck = false,
  tag,
  children,
}: {
  task: TaskView;
  tone: "done" | "dim" | "upcoming";
  /** Finished (done or dropped): a thin line through the title. */
  struck?: boolean;
  tag?: string;
  children?: React.ReactNode;
}) {
  const title = `${tone === "upcoming" ? "text-stone-600" : "text-stone-500"}${struck ? " line-through decoration-stone-400" : ""}`;
  const fade = useFadeIn();
  return (
    <div className={`${fade} group ${ROW} min-h-8`}>
      <Numeral n={task.position} size="xs" tone={tone === "upcoming" ? "muted" : "dim"} className={`${GUTTER} leading-8`} />
      <div className={`min-w-0 py-1 text-[15px] leading-6 [overflow-wrap:anywhere] ${title}`}>{task.title}</div>
      <div className="flex items-baseline justify-end gap-4 pl-4 leading-7">
        {tag && <span className="clock text-[12px] text-stone-500">{tag}</span>}
        {children}
      </div>
    </div>
  );
}

/** A row's one action: shown while the pointer is over the row or it has focus; a tag it replaces stays otherwise. */
function RowAction({ onClick, tag, children }: { onClick: () => void; tag?: string; children: React.ReactNode }) {
  return (
    <button type="button" className="group/action text-right text-[12px] text-stone-500 hover:text-stone-900" onClick={onClick}>
      {tag && <span className="clock text-stone-500 group-hover:hidden group-focus-visible/action:hidden">{tag}</span>}
      <span className={`${tag ? "hidden group-hover:inline group-focus-visible/action:inline" : "opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible/action:opacity-100"}`}>
        {children}
      </span>
    </button>
  );
}

/**
 * The current task: the one block the page sets apart, bounded by an ink rule above and a
 * hairline below across the text column, like every other rule; its numeral hangs in the
 * margin like every other numeral. The rule is also the countdown: it shortens while a
 * pomodoro or a break runs. The title is the largest text on the page, the two clocks are
 * named, and one filled button is the primary action (unless the screen's filled button is
 * elsewhere). When a pomodoro rings, its answers take the action row's place, so nothing
 * below moves.
 */
function CurrentRow({
  task,
  pomodoro,
  brk,
  now,
  onComplete,
  onTakeFive,
  onResume,
  onDefer,
  line,
  quiet,
}: { task: TaskView; pomodoro: PomodoroView; brk: BreakView | null; now: string; line: boolean; quiet: boolean } & Actions) {
  const paused = task.status === "paused";
  const live = useElapsed(task.id, initialLive(task, pomodoro, brk, now), !paused || !!brk);
  const fade = useFadeIn();
  const note = task.note ?? "";
  // Settings → "Countdown in the rule": off leaves the rule a plain ink line.
  const fraction = line ? clockFacts(pomodoro, brk, live, paused).fraction : null;
  const filled = quiet ? ({ variant: "text" } as const) : ({ size: "sm" } as const);
  const primary = paused ? (
    <Button {...filled} title="Space" aria-label="Resume (Space); task time records again" onClick={() => onResume?.(task)}>
      Resume
    </Button>
  ) : (
    <Button {...filled} title="⌘↩" aria-label="Done (⌘↩)" onClick={() => onComplete?.(task)}>
      Done
    </Button>
  );
  const ringing = !paused && live.pomodoro === "done";
  return (
    <div className={`${fade} my-3 border-b border-b-stone-200 pb-4`}>
      <TimerRule fraction={fraction} />
      <div className="-ml-10 grid grid-cols-[2.5rem_minmax(0,1fr)] items-baseline pt-4">
        <Numeral n={task.position} size="xs" tone="ink" className="pr-3 text-right leading-7" />
        <div className="min-w-0">
          <div className="text-[20px] leading-7 text-stone-900">{task.title}</div>
          {note && <div className="mt-1 text-[13px] leading-5 text-stone-500">{note}</div>}
          <Clocks pomodoro={pomodoro} brk={brk} live={live} paused={paused} />
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            {ringing ? (
              <RingRow task={task} pomodoro={pomodoro} quiet={quiet} onTakeFive={() => onTakeFive?.(task)} onDone={() => onComplete?.(task)} />
            ) : (
              <>
                {primary}
                <SecondaryActions task={task} pomodoro={pomodoro} live={live} paused={paused} onTakeFive={() => onTakeFive?.(task)} onDefer={() => onDefer?.(task)} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
