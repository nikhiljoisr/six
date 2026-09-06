import { useEffect, useRef } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Button, Numeral } from "../components/ui";
import { api } from "../lib/api";
import { duration } from "../lib/format";
import { chime } from "../lib/sound";
import { installInteractionStamps } from "../lib/touch";
import { useElapsed } from "../lib/useElapsed";
import type { BreakView, DaySnapshot, Nudge, PlanView, PomodoroView, TaskView } from "../lib/types";
import { breakMinutes, initialLive, TimerLine } from "../components/Pomodoro";
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
    <div ref={root} className="flex flex-col border border-stone-200 bg-paper px-5 pb-4 pt-5 select-none">
      {nudge && <NudgeStrip nudge={nudge} sound={snapshot?.settings.sound_enabled ?? false} />}
      {snapshot && plan && current ? (
        nudge ? (
          <CurrentLine task={current} pomodoro={snapshot.pomodoro} brk={snapshot.break} now={snapshot.now} />
        ) : (
          <Current task={current} pomodoro={snapshot.pomodoro} brk={snapshot.break} now={snapshot.now} />
        )
      ) : (
        <Idle snapshot={snapshot} plan={plan} onOpen={open} />
      )}
      <div className="mt-4 pt-3">
        {error && (
          <button type="button" className="mb-2 block w-full truncate text-left text-xs text-stone-500" onClick={clearError}>
            {error}
          </button>
        )}
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="text-xs text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-900"
            onClick={() => open()}
          >
            Open Six
          </button>
          {plan && (
            <span className="text-[11px] tabular-nums text-stone-500">
              {plan.done_count} of {plan.task_count} done
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Current({ task, pomodoro, brk, now }: { task: TaskView; pomodoro: PomodoroView; brk: BreakView | null; now: string }) {
  const dispatch = useStore((s) => s.dispatch);
  const paused = task.status === "paused";
  const live = useElapsed(task.id, initialLive(task, pomodoro, brk, now), !paused || !!brk);
  const ringing = !paused && live.pomodoro === "done";
  return (
    <div>
      <div className="flex items-start gap-3">
        <Numeral n={task.position} size="xl" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[15px] font-medium leading-snug text-stone-900">{task.title}</div>
          <div className="mt-1 text-sm tabular-nums text-stone-500">{duration(live.seconds)} recorded</div>
          <TimerLine task={task} pomodoro={pomodoro} brk={brk} live={live} paused={paused} />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-5">
        <Button className="px-4" onClick={() => void dispatch(() => api.complete(task.id))}>
          Done
        </Button>
        {paused ? (
          <Button variant="secondary" aria-label="Resume; task time records again" onClick={() => void dispatch(() => api.resume(task.id))}>
            Resume
          </Button>
        ) : (
          !ringing && (
            <Button
              variant="secondary"
              title={`${breakMinutes(pomodoro)}-minute break; task time pauses`}
              aria-label={`Pause for a ${breakMinutes(pomodoro)}-minute break; task time pauses`}
              onClick={() => void dispatch(() => api.pause(task.id, "break"))}
            >
              Pause
            </Button>
          )
        )}
        <Button variant="secondary" onClick={() => void dispatch(() => api.defer(task.id))}>
          Defer
        </Button>
      </div>
    </div>
  );
}

/** Under a nudge: the task and its clocks in one line each; the nudge holds the actions. */
function CurrentLine({ task, pomodoro, brk, now }: { task: TaskView; pomodoro: PomodoroView; brk: BreakView | null; now: string }) {
  const paused = task.status === "paused";
  const live = useElapsed(task.id, initialLive(task, pomodoro, brk, now), !paused || !!brk);
  return (
    <div className="flex items-start gap-3">
      <Numeral n={task.position} size="md" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium text-stone-900">{task.title}</div>
        <div className="mt-0.5 text-sm tabular-nums text-stone-500">{duration(live.seconds)} recorded</div>
        {live.pomodoro !== "done" && <TimerLine task={task} pomodoro={pomodoro} brk={brk} live={live} paused={paused} />}
      </div>
    </div>
  );
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
      <h1 className={`font-serif text-2xl font-normal ${amber ? "text-amber-700" : "text-stone-900"}`}>{title}</h1>
      <p className="mt-1 text-sm text-stone-500">{body}</p>
      {action && onAction && (
        <Button className="mt-4 px-4 py-2 text-sm" onClick={onAction}>
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
    <div className="-mx-5 -mt-5 mb-3 border-b border-stone-200 bg-white px-5 py-2.5" role="status">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-medium leading-snug text-stone-900">{nudge.title}</div>
          {nudge.body && <div className="text-sm text-stone-500">{nudge.body}</div>}
        </div>
        <button type="button" className="shrink-0 text-xs text-stone-500 hover:text-stone-900" aria-label="Dismiss" onClick={() => dismiss(nudge.kind)}>
          ✕
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4">
        {nudge.actions.map((a) => (
          <Button key={a.id} variant="link" className="px-0" onClick={() => void act(a.id)}>
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
