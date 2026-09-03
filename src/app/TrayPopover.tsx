import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button, Numeral } from "../components/ui";
import { api } from "../lib/api";
import { duration } from "../lib/format";
import { chime } from "../lib/sound";
import { useElapsed } from "../lib/useElapsed";
import type { DaySnapshot, Nudge, PlanView, PomodoroView, TaskView } from "../lib/types";
import { breakLabel, initialLive, PomodoroLine } from "../components/Pomodoro";
import { useStore, type View } from "../store";

// The menu bar popover (SPEC §4.11): about 320×220, anchored to the tray. The active
// task's numeral and title, its clock (ticking while the popover is open), and three
// actions. Everything else lives in the main window.

const BANNER_MS = 25_000;

export function TrayPopover() {
  const snapshot = useStore((s) => s.snapshot);
  const refresh = useStore((s) => s.refresh);
  const nudge = useStore((s) => s.nudges[0] ?? null);
  const pushNudge = useStore((s) => s.pushNudge);
  const dismissNudge = useStore((s) => s.dismissNudge);

  // A nudge shown as Six's own banner: the popover opens under the tray, the strip
  // appears at the top, and both go away after a while unless answered.
  useEffect(() => {
    let timer: number | null = null;
    const unlisten = listen<Nudge>("popover_nudge", (event) => {
      pushNudge(event.payload);
      void refresh();
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => dismissNudge(event.payload.kind), BANNER_MS);
    });
    return () => {
      void unlisten.then((f) => f());
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [pushNudge, dismissNudge, refresh]);

  useEffect(() => {
    const unlisten = listen("popover_shown", () => void refresh());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void api.hidePopover();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      void unlisten.then((f) => f());
      window.removeEventListener("keydown", onKey);
    };
  }, [refresh]);

  const plan = snapshot?.today_plan?.locked_at ? snapshot.today_plan : null;
  const current = plan?.tasks.find((t) => t.status === "active" || t.status === "paused") ?? null;
  const open = (target?: View) => void api.showMain(target);

  return (
    <div className="flex h-screen flex-col border border-stone-200 bg-stone-50 px-5 pb-4 pt-5 select-none">
      {nudge && <NudgeStrip nudge={nudge} sound={snapshot?.settings.sound_enabled ?? false} />}
      {snapshot && plan && current ? (
        <Current task={current} pomodoro={snapshot.pomodoro} />
      ) : (
        <Idle snapshot={snapshot} plan={plan} onOpen={open} />
      )}
      <div className="mt-auto flex items-center justify-between pt-3">
        <button
          type="button"
          className="text-xs text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-900"
          onClick={() => open()}
        >
          Open Six
        </button>
        {plan && (
          <span className="text-[11px] tabular-nums text-stone-400">
            {plan.done_count} of {plan.task_count} done
          </span>
        )}
      </div>
    </div>
  );
}

function Current({ task, pomodoro }: { task: TaskView; pomodoro: PomodoroView }) {
  const dispatch = useStore((s) => s.dispatch);
  const paused = task.status === "paused";
  const live = useElapsed(task.id, initialLive(task, pomodoro), !paused);
  const seconds = live.seconds;
  return (
    <div>
      <div className="flex items-start gap-3">
        <Numeral n={task.position} size="xl" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[15px] font-medium leading-snug text-stone-900">{task.title}</div>
          <div className="mt-1 text-sm tabular-nums text-stone-500">
            {duration(seconds)}
            {paused && <span className="text-stone-400"> · paused</span>}
          </div>
          <PomodoroLine task={task} pomodoro={pomodoro} phase={live.pomodoro} remaining={live.remaining} paused={paused} compact />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button className="flex-1 px-3 py-2 text-sm" onClick={() => void dispatch(() => api.complete(task.id))}>
          Done
        </Button>
        {paused ? (
          <Button variant="secondary" className="flex-1 px-3 py-2 text-sm" onClick={() => void dispatch(() => api.resume(task.id))}>
            Resume
          </Button>
        ) : (
          <Button variant="secondary" className="flex-1 px-3 py-2 text-sm" onClick={() => void dispatch(() => api.pause(task.id, "break"))}>
            {pomodoro.enabled && live.pomodoro === "done" ? breakLabel(pomodoro) : "Take 5"}
          </Button>
        )}
        <Button variant="secondary" className="flex-1 px-3 py-2 text-sm" onClick={() => void dispatch(() => api.defer(task.id))}>
          Defer
        </Button>
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

function NudgeStrip({ nudge, sound }: { nudge: Nudge; sound: boolean }) {
  const dispatch = useStore((s) => s.dispatch);
  const dismiss = useStore((s) => s.dismissNudge);
  useEffect(() => {
    if (sound && (nudge.kind === "pomodoro_done" || nudge.kind === "break_over")) chime();
  }, [sound, nudge.kind, nudge.due]);
  const act = async (id: string) => {
    dismiss(nudge.kind);
    await dispatch(() => api.nudgeAction(nudge.kind, id));
    void api.hidePopover();
  };
  return (
    <div className="-mx-5 -mt-5 mb-3 border-b border-stone-200 bg-white px-5 py-3" role="status">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium text-stone-900">{nudge.title}</div>
          {nudge.body && <div className="truncate text-sm text-stone-500">{nudge.body}</div>}
        </div>
        <button type="button" className="shrink-0 text-xs text-stone-400 hover:text-stone-600" aria-label="Dismiss" onClick={() => dismiss(nudge.kind)}>
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
