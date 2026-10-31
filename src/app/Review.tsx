import { useEffect, useRef, useState } from "react";
import { Button, Label, Numeral, Rule } from "../components/ui";
import { api } from "../lib/api";
import { clockTime, duration, idleSpan, longDate } from "../lib/format";
import { reviewFlow } from "../lib/reviewFlow";
import type { DaySnapshot, Decision, IdleFlag, PlanView, ReviewView, TaskStatus } from "../lib/types";
import { useStore } from "../store";
import { Planner } from "./Planner";

// The evening review: three panels. 1) what happened, in plain facts, with any likely-idle
// sessions to trim, the thoughts parked during the day and an optional one-line thought;
// 2) carry or drop each unfinished task; 3) tomorrow's six, pre-filled with what carries.
// Leaving panel 2 records the review; panel 3 is the planner itself.
//
// A day that ended without a review can still have one (lib/reviewFlow.ts). It plans
// nothing: it asks about what was left only while that still changes the next list, and
// returns to where it was opened.

const STATUS_WORD: Record<TaskStatus, string> = {
  done: "done",
  active: "in progress",
  paused: "paused",
  planned: "not started",
  deferred: "carried",
  skipped: "dropped",
};

export function Review({ snapshot, planId }: { snapshot: DaySnapshot; planId: string }) {
  const navigate = useStore((s) => s.navigate);
  const dispatch = useStore((s) => s.dispatch);
  // Known before the review loads: today's evening review, or a day that has ended.
  const isToday = snapshot.today_plan?.id === planId;
  // A past day's review returns to where it was opened from (fixed at the first render:
  // navigation moves on). Today's goes to the day view, as it always has.
  const [origin] = useState(() => (!isToday && useStore.getState().previous?.name === "history" ? ({ name: "history" } as const) : ({ name: "day" } as const)));
  const [review, setReview] = useState<ReviewView | null>(null);
  const [panel, setPanel] = useState(0);
  const [reflection, setReflection] = useState("");
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [kept, setKept] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const swipeStart = useRef<number | null>(null);

  const load = () =>
    api
      .getReview(planId)
      .then((r) => {
        setReview(r);
        setProblem(null);
      })
      .catch((e) => setProblem(e?.message ?? "Could not load the review."));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  if (panel === 2) {
    return <Planner snapshot={snapshot} date={snapshot.tomorrow} mergeCarryover onDone={() => navigate({ name: "day" })} />;
  }

  const trim = async (flag: IdleFlag) => {
    setBusy(true);
    const err = await dispatch(() => api.trimSession(flag.session_id, flag.gap_start, flag.gap_end));
    if (!err) {
      useStore.getState().notify(`Trimmed. ${duration(flag.suggested_seconds)} kept.`);
      await load();
    }
    setBusy(false);
  };

  const flow = review ? reviewFlow(isToday, review.still_carries, review.unfinished.length) : null;
  const steps = isToday ? 3 : (flow?.steps ?? 1);

  // "Keep as recorded" hides the block for this visit. When the silence is the one the
  // day view is offering, it is also answered there, so it is not offered a second time.
  const keep = (sessionId: string) => {
    setKept((k) => [...k, sessionId]);
    if (snapshot.return_gap?.session_id === sessionId) void dispatch(() => api.keepGap(sessionId));
  };

  const commit = async () => {
    if (!review || !flow) return;
    setBusy(true);
    const list = flow.askCarry ? review.unfinished.map((task_id) => ({ task_id, decision: decisions[task_id] ?? "carry" })) : [];
    const err = await dispatch(() => api.completeReview(planId, reflection.trim() || null, list));
    setBusy(false);
    if (!err) {
      useStore.getState().notify("Review saved.");
      if (flow.endsIn === "planner") setPanel(2);
      else navigate(origin);
    }
  };

  const removeJot = async (id: string) => {
    setBusy(true);
    const err = await dispatch(() => api.removeJot(id));
    if (!err) await load();
    setBusy(false);
  };

  // Swipe between the first two panels on touch; the step into panel 3 commits, so it
  // stays a deliberate tap.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" || (e.target as HTMLElement).closest("input,button")) return;
    swipeStart.current = e.clientX;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (swipeStart.current === null) return;
    const dx = e.clientX - swipeStart.current;
    swipeStart.current = null;
    if (dx < -60 && panel === 0) setPanel(1);
    if (dx > 60 && panel === 1) setPanel(0);
  };

  return (
    <div className="pb-16 pl-8 pr-0 pt-2" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <header className="flex h-5 items-baseline justify-between gap-6 leading-5">
        <h1 className="font-serif text-[15px] font-normal text-stone-900">{isToday ? "Evening review" : "Review"}</h1>
        <nav className="flex shrink-0 items-baseline gap-4 whitespace-nowrap font-serif text-[12px] text-stone-500">
          {steps > 1 && (
            <span className="tabular-nums" aria-label={`Step ${panel + 1} of ${steps}`}>
              Step {panel + 1} of {steps}
            </span>
          )}
          <button type="button" className="hover:text-stone-900" onClick={() => navigate(origin)}>
            Cancel
          </button>
        </nav>
      </header>
      <Rule className="mt-3" />

      {review && flow && (
        <p className="mt-3 font-serif text-[12px] leading-5 text-stone-500">
          {!flow.past
            ? longDate(review.plan.date)
            : `${longDate(review.plan.date)}. ${
                flow.askCarry ? "What carries goes to the next list you plan." : review.still_carries ? "Nothing was left unfinished." : "A later list is already planned."
              }`}
        </p>
      )}
      {problem && <p className="mt-8 text-[13px] text-stone-500">{problem}</p>}
      {!review && !problem && <p className="mt-8 font-serif text-[12px] text-stone-400">Loading…</p>}

      {review && flow && panel === 0 && (
        <WhatHappened
          review={review}
          kept={kept}
          busy={busy}
          past={flow.past}
          last={flow.steps === 1}
          reflection={reflection}
          onReflection={setReflection}
          onTrim={trim}
          onKeep={keep}
          onRemoveJot={(id) => void removeJot(id)}
          onNext={() => (flow.steps === 1 ? void commit() : setPanel(1))}
        />
      )}
      {review && flow && panel === 1 && (
        <Unfinished
          review={review}
          past={flow.past}
          tomorrow={flow.past ? null : snapshot.tomorrow_plan}
          decisions={decisions}
          busy={busy}
          onDecide={(id, d) => setDecisions({ ...decisions, [id]: d })}
          onBack={() => setPanel(0)}
          onNext={commit}
        />
      )}
    </div>
  );
}

function WhatHappened({
  review,
  kept,
  busy,
  past,
  last,
  reflection,
  onReflection,
  onTrim,
  onKeep,
  onRemoveJot,
  onNext,
}: {
  review: ReviewView;
  kept: string[];
  busy: boolean;
  /** The day has ended; it is not today. */
  past: boolean;
  /** This is the only screen, so its button saves the review. */
  last: boolean;
  reflection: string;
  onReflection: (v: string) => void;
  onTrim: (flag: IdleFlag) => void;
  onKeep: (sessionId: string) => void;
  onRemoveJot: (id: string) => void;
  onNext: () => void;
}) {
  const plan = review.plan;
  const topN = Math.min(3, plan.task_count);
  const topDone = plan.tasks.filter((t) => t.position <= 3 && t.status === "done").length;
  const top = review.top_three_done ? `top ${topN} complete` : `${topDone} of the top ${topN}`;
  const also = [
    `${duration(plan.total_focus_seconds)} focused`,
    plan.pomodoros_completed > 0 ? `${plan.pomodoros_completed} ${plan.pomodoros_completed === 1 ? "pomodoro" : "pomodoros"}` : "",
    review.overrides > 0 ? `${review.overrides} ${review.overrides === 1 ? "override" : "overrides"}` : "",
  ].filter(Boolean);
  const flags = review.idle_flags.filter((f) => !kept.includes(f.session_id));
  const titleOf = (id: string) => plan.tasks.find((t) => t.id === id)?.title ?? "a task";
  const thought = past ? "One thought about that day" : "One thought about today";

  return (
    <section>
      <h2 className="mt-6 font-serif text-[20px] leading-7 font-normal text-stone-900">What happened</h2>
      <p className="mt-2 font-serif text-[15px] leading-6 tabular-nums text-stone-900">
        {plan.done_count} of {plan.task_count} done · {top}
      </p>
      <p className="font-serif text-[12px] leading-5 tabular-nums text-stone-500">{also.join(" · ")}</p>

      {/* The one thing here that asks for a decision comes before the record. */}
      {flags.map((f) => (
        <div key={f.session_id} className="mt-5 border-t border-b border-t-rule border-b-stone-200 py-4">
          <p className="text-[15px] leading-6 text-stone-900">
            Six sat idle {idleSpan(f.gap_start, f.gap_end)}.
          </p>
          <p className="mt-1 text-[13px] leading-5 text-stone-500">
            {titleOf(f.task_id)}: {duration(f.seconds)} recorded. Trimming keeps {duration(f.suggested_seconds)}.
          </p>
          <GapPreview flag={f} />
          <div className="mt-4 flex items-center gap-5">
            <Button size="sm" className="px-3" disabled={busy} onClick={() => onTrim(f)}>
              Trim to {duration(f.suggested_seconds)}
            </Button>
            <Button variant="link" onClick={() => onKeep(f.session_id)}>
              Keep as recorded
            </Button>
          </div>
        </div>
      ))}

      <ol className="mt-5">
        {plan.tasks.map((t) => (
          <li key={t.id} className="-ml-10 grid min-h-8 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-baseline">
            <Numeral n={t.position} size="xs" tone={t.status === "done" ? "muted" : "dim"} className="pr-3 text-right leading-8" />
            <span className={`min-w-0 py-1 text-[15px] leading-6 [overflow-wrap:anywhere] ${t.status === "done" ? "text-stone-900" : "text-stone-500"}`}>{t.title}</span>
            <span className="whitespace-nowrap pl-4 text-right font-serif text-[12px] leading-7 tabular-nums text-stone-500">
              {[STATUS_WORD[t.status], t.focus_seconds >= 60 ? duration(t.focus_seconds) : ""].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ol>

      {review.jots.length > 0 && (
        <>
          <Label className="mt-8">Parked thoughts</Label>
          <ul className="mt-1 divide-y divide-stone-200 border-b border-stone-200">
            {review.jots.map((j) => (
              <li key={j.id} className="flex items-baseline justify-between gap-4 py-2">
                <span className="min-w-0 text-[15px] leading-6 text-stone-900">{j.text}</span>
                <span className="flex shrink-0 items-baseline gap-4">
                  <span className="font-serif text-[12px] tabular-nums text-stone-500">
                    {clockTime(j.created_at)}
                    {j.position ? ` · task ${j.position}` : ""}
                  </span>
                  <button type="button" className="text-[12px] text-stone-500 hover:text-stone-900" disabled={busy} aria-label={`Remove the parked thought: ${j.text}`} onClick={() => onRemoveJot(j.id)}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 font-serif text-[12px] leading-5 text-stone-500">They stay with this day. A list is written by hand.</p>
        </>
      )}

      <input
        value={reflection}
        aria-label={thought}
        onChange={(e) => onReflection(e.target.value)}
        placeholder={`${thought} (optional)`}
        maxLength={200}
        className="mt-8 w-full rounded-control border border-stone-200 bg-white px-3 py-2 text-[15px] text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none"
      />

      <div className="mt-8 flex justify-end">
        <Button className="px-5" disabled={last && busy} onClick={onNext}>
          {last ? "Save review" : "Next"}
        </Button>
      </div>
    </section>
  );
}

function Unfinished({
  review,
  past,
  tomorrow,
  decisions,
  busy,
  onDecide,
  onBack,
  onNext,
}: {
  review: ReviewView;
  /** A day that has ended: what carries goes to the next list, whenever it is planned. */
  past: boolean;
  tomorrow: PlanView | null;
  decisions: Record<string, Decision>;
  busy: boolean;
  onDecide: (id: string, d: Decision) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const tasks = review.plan.tasks.filter((t) => review.unfinished.includes(t.id));
  // Tomorrow may already be set. Then a carried task can only take an empty row, and a
  // task that already has its copy there is carried whatever is chosen here.
  const locked = !!tomorrow?.locked_at;
  const onTomorrow = new Set((tomorrow?.tasks ?? []).map((t) => t.carried_from).filter(Boolean));
  const free = locked && tomorrow ? Math.max(0, 6 - tomorrow.task_count) : 6;
  // With tomorrow full, carrying only records the task as carried: say so on the choice.
  const full = locked && free === 0;
  const intro =
    tasks.length === 0
      ? "Everything on the list is finished."
      : past
        ? "Carry each to the next list you plan, or drop it."
        : !locked
          ? "Carry each to tomorrow, or drop it."
          : free > 0
            ? `Tomorrow is set, with ${free} free ${free === 1 ? "row" : "rows"} for what carries.`
            : "Tomorrow's six are full. Each is kept as carried, or dropped.";
  return (
    <section>
      <h2 className="mt-6 font-serif text-[20px] leading-7 font-normal text-stone-900">Unfinished tasks</h2>
      <p className="mt-1 text-[13px] leading-5 text-stone-500">{intro}</p>
      <ol className="mt-4 divide-y divide-stone-200">
        {tasks.map((t) => {
          const d = decisions[t.id] ?? "carry";
          const already = onTomorrow.has(t.id);
          return (
            <li key={t.id} className="py-3">
              <div className="-ml-10 grid grid-cols-[2.5rem_minmax(0,1fr)] items-baseline">
                <Numeral n={t.position} size="xs" tone="muted" className="pr-3 text-right leading-6" />
                <span className="min-w-0 text-[15px] leading-6 text-stone-900 [overflow-wrap:anywhere]">{t.title}</span>
              </div>
              {already ? (
                <p className="mt-1 font-serif text-[12px] leading-5 text-stone-500">Already on tomorrow's list.</p>
              ) : (
                <div className="mt-2 inline-flex rounded-control border border-stone-300" role="group" aria-label={`What happens to task ${t.position}`}>
                  <Toggle selected={d === "carry"} onClick={() => onDecide(t.id, "carry")}>
                    {full ? "Carried" : past ? "Carry forward" : "Carry to tomorrow"}
                  </Toggle>
                  <Toggle selected={d === "drop"} onClick={() => onDecide(t.id, "drop")}>
                    {full ? "Dropped" : "Drop"}
                  </Toggle>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <Rule className="mt-6" />
      <div className="mt-6 flex items-center justify-end gap-5">
        <Button variant="link" onClick={onBack}>
          Back
        </Button>
        <Button className="px-5" disabled={busy} onClick={onNext}>
          {past ? "Save review" : <>Save review &amp; plan tomorrow</>}
        </Button>
      </div>
      {!past && <p className="mt-2 text-right font-serif text-[12px] leading-5 text-stone-500">Saved before the planner opens.</p>}
    </section>
  );
}

/**
 * The exact consequence of a trim: what stays, what goes, what stays. Proportions are
 * Rust's timestamps; the gap is a lack of interaction with Six, not proof of absence.
 */
function GapPreview({ flag }: { flag: IdleFlag }) {
  const s = Date.parse(flag.started_at);
  const gs = Date.parse(flag.gap_start);
  const ge = Date.parse(flag.gap_end);
  const e = Date.parse(flag.ended_at);
  const before = Math.max(0, (gs - s) / 1000);
  const gap = Math.max(0, (ge - gs) / 1000);
  const after = Math.max(0, (e - ge) / 1000);
  const total = before + gap + after || 1;
  const width = (n: number) => `${n > 0 ? Math.max(3, (n / total) * 100) : 0}%`;
  return (
    <div className="mt-3" aria-hidden>
      <div className="flex h-1 w-full overflow-hidden bg-stone-200">
        {before > 0 && <div className="h-full bg-stone-900" style={{ width: width(before) }} />}
        <div className="h-full bg-stone-300" style={{ width: width(gap) }} />
        {after > 0 && <div className="h-full bg-stone-900" style={{ width: width(after) }} />}
      </div>
      <div className="mt-1 flex justify-between gap-2 font-serif text-[12px] text-stone-500">
        <span>{before > 0 ? `kept ${duration(before)}` : ""}</span>
        <span>gap {duration(gap)}</span>
        <span>{after > 0 ? `kept ${duration(after)}` : ""}</span>
      </div>
    </div>
  );
}

function Toggle({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`inline-flex h-7 items-center px-3 text-[13px] transition-colors duration-150 first:rounded-l-[3px] last:rounded-r-[3px] not-first:border-l not-first:border-stone-300 ${
        selected ? "bg-stone-200 text-stone-900" : "text-stone-500 hover:text-stone-900"
      }`}
    >
      {children}
    </button>
  );
}
