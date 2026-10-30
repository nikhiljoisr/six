import { useState } from "react";
import { SkipAheadSheet } from "../components/SkipAheadSheet";
import { TaskCard } from "../components/TaskCard";
import { Button, FlameIcon, Label, Numeral, Rule } from "../components/ui";
import { api } from "../lib/api";
import { dayLabel, dayMonth, hourLabel, weekday } from "../lib/format";
import { isAppError, type DaySnapshot, type PlanView, type TaskView, type UnreviewedDay } from "../lib/types";
import { useStore } from "../store";

export function Day({ snapshot }: { snapshot: DaySnapshot }) {
  const navigate = useStore((s) => s.navigate);
  const dispatch = useStore((s) => s.dispatch);
  const jotting = useStore((s) => s.jotting);
  const setJotting = useStore((s) => s.setJotting);
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
      <header className="flex h-5 items-baseline justify-between gap-6 leading-5">
        <h1 className="font-serif text-[15px] font-normal text-stone-900">
          {weekday(snapshot.today)}, {dayMonth(snapshot.today)}
        </h1>
        <div className="flex shrink-0 items-baseline gap-4 font-serif text-[13px] tabular-nums">
          {snapshot.streak > 0 && <Streak days={snapshot.streak} />}
          {locked && plan && (
            <span className="text-stone-500">
              {plan.done_count} of {plan.task_count} done
            </span>
          )}
        </div>
      </header>
      <Rule className="mt-3" />

      {!locked && !evening && <NoListYet snapshot={snapshot} />}
      {!locked && evening && <EveningRitual snapshot={snapshot} />}
      {!locked && snapshot.unreviewed && <Unreviewed day={snapshot.unreviewed} today={snapshot.today} />}
      {locked && plan && (
        <>
          {plan.all_done && <SixDone />}
          {firstMinutes(plan, snapshot) && (
            <p className="mt-4 text-[13px] leading-5 text-stone-500">Task 1 started recording time when the list was locked. A pomodoro is optional.</p>
          )}
          <div className="min-h-4 flex-1" aria-hidden />
          <ol>
            {plan.tasks.map((task) => (
              <li key={task.id}>
                <TaskCard
                  task={task}
                  pomodoro={snapshot.pomodoro}
                  brk={snapshot.break}
                  now={snapshot.now}
                  countdownLine={snapshot.settings.countdown_line}
                  quietPrimary={evening && !plan.reviewed_at && !plan.all_done}
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
          {plan.edited_after_lock && <p className="mt-2 text-right font-serif text-[12px] leading-5 text-stone-500">edited after locking</p>}
          {plan.all_done && !plan.reviewed_at && (
            <Button className="mt-6 self-start px-5" onClick={() => navigate({ name: "review", planId: plan.id })}>
              Review today
            </Button>
          )}
          <div className="min-h-5 flex-[2]" aria-hidden />
        </>
      )}

      {/* The footer line, in every state: tomorrow on the left once today's list is locked,
          navigation on the right. History is always here; Edit while the pointer is over a locked page. */}
      <div className="mt-auto">
        {/* The jot bar stands in for the footer while it is open; its own top edge is the rule. */}
        <Rule className={`mb-3 ${locked && jotting ? "invisible" : ""}`} />
        <div className="flex items-baseline justify-between gap-6 font-serif text-[12px] leading-5 text-stone-500">
        {locked && plan ? <TomorrowArea snapshot={snapshot} /> : <span />}
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
          {locked && (
            <button
              type="button"
              className="hover:text-stone-900"
              title="Park a thought (J)"
              aria-label="Jot: park a thought for the evening review (J)"
              aria-expanded={jotting}
              onClick={() => setJotting(!jotting)}
            >
              Jot
            </button>
          )}
          <button type="button" className="hover:text-stone-900" onClick={() => navigate({ name: "history" })}>
            History
          </button>
        </nav>
        </div>
      </div>

      {locked && jotting && <JotLine onClose={() => setJotting(false)} />}

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

/** The planning streak, the one counter Six keeps (SPEC §4.6): days in a row with a locked list. */
function Streak({ days }: { days: number }) {
  const label = `Planning streak: ${days} ${days === 1 ? "day" : "days"} in a row with a locked list`;
  return (
    <span className="whitespace-nowrap text-amber-700" role="img" title="Planning streak" aria-label={label}>
      <FlameIcon className="mr-1 inline-block h-3 w-3 align-[-1px]" />
      {days}
    </span>
  );
}

/** The last locked day ended without a review: one quiet line, never in the way of planning. */
function Unreviewed({ day, today }: { day: UnreviewedDay; today: string }) {
  const navigate = useStore((s) => s.navigate);
  const which = sourceLabel(day.date, today);
  return (
    <p className="mt-5 text-[13px] leading-5 text-stone-500">
      {which === "yesterday" ? "Yesterday" : which} was not reviewed.{" "}
      <button type="button" className="text-stone-900 hover:text-stone-500" onClick={() => navigate({ name: "review", planId: day.plan_id })}>
        Review it
      </button>
    </p>
  );
}

/**
 * One line, parked for the evening review so it can be let go of now. It is kept with
 * the day and never becomes a task by itself: six is still the ceiling. A bar over the
 * foot of the page, so nothing on the list moves while it is open. Return saves, Esc
 * closes, and so does leaving it empty.
 */
function JotLine({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      useStore.getState().apply(await api.addJot(text));
      useStore.getState().notify("Parked for the evening review.");
      onClose();
    } catch (e) {
      // Said here, beside the field, not in the page's error line (which this bar covers).
      setProblem(isAppError(e) ? sentence(e.message) : "Could not keep that. Try again.");
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-paper">
      <div className="mx-auto w-full max-w-md px-6 py-3">
        <div className="pl-8">
          <input
            autoFocus
            data-jot
            value={text}
            maxLength={200}
            aria-label="Park a thought for the evening review"
            placeholder="Park a thought for the evening review"
            onChange={(e) => {
              setText(e.target.value);
              setProblem(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
                return;
              }
              // Return keeps the line, with or without Cmd. A Return that commits text
              // from an input method belongs to the input method (WebKit reports it
              // after the composition has ended, as key code 229).
              if (e.key !== "Enter" || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
              e.preventDefault();
              if (!e.repeat) void save();
            }}
            onBlur={() => {
              if (!text.trim()) onClose();
            }}
            className="w-full rounded-control border border-stone-200 bg-white px-3 py-2 text-[15px] text-stone-900 placeholder:text-stone-300 focus:border-stone-400 focus:outline-none"
          />
          {problem && (
            <p className="mt-1 font-serif text-[12px] leading-5 text-stone-500" role="alert">
              {problem}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** A message from Rust as a sentence: capitalised, with its full stop. */
function sentence(message: string): string {
  const s = message.trim();
  return s ? `${s[0].toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? "" : "."}` : s;
}

function isOpen(t: TaskView) {
  return t.status === "planned" || t.status === "active" || t.status === "paused";
}

function earliestOpenBefore(plan: PlanView, target: TaskView): TaskView | null {
  return plan.tasks.find((t) => t.position < target.position && isOpen(t)) ?? null;
}

function SixDone() {
  return (
    <div className="mt-8">
      <h2 className="font-serif text-[20px] leading-7 font-normal text-amber-700">Six done.</h2>
      <p className="mt-1 text-[13px] leading-5 text-stone-500">Today's list is complete.</p>
    </div>
  );
}

function NoListYet({ snapshot }: { snapshot: DaySnapshot }) {
  const navigate = useStore((s) => s.navigate);
  const open = () => navigate({ name: "planner", date: snapshot.today });
  return (
    <section className="mt-8 mb-6">
      <h2 className="font-serif text-[22px] leading-7 font-normal text-stone-900">What are today's six?</h2>
      <p className="mt-1 text-[13px] leading-5 text-stone-500">Most important first. Work on the first until it is done.</p>
      <BlankSix plan={snapshot.today_plan} snapshot={snapshot} onOpen={open} />
      <Button className="mt-6 px-5" onClick={open}>
        Plan today's six
      </Button>
    </section>
  );
}

/**
 * Six numbered lines where the list will stand, with whatever is already chosen (a
 * saved draft, or what carries over) in its place. A line opens the planner; the button
 * below is the same action for the keyboard and for a screen reader, so the lines are
 * hidden from it.
 */
function BlankSix({ plan, snapshot, onOpen }: { plan: PlanView | null; snapshot: DaySnapshot; onOpen: () => void }) {
  const carry = snapshot.carryover_preview;
  const lines = plan?.tasks.length
    ? plan.tasks.map((t) => ({ title: t.title, carried: !!t.carried_from }))
    : (carry?.tasks ?? []).map((t) => ({ title: t.title, carried: true }));
  const from = carry ? sourceLabel(carry.from_date, snapshot.today) : "yesterday";
  return (
    <ol className="mt-5" aria-hidden onClick={onOpen}>
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="group -ml-10 grid grid-cols-[2.5rem_minmax(0,1fr)] items-baseline">
          <Numeral n={i + 1} size="xs" tone="dim" className="pr-3 text-right leading-8" />
          <div className="flex min-h-8 min-w-0 items-baseline justify-between gap-4 border-b border-stone-200 py-1 transition-colors duration-150 group-hover:border-stone-400">
            {/* An empty line still has a baseline for its numeral to sit on. */}
            <span className="min-w-0 text-[15px] leading-6 text-stone-600 [overflow-wrap:anywhere]">{lines[i]?.title || "\u200b"}</span>
            {lines[i]?.carried && <span className="shrink-0 font-serif text-[12px] leading-6 text-amber-700">from {from}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function EveningRitual({ snapshot }: { snapshot: DaySnapshot }) {
  const navigate = useStore((s) => s.navigate);
  const tomorrow = snapshot.tomorrow_plan;
  if (tomorrow?.locked_at) {
    return (
      <section className="mt-10">
        <Label>Tomorrow's six</Label>
        <PlanPreview plan={tomorrow} onEdit={() => navigate({ name: "planner", date: snapshot.tomorrow })} />
        <p className="mt-5 font-serif text-[12px] leading-5 text-stone-500">Planned. Morning starts clear.</p>
        <PlanTodayInstead date={snapshot.today} className="mt-6" />
      </section>
    );
  }
  const open = () => navigate({ name: "planner", date: snapshot.tomorrow });
  return (
    <section className="mt-8 mb-6">
      <h2 className="font-serif text-[22px] leading-7 font-normal text-stone-900">Set tomorrow's six.</h2>
      <p className="mt-1 text-[13px] leading-5 text-stone-500">Plan it now so morning starts clear.</p>
      <BlankSix plan={tomorrow} snapshot={snapshot} onOpen={open} />
      <div className="mt-6 flex items-baseline gap-5">
        <Button className="px-5" onClick={open}>
          Plan tomorrow's six
        </Button>
        <PlanTodayInstead date={snapshot.today} />
      </div>
    </section>
  );
}

/** Late start: the evening ritual leads, but today can still get its six. */
function PlanTodayInstead({ date, className = "" }: { date: string; className?: string }) {
  const navigate = useStore((s) => s.navigate);
  return (
    <button
      type="button"
      className={`text-[13px] leading-5 text-stone-500 hover:text-stone-900 ${className}`}
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
    <section className="min-w-0">
      {tomorrow?.locked_at ? (
        <div className="font-sans text-[13px] leading-5 text-stone-900">
          <div className="flex items-baseline gap-3">
            <Label>Tomorrow</Label>
            {reviewed && <span className="font-serif text-[12px] text-stone-500">Reviewed</span>}
          </div>
          <PlanPreview plan={tomorrow} onEdit={planTomorrow} />
          {offerReview && (
            <Button className="mt-4 px-5" onClick={reviewToday}>
              Review today
            </Button>
          )}
        </div>
      ) : offerReview ? (
        <div className="flex items-center gap-5 font-sans text-[13px] leading-5">
          <Button className="px-5" onClick={reviewToday}>
            Review today
          </Button>
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
    <div className="mt-2">
      <ol>
        {plan.tasks.map((t) => (
          <li key={t.id} className="-ml-10 grid min-h-6 grid-cols-[2.5rem_minmax(0,1fr)] items-baseline text-[13px] leading-6 text-stone-600">
            <Numeral n={t.position} size="xxs" tone="dim" className="pr-3 text-right leading-6" />
            <span className="min-w-0 py-0.5 leading-5 [overflow-wrap:anywhere]">{t.title}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="mt-2 text-[13px] leading-5 text-stone-500 hover:text-stone-900" onClick={onEdit}>
        Edit
      </button>
    </div>
  );
}

function sourceLabel(fromDate: string, today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const yesterday = new Date(y, m - 1, d - 1);
  const iso = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  return fromDate === iso ? "yesterday" : dayLabel(fromDate);
}
