import { useState } from "react";
import { SkipAheadSheet } from "../components/SkipAheadSheet";
import { TaskCard } from "../components/TaskCard";
import { Button, Label, Numeral } from "../components/ui";
import { api } from "../lib/api";
import { dayLabel, dayMonth, hourLabel, weekday } from "../lib/format";
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
    <div className="group/page flex min-h-[calc(100vh-2.5rem)] flex-col pl-8 pr-0 pt-2 pb-12">
      <header className="h-5 leading-5">
        <h1 className="font-serif text-[15px] font-normal text-stone-600">
          {weekday(snapshot.today)}, {dayMonth(snapshot.today)}
        </h1>
      </header>

      {!locked && !evening && <NoListYet snapshot={snapshot} />}
      {!locked && evening && <EveningRitual snapshot={snapshot} />}
      {locked && plan && (
        <>
          {plan.all_done && <SixDone />}
          {firstMinutes(plan, snapshot) && (
            <p className="mt-6 text-sm text-stone-500">Task 1 started recording time when the list was locked. A pomodoro is optional.</p>
          )}
          <div className="min-h-8 flex-1" aria-hidden />
          <ol>
            {plan.tasks.map((task) => (
              <li key={task.id}>
                <TaskCard
                  task={task}
                  pomodoro={snapshot.pomodoro}
                  brk={snapshot.break}
                  now={snapshot.now}
                  countdownLine={snapshot.settings.countdown_line}
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
          {plan.edited_after_lock && <p className="mt-3 text-right text-xs text-stone-500">edited after locking</p>}
          <div className="min-h-10 flex-[2]" aria-hidden />
          <div className="flex items-baseline justify-between gap-6 font-serif text-[12px] leading-5 text-stone-400">
            <TomorrowArea snapshot={snapshot} />
            <nav className="flex shrink-0 items-baseline gap-4 whitespace-nowrap">
              {locked && (
                <button
                  type="button"
                  className="opacity-0 transition-opacity duration-150 hover:text-stone-900 focus-visible:opacity-100 group-hover/page:opacity-100"
                  aria-label="Edit today's list (⌘E)"
                  onClick={() => navigate({ name: "planner", date: snapshot.today })}
                >
                  Edit
                </button>
              )}
              <button type="button" className="hover:text-stone-900" onClick={() => navigate({ name: "history" })}>
                History
              </button>
            </nav>
          </div>
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

/** The first minutes of a fresh list: nothing done, task 1 just started, no timer yet. */
function firstMinutes(plan: PlanView, snapshot: DaySnapshot): boolean {
  const first = plan.tasks[0];
  return (
    plan.done_count === 0 &&
    !!first &&
    first.status === "active" &&
    first.focus_seconds < 600 &&
    first.pomodoros_completed === 0 &&
    snapshot.pomodoro.phase === "idle"
  );
}

function isOpen(t: TaskView) {
  return t.status === "planned" || t.status === "active" || t.status === "paused";
}

function earliestOpenBefore(plan: PlanView, target: TaskView): TaskView | null {
  return plan.tasks.find((t) => t.position < target.position && isOpen(t)) ?? null;
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
      className={`text-sm text-stone-500 hover:text-stone-900 ${className}`}
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
      {tomorrow?.locked_at ? (
        <>
          <div className="flex items-baseline justify-between">
            <Label>Tomorrow</Label>
            {reviewed && <span className="text-xs text-stone-400">Reviewed</span>}
          </div>
          <PlanPreview plan={tomorrow} onEdit={planTomorrow} />
          {offerReview && (
            <Button className="mt-5" onClick={reviewToday}>
              Review today
            </Button>
          )}
        </>
      ) : offerReview ? (
        <div className="flex items-center gap-5">
          <Button onClick={reviewToday}>Review today</Button>
          <Button variant="link" onClick={planTomorrow}>
            Plan tomorrow
          </Button>
        </div>
      ) : evening ? (
        <button type="button" className="text-[12px] leading-5 text-stone-900 hover:text-stone-500" onClick={planTomorrow}>
          Plan tomorrow's six
        </button>
      ) : (
        <button type="button" className="text-stone-500 hover:text-stone-900" onClick={planTomorrow}>
          Tomorrow's six opens at {hourLabel(snapshot.settings.evening_hour)}
        </button>
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
      <button type="button" className="mt-3 text-sm text-stone-500 hover:text-stone-900" onClick={onEdit}>
        Edit
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
