import { duration } from "../lib/format";
import type { PomodoroView, TaskView } from "../lib/types";
import { useElapsed } from "../lib/useElapsed";
import { breakLabel, initialLive, PomodoroLine } from "./Pomodoro";
import { Button, Numeral } from "./ui";

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
  /** True while an earlier task is still unfinished, so starting this one breaks order. */
  isAhead: boolean;
  /** Undo and starting are only offered on today's list. */
  isToday: boolean;
}

export function TaskCard({ task, pomodoro, isAhead, isToday, ...on }: Props) {
  switch (task.status) {
    case "active":
    case "paused":
      return <CurrentCard task={task} pomodoro={pomodoro} {...on} />;
    case "done":
      return (
        <CompactCard tone="done" task={task}>
          {isToday && on.onUndo && (
            <Button variant="quiet" onClick={() => on.onUndo?.(task)}>
              undo
            </Button>
          )}
        </CompactCard>
      );
    case "deferred":
      return (
        <CompactCard tone="dim" task={task} tag="tomorrow">
          {isToday && on.onUndo && (
            <Button variant="quiet" onClick={() => on.onUndo?.(task)}>
              undo
            </Button>
          )}
        </CompactCard>
      );
    case "skipped":
      return (
        <CompactCard tone="done" task={task} tag="dropped">
          {isToday && on.onUndo && (
            <Button variant="quiet" onClick={() => on.onUndo?.(task)}>
              undo
            </Button>
          )}
        </CompactCard>
      );
    case "planned":
      return (
        <CompactCard tone="upcoming" task={task}>
          {isToday && on.onStart && (
            <button
              type="button"
              className="text-[11px] text-stone-400 underline decoration-stone-300 underline-offset-4 hover:text-stone-600"
              onClick={() => on.onStart?.(task)}
            >
              {isAhead ? "skip ahead" : "start"}
            </button>
          )}
        </CompactCard>
      );
  }
}

function CurrentCard({
  task,
  pomodoro,
  onComplete,
  onTakeFive,
  onResume,
  onDefer,
}: { task: TaskView; pomodoro: PomodoroView } & Actions) {
  const paused = task.status === "paused";
  const live = useElapsed(task.id, initialLive(task, pomodoro), !paused);
  const seconds = live.seconds;
  return (
    <div className="rounded-card border-2 border-stone-900 bg-white px-5 py-5 transition-opacity duration-200">
      <div className="flex gap-4">
        <Numeral n={task.position} size="xl" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-medium leading-snug text-stone-900">{task.title}</div>
          {task.note && <div className="mt-1 text-sm text-stone-500">{task.note}</div>}
          <div className="mt-1.5 text-sm tabular-nums text-stone-500">
            {duration(seconds)}
            {paused && <span className="text-stone-400"> · paused</span>}
          </div>
          <PomodoroLine task={task} pomodoro={pomodoro} phase={live.pomodoro} remaining={live.remaining} paused={paused} />
        </div>
      </div>
      {paused ? (
        <Button full className="mt-5" onClick={() => onResume?.(task)}>
          Resume
        </Button>
      ) : (
        <Button full className="mt-5" onClick={() => onComplete?.(task)}>
          Mark complete
        </Button>
      )}
      <div className="mt-2 flex items-center justify-center gap-8">
        {!paused && (
          <Button variant="link" onClick={() => onTakeFive?.(task)}>
            {pomodoro.enabled ? breakLabel(pomodoro) : "Take 5"}
          </Button>
        )}
        <Button variant="link" onClick={() => onDefer?.(task)}>
          Defer to tomorrow
        </Button>
      </div>
    </div>
  );
}

function CompactCard({
  task,
  tone,
  tag,
  children,
}: {
  task: TaskView;
  tone: "done" | "dim" | "upcoming";
  tag?: string;
  children?: React.ReactNode;
}) {
  const surface = tone === "done" ? "bg-stone-100/50" : "bg-white";
  const title =
    tone === "done"
      ? "text-stone-400 line-through decoration-stone-300"
      : tone === "dim"
        ? "text-stone-400"
        : "text-stone-500";
  return (
    <div className={`flex items-center gap-3 rounded-card border border-stone-200 px-4 py-3 transition-opacity duration-200 ${surface}`}>
      <Numeral n={task.position} size="sm" tone={tone === "upcoming" ? "muted" : "dim"} className="w-4 text-center" />
      <div className={`min-w-0 flex-1 truncate text-[15px] ${title}`}>{task.title}</div>
      {tag && <span className="text-[11px] text-stone-400">{tag}</span>}
      {children}
    </div>
  );
}
