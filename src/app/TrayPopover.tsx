import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button, Numeral } from "../components/ui";
import { api } from "../lib/api";
import { duration } from "../lib/format";
import { useElapsed } from "../lib/useElapsed";
import type { DaySnapshot, PlanView, TaskView } from "../lib/types";
import { useStore, type View } from "../store";

// The menu bar popover (SPEC §4.11): about 320×220, anchored to the tray. The active
// task's numeral and title, its clock (ticking while the popover is open), and three
// actions. Everything else lives in the main window.

export function TrayPopover() {
  const snapshot = useStore((s) => s.snapshot);
  const refresh = useStore((s) => s.refresh);

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
      {snapshot && plan && current ? (
        <Current task={current} />
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

function Current({ task }: { task: TaskView }) {
  const dispatch = useStore((s) => s.dispatch);
  const paused = task.status === "paused";
  const seconds = useElapsed(task.id, task.focus_seconds, !paused);
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
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Button className="flex-1 px-3 py-2 text-sm" onClick={() => void dispatch(() => api.complete(task.id))}>
          Done
        </Button>
        {paused ? (
          <Button variant="secondary" className="flex-1 px-3 py-2 text-sm" onClick={() => void dispatch(() => api.resume(task.id))}>
            Resume
          </Button>
        ) : (
          <Button variant="secondary" className="flex-1 px-3 py-2 text-sm" onClick={() => void dispatch(() => api.pause(task.id, "break"))}>
            Take 5
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
