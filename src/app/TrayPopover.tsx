import { useEffect, useRef } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Button, Numeral } from "../components/ui";
import { api } from "../lib/api";
import { chime } from "../lib/sound";
import { installInteractionStamps } from "../lib/touch";
import { useElapsed, type Live } from "../lib/useElapsed";
import type { BreakView, DaySnapshot, Nudge, PlanView, PomodoroView, TaskView } from "../lib/types";
import { Dots, RingAnswers, SecondaryActions } from "../components/Pomodoro";
import { clockFacts, initialLive } from "../lib/clocks";
import { useStore, type View } from "../store";

// The menu bar popover (SPEC §4.11): 320 points wide, anchored to the tray, as tall as
// its content. One composition at a time: the task, its two clocks, one group of
// actions, and Open Six. A nudge takes the action group's place rather than stacking a
// second one under it.

const BANNER_MS = 25_000;

export function TrayPopover() {
  const snapshot = useStore((s) => s.snapshot);
  const refresh = useStore((s) => s.refresh);
  const nudge = useStore((s) => s.nudges[0] ?? null);
  const pushNudge = useStore((s) => s.pushNudge);
  const error = useStore((s) => s.error);
  const clearError = useStore((s) => s.clearError);
  const root = useRef<HTMLDivElement>(null);

  // A nudge shown as Six's own banner: Rust opens the popover under the tray and sends
  // the nudge here; the strip at the top shows them one at a time.
  useEffect(() => {
    const unlisten = getCurrentWebviewWindow().listen<Nudge>("popover_nudge", (event) => {
      pushNudge(event.payload);
      void refresh();
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, [pushNudge, refresh]);

  useEffect(() => {
    const unlisten = getCurrentWebviewWindow().listen("popover_shown", () => void refresh());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void api.hidePopover();
    };
    window.addEventListener("keydown", onKey);
    // A click here is an interaction too, for idle detection.
    const stamps = installInteractionStamps();
    return () => {
      void unlisten.then((f) => f());
      window.removeEventListener("keydown", onKey);
      stamps();
    };
  }, [refresh]);

  const plan = snapshot?.today_plan?.locked_at ? snapshot.today_plan : null;
  const current = plan?.tasks.find((t) => t.status === "active" || t.status === "paused") ?? null;

  // The window follows its content: long titles, notes and a nudge all fit, within
  // bounds Rust keeps. Measured after every change of what is shown, and whenever the
  // layout moves for any other reason.
  const lastHeight = useRef(0);
  const fit = () => {
    const el = root.current;
    if (!el) return;
    const h = Math.ceil(el.getBoundingClientRect().height);
    if (h > 0 && h !== lastHeight.current) {
      lastHeight.current = h;
      void api.sizePopover(h);
    }
  };
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(fit, [nudge?.kind, nudge?.due, current?.id, current?.status, snapshot?.revision, error]);
  const open = (target?: View) => void api.showMain(target);

  return (
    <div ref={root} className="flex flex-col border border-stone-200 bg-paper px-5 pb-3 pt-5 select-none">
      {nudge && <NudgeStrip nudge={nudge} sound={snapshot?.settings.sound_enabled ?? false} />}
      {snapshot && plan && current ? (
        nudge ? (
          <CurrentLine task={current} pomodoro={snapshot.pomodoro} brk={snapshot.break} now={snapshot.now} line={snapshot.settings.countdown_line} />
        ) : (
          <Current task={current} pomodoro={snapshot.pomodoro} brk={snapshot.break} now={snapshot.now} line={snapshot.settings.countdown_line} />
        )
      ) : (
        <Idle snapshot={snapshot} plan={plan} onOpen={open} />
      )}
      <div className="mt-4 border-t border-stone-200 pt-2.5 font-serif text-[12px] leading-5 text-stone-500">
        {error && (
          <button type="button" className="mb-1 block w-full truncate text-left font-sans text-[12px]" onClick={clearError}>
            {error}
          </button>
        )}
        <div className="flex items-baseline justify-between">
          <button type="button" className="hover:text-stone-900" onClick={() => open()}>
            Open Six
          </button>
          {plan && (
            <span className="tabular-nums">
              {plan.done_count} of {plan.task_count} done
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** The task and its two clocks, the same in every state of the panel. */
function TaskFacts({ task, pomodoro, brk, live, paused, line }: { task: TaskView; pomodoro: PomodoroView; brk: BreakView | null; live: Live; paused: boolean; line: boolean }) {
  const f = clockFacts(task, pomodoro, brk, live, paused);
  if (!line) f.fraction = null;
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <Numeral n={task.position} size="md" />
        <div className="min-w-0 flex-1 line-clamp-2 text-[15px] leading-5 text-stone-900">{task.title}</div>
      </div>
      <span className="sr-only" aria-live="polite">
        {f.spoken}
      </span>
      <div className="mt-2 text-[13px] leading-5">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-stone-500">Task time</span>
          <span className="tabular-nums text-stone-900">{f.taskFact}</span>
        </div>
        {f.label && (
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-stone-500">{f.label}</span>
            <span className={`tabular-nums ${f.quiet ? "text-stone-500" : "font-medium text-stone-900"}`}>
              {f.fact}
              <Dots count={f.dots} />
            </span>
          </div>
        )}
        {!f.label && f.dots > 0 && (
          <div className="text-right">
            <Dots count={f.dots} />
          </div>
        )}
        {f.fraction !== null && (
          <div className="mt-1.5 h-px w-full bg-stone-300" aria-hidden>
            <div className="ml-auto h-full bg-stone-900" style={{ width: `${f.fraction * 100}%`, transition: "width 200ms linear" }} />
          </div>
        )}
      </div>
    </div>
  );
}

function Current({ task, pomodoro, brk, now, line }: { task: TaskView; pomodoro: PomodoroView; brk: BreakView | null; now: string; line: boolean }) {
  const dispatch = useStore((s) => s.dispatch);
  const paused = task.status === "paused";
  const live = useElapsed(task.id, initialLive(task, pomodoro, brk, now), !paused || !!brk);
  return (
    <div>
      <TaskFacts task={task} pomodoro={pomodoro} brk={brk} live={live} paused={paused} line={line} />
      {!paused && live.pomodoro === "done" && (
        <div className="mt-1.5 flex flex-wrap justify-end gap-x-4 gap-y-1 text-[13px]">
          <RingAnswers task={task} pomodoro={pomodoro} />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <Button size="sm" className="px-3" onClick={() => void dispatch(() => api.complete(task.id))}>
          Done
        </Button>
        {paused && (
          <Button variant="link" aria-label="Resume; task time records again" onClick={() => void dispatch(() => api.resume(task.id))}>
            Resume
          </Button>
        )}
        <SecondaryActions
          task={task}
          pomodoro={pomodoro}
          live={live}
          paused={paused}
          withRing={false}
          onTakeFive={() => void dispatch(() => api.pause(task.id, "break"))}
          onDefer={() => void dispatch(() => api.defer(task.id))}
        />
      </div>
    </div>
  );
}

/** Under a nudge: the same task row, without its actions; the nudge holds them. */
function CurrentLine({ task, pomodoro, brk, now, line }: { task: TaskView; pomodoro: PomodoroView; brk: BreakView | null; now: string; line: boolean }) {
  const paused = task.status === "paused";
  const live = useElapsed(task.id, initialLive(task, pomodoro, brk, now), !paused || !!brk);
  return <TaskFacts task={task} pomodoro={pomodoro} brk={brk} live={live} paused={paused} line={line} />;
}

function Idle({ snapshot, plan, onOpen }: { snapshot: DaySnapshot | null; plan: PlanView | null; onOpen: (target?: View) => void }) {
  if (!snapshot) return <p className="text-sm text-stone-400">Loading…</p>;
  const evening = snapshot.phase === "after_evening";
  const tomorrowPlanned = !!snapshot.tomorrow_plan?.locked_at;
  if (evening && !tomorrowPlanned && (!plan || !plan.tasks.some((t) => t.status === "active"))) {
    return (
      <Prompt
        title="Set tomorrow's six."
        body="Plan it now so morning starts clear."
        action="Plan tomorrow"
        onAction={() => onOpen({ name: "planner", date: snapshot.tomorrow })}
      />
    );
  }
  if (!plan) {
    return (
      <Prompt
        title="What are today's six?"
        body="No list for today yet."
        action="Plan today"
        onAction={() => onOpen({ name: "planner", date: snapshot.today })}
      />
    );
  }
  if (plan.all_done) {
    return <Prompt title="Six done." body="Today's list is complete." amber />;
  }
  return <Prompt title="Nothing running." body={plan.reviewed_at ? "Today is reviewed." : "Pick up the next task in Six."} />;
}

function Prompt({ title, body, action, onAction, amber = false }: { title: string; body: string; action?: string; onAction?: () => void; amber?: boolean }) {
  return (
    <div>
      <h1 className={`font-serif text-[17px] leading-6 font-normal ${amber ? "text-amber-700" : "text-stone-900"}`}>{title}</h1>
      <p className="mt-0.5 text-[13px] leading-5 text-stone-500">{body}</p>
      {action && onAction && (
        <Button size="sm" className="mt-3 px-3" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}

// One nudge at a time. Each gets its own spell on screen from the moment it shows, and
// asks Rust to keep the popover up for it (the previous banner's clock may be running
// out). While the popover has focus the strip waits to be answered.
function NudgeStrip({ nudge, sound }: { nudge: Nudge; sound: boolean }) {
  const dispatch = useStore((s) => s.dispatch);
  const dismiss = useStore((s) => s.dismissNudge);
  useEffect(() => {
    void api.showBanner();
    const t = window.setTimeout(() => {
      if (!document.hasFocus()) dismiss(nudge.kind);
    }, BANNER_MS);
    return () => window.clearTimeout(t);
  }, [nudge.kind, nudge.due, dismiss]);
  useEffect(() => {
    if (sound && (nudge.kind === "pomodoro_done" || nudge.kind === "break_over")) chime();
  }, [sound, nudge.kind, nudge.due]);
  const act = async (id: string) => {
    const err = await dispatch(() => api.nudgeAction(nudge.kind, id, nudge.task_id));
    if (err && err.code !== "stale_nudge") return;
    dismiss(nudge.kind);
    if (useStore.getState().nudges.length === 0) void api.hidePopover();
  };
  return (
    <div className="-mx-5 -mt-5 mb-4 border-b border-stone-200 border-t-2 border-t-stone-900 px-5 pb-3 pt-2.5" role="status">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] leading-6 text-stone-900">{nudge.title}</div>
          {nudge.body && <div className="text-[13px] leading-5 text-stone-500">{nudge.body}</div>}
        </div>
        <button type="button" className="shrink-0 font-serif text-[12px] leading-6 text-stone-500 hover:text-stone-900" aria-label="Dismiss" onClick={() => dismiss(nudge.kind)}>
          ✕
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
        {nudge.actions.map((a, i) => (
          <Button key={a.id} variant={i === 0 ? "primary" : "link"} size="sm" className={i === 0 ? "px-3" : ""} onClick={() => void act(a.id)}>
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
