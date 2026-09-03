import { useState } from "react";
import { SkipAheadSheet } from "../components/SkipAheadSheet";
import { TaskCard } from "../components/TaskCard";
import { Button, CalendarIcon, FlameIcon, Label, Numeral, Rule } from "../components/ui";
import { api } from "../lib/api";
import { dayLabel, hourLabel } from "../lib/format";
import type { DaySnapshot, PlanView, TaskView } from "../lib/types";
import { useStore } from "../store";

export function Day({ snapshot }: { snapshot: DaySnapshot }) {
  const navigate = useStore((s) => s.navigate);
  const dispatch = useStore((s) => s.dispatch);
  const [skipTarget, setSkipTarget] = useState<TaskView | null>(null);

  const plan = snapshot.today_plan;
  const locked = !!plan?.locked_at;
  const evening = snapshot.phase === "after_evening";

  const start = async (task: TaskView) => {
    const err = await dispatch(() => api.activate(task.id, false));
    if (err?.code === "needs_override") setSkipTarget(task);
  };
  const blocking = plan && skipTarget ? earliestOpenBefore(plan, skipTarget) : null;

  return (
    <div className="pb-16">
      <header className="flex items-start justify-between">
        <div>
          <Label>{dayLabel(snapshot.today)}</Label>
          <h1 className="mt-2 font-serif text-4xl font-normal text-stone-900">Six</h1>
        </div>
        <div className="mt-1 flex items-center gap-4">
          {snapshot.streak > 0 && (
            <span className="flex items-center gap-1 text-sm tabular-nums text-amber-700" title="Consecutive planned days">
              <FlameIcon />
              {snapshot.streak}
            </span>
          )}
          <button
            type="button"
            className="text-stone-500 transition-opacity hover:text-stone-900"
            aria-label="History"
            onClick={() => navigate({ name: "history" })}
          >
            <CalendarIcon />
          </button>
        </div>
      </header>

      {!locked && !evening && <NoListYet snapshot={snapshot} />}
      {!locked && evening && <EveningRitual snapshot={snapshot} />}
      {locked && plan && (
        <>
          {plan.all_done ? <SixDone /> : <Counter plan={plan} />}
          <ol className="mt-4 space-y-2">
            {plan.tasks.map((task) => (
              <li key={task.id}>
                <TaskCard
                  task={task}
                  pomodoro={snapshot.pomodoro}
                  isToday={plan.is_today}
                  isAhead={plan.tasks.some((t) => t.position < task.position && isOpen(t))}
                  onStart={start}
                  onComplete={(t) => void dispatch(() => api.complete(t.id))}
                  onUndo={(t) => void dispatch(() => api.reopen(t.id))}
                  onTakeFive={(t) => void dispatch(() => api.pause(t.id, "break"))}
                  onResume={(t) => void dispatch(() => api.resume(t.id))}
                  onDefer={(t) => void dispatch(() => api.defer(t.id))}
                />
              </li>
            ))}
          </ol>
          {plan.edited_after_lock && (
            <p className="mt-3 text-center text-[11px] text-stone-400">edited after locking</p>
          )}
          <Rule className="my-8" />
          <TomorrowArea snapshot={snapshot} />
          {plan.all_done && !plan.reviewed_at && (
            <Button className="mt-8 px-6" onClick={() => navigate({ name: "review", planId: plan.id })}>
              Review today
            </Button>
          )}
        </>
      )}

      {skipTarget && blocking && (
        <SkipAheadSheet
          target={skipTarget}
          blocking={blocking}
          onCancel={() => setSkipTarget(null)}
          onConfirm={() => {
            const id = skipTarget.id;
            setSkipTarget(null);
            void dispatch(() => api.activate(id, true));
          }}
        />
      )}
    </div>
  );
}

function isOpen(t: TaskView) {
  return t.status === "planned" || t.status === "active" || t.status === "paused";
}

function earliestOpenBefore(plan: PlanView, target: TaskView): TaskView | null {
  return plan.tasks.find((t) => t.position < target.position && isOpen(t)) ?? null;
}

function Counter({ plan }: { plan: PlanView }) {
  return (
    <p className="mt-10 text-sm text-stone-500">
      {plan.done_count} of {plan.task_count} done
    </p>
  );
}

function SixDone() {
  return (
    <div className="mt-10">
      <h2 className="font-serif text-3xl font-normal text-amber-700">Six done.</h2>
      <p className="mt-1 text-sm text-stone-500">Today's list is complete.</p>
    </div>
  );
}

function NoListYet({ snapshot }: { snapshot: DaySnapshot }) {
  const navigate = useStore((s) => s.navigate);
  const carry = snapshot.carryover_preview;
  return (
    <section className="mt-20 text-center">
      <Label>No list yet</Label>
      <h2 className="mt-3 font-serif text-3xl font-normal text-stone-900">What are today's six?</h2>
      <p className="mx-auto mt-3 max-w-xs text-[15px] text-stone-500">
        Six tasks, most important first. Work on the first until it is done.
      </p>
      <Button className="mt-8 px-6" onClick={() => navigate({ name: "planner", date: snapshot.today })}>
        Plan today's six
      </Button>
      {carry && carry.tasks.length > 0 && (
        <p className="mt-6 text-sm text-amber-700">
          {carry.tasks.length} {carry.tasks.length === 1 ? "task" : "tasks"} from {sourceLabel(carry.from_date, snapshot.today)} will carry over.
        </p>
      )}
    </section>
  );
}

function EveningRitual({ snapshot }: { snapshot: DaySnapshot }) {
  const navigate = useStore((s) => s.navigate);
  const tomorrow = snapshot.tomorrow_plan;
  if (tomorrow?.locked_at) {
    return (
      <section className="mt-16">
        <Label>Tomorrow's six</Label>
        <PlanPreview plan={tomorrow} onEdit={() => navigate({ name: "planner", date: snapshot.tomorrow })} />
        <p className="mt-6 text-sm text-stone-400">Planned. Morning starts clear.</p>
        <PlanTodayInstead date={snapshot.today} className="mt-8" />
      </section>
    );
  }
  return (
    <section className="mt-20 text-center">
      <Label>Evening ritual</Label>
      <h2 className="mt-3 font-serif text-3xl font-normal text-stone-900">Set tomorrow's six.</h2>
      <p className="mt-3 text-[15px] text-stone-500">Plan it now so morning starts clear.</p>
      <Button className="mt-8 px-6" onClick={() => navigate({ name: "planner", date: snapshot.tomorrow })}>
        Plan tomorrow's six
      </Button>
      <PlanTodayInstead date={snapshot.today} className="mt-6 block w-full text-center" />
    </section>
  );
}

/** Late start: the evening ritual leads, but today can still get its six. */
function PlanTodayInstead({ date, className = "" }: { date: string; className?: string }) {
  const navigate = useStore((s) => s.navigate);
  return (
    <button
      type="button"
      className={`text-sm text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-900 ${className}`}
      onClick={() => navigate({ name: "planner", date })}
    >
      Plan today instead
    </button>
  );
}

function TomorrowArea({ snapshot }: { snapshot: DaySnapshot }) {
  const navigate = useStore((s) => s.navigate);
  const today = snapshot.today_plan;
  const tomorrow = snapshot.tomorrow_plan;
  const evening = snapshot.phase === "after_evening";
  const reviewed = !!today?.reviewed_at;
  // Once the evening hour passes, the review is the way to plan tomorrow: it ends in the
  // planner. Before that, or after reviewing, planning tomorrow stands on its own. A list
  // that is all done offers its review button separately (see Day).
  const offerReview = !!today && evening && !reviewed && !today.all_done;
  const planTomorrow = () => navigate({ name: "planner", date: snapshot.tomorrow });
  const reviewToday = () => today && navigate({ name: "review", planId: today.id });
  return (
    <section>
      <div className="flex items-baseline justify-between">
        <Label>Tomorrow</Label>
        {reviewed && <span className="text-[11px] text-stone-400">Reviewed</span>}
      </div>
      {tomorrow?.locked_at ? (
        <>
          <PlanPreview plan={tomorrow} onEdit={planTomorrow} />
          {offerReview && (
            <Button className="mt-5" onClick={reviewToday}>
              Review today
            </Button>
          )}
        </>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-stone-500">
            {evening ? "Time to plan tomorrow's six." : `After ${hourLabel(snapshot.settings.evening_hour)}, plan tomorrow's six.`}
          </p>
          {offerReview ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={reviewToday}>Review today</Button>
              <Button variant="secondary" onClick={planTomorrow}>
                Plan tomorrow
              </Button>
            </div>
          ) : (
            <Button variant={evening ? "primary" : "secondary"} className="mt-3" onClick={planTomorrow}>
              Plan tomorrow
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function PlanPreview({ plan, onEdit }: { plan: PlanView; onEdit: () => void }) {
  return (
    <div className="mt-3">
      <ol className="space-y-1.5">
        {plan.tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-3 text-[15px] text-stone-500">
            <Numeral n={t.position} size="sm" tone="muted" className="w-4 text-center" />
            <span className="truncate">{t.title}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="mt-3 text-sm text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-900" onClick={onEdit}>
        edit
      </button>
    </div>
  );
}

function sourceLabel(fromDate: string, today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const yesterday = new Date(y, m - 1, d - 1);
  const iso = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  return fromDate === iso ? "yesterday" : dayLabel(fromDate).toLowerCase();
}
