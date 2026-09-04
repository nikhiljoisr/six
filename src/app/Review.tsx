import { useEffect, useRef, useState } from "react";
import { Button, Label, Numeral } from "../components/ui";
import { api } from "../lib/api";
import { clockTime, duration } from "../lib/format";
import type { DaySnapshot, Decision, IdleFlag, ReviewView, TaskStatus } from "../lib/types";
import { useStore } from "../store";
import { Planner } from "./Planner";

// The evening review: three panels. 1) what happened, in plain facts, with any likely-idle
// sessions to trim and an optional one-line thought; 2) carry or drop each unfinished
// task; 3) tomorrow's six, pre-filled with what carries. Leaving panel 2 records the
// review; panel 3 is the planner itself.

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
    if (!err) await load();
    setBusy(false);
  };

  const commit = async () => {
    if (!review) return;
    setBusy(true);
    const list = review.unfinished.map((task_id) => ({ task_id, decision: decisions[task_id] ?? "carry" }));
    const err = await dispatch(() => api.completeReview(planId, reflection.trim() || null, list));
    setBusy(false);
    if (!err) setPanel(2);
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
    <div className="pb-16" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <header className="relative flex items-center justify-center py-1">
        <button
          type="button"
          className="absolute left-0 text-sm text-stone-500 hover:text-stone-900"
          onClick={() => navigate({ name: "day" })}
        >
          Cancel
        </button>
        <Label>Evening review</Label>
      </header>
      <div className="mt-6 flex gap-1.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-1 w-4 rounded-full ${i <= panel ? "bg-stone-900" : "bg-stone-200"}`} />
        ))}
      </div>

      {problem && <p className="mt-8 text-sm text-stone-500">{problem}</p>}
      {!review && !problem && <p className="mt-8 text-sm text-stone-400">Loading…</p>}

      {review && panel === 0 && (
        <WhatHappened
          review={review}
          kept={kept}
          busy={busy}
          reflection={reflection}
          onReflection={setReflection}
          onTrim={trim}
          onKeep={(id) => setKept([...kept, id])}
          onNext={() => setPanel(1)}
        />
      )}
      {review && panel === 1 && (
        <Unfinished
          review={review}
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
  reflection,
  onReflection,
  onTrim,
  onKeep,
  onNext,
}: {
  review: ReviewView;
  kept: string[];
  busy: boolean;
  reflection: string;
  onReflection: (v: string) => void;
  onTrim: (flag: IdleFlag) => void;
  onKeep: (sessionId: string) => void;
  onNext: () => void;
}) {
  const plan = review.plan;
  const topN = Math.min(3, plan.task_count);
  const topDone = plan.tasks.filter((t) => t.position <= 3 && t.status === "done").length;
  const top = review.top_three_done ? `Top ${topN} complete.` : `${topDone} of the top ${topN} done.`;
  const overrides =
    review.overrides > 0 ? ` ${review.overrides} ${review.overrides === 1 ? "override" : "overrides"}.` : "";
  const flags = review.idle_flags.filter((f) => !kept.includes(f.session_id));
  const titleOf = (id: string) => plan.tasks.find((t) => t.id === id)?.title ?? "a task";

  return (
    <section>
      <h1 className="mt-6 font-serif text-3xl font-normal text-stone-900">What happened</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-stone-900">
        {plan.done_count} of {plan.task_count} done. {top} {duration(plan.total_focus_seconds)} focused.{overrides}
        {plan.pomodoros_completed > 0 && ` ${plan.pomodoros_completed} ${plan.pomodoros_completed === 1 ? "pomodoro" : "pomodoros"}.`}
      </p>

      <ol className="mt-6 space-y-2">
        {plan.tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-3 text-[15px]">
            <Numeral n={t.position} size="sm" tone={t.status === "done" ? "dim" : "muted"} className="w-4 text-center" />
            <span className={`min-w-0 flex-1 truncate ${t.status === "done" ? "text-stone-400 line-through decoration-stone-300" : "text-stone-900"}`}>
              {t.title}
            </span>
            <span className="text-[11px] text-stone-400">{STATUS_WORD[t.status]}</span>
            <span className="w-12 text-right text-xs tabular-nums text-stone-400">{t.focus_seconds > 0 ? duration(t.focus_seconds) : ""}</span>
          </li>
        ))}
      </ol>

      {flags.map((f) => (
        <div key={f.session_id} className="mt-6 rounded-card border border-stone-200 bg-white px-4 py-3">
          <Label>Likely idle</Label>
          <p className="mt-2 text-sm text-stone-900">
            {titleOf(f.task_id)}: {duration(f.seconds)} recorded, nothing touched for {duration(f.gap_seconds)} ({clockTime(f.gap_start)} to {clockTime(f.gap_end)}).
          </p>
          <p className="mt-1 text-sm text-stone-500">Take that stretch out and keep {duration(f.suggested_seconds)}?</p>
          <div className="mt-3 flex items-center gap-4">
            <Button variant="secondary" className="px-4 py-2 text-sm" disabled={busy} onClick={() => onTrim(f)}>
              Trim
            </Button>
            <Button variant="link" onClick={() => onKeep(f.session_id)}>
              Keep as recorded
            </Button>
          </div>
        </div>
      ))}

      <Label className="mt-8">One thought about today</Label>
      <input
        value={reflection}
        onChange={(e) => onReflection(e.target.value)}
        placeholder="Optional"
        maxLength={200}
        className="mt-2 w-full rounded-control border border-stone-200 bg-white px-3 py-2.5 text-[15px] text-stone-900 placeholder:text-stone-300 focus:border-stone-400 focus:outline-none"
      />

      <Button full className="mt-8" onClick={onNext}>
        Next
      </Button>
    </section>
  );
}

function Unfinished({
  review,
  decisions,
  busy,
  onDecide,
  onBack,
  onNext,
}: {
  review: ReviewView;
  decisions: Record<string, Decision>;
  busy: boolean;
  onDecide: (id: string, d: Decision) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const tasks = review.plan.tasks.filter((t) => review.unfinished.includes(t.id));
  return (
    <section>
      <h1 className="mt-6 font-serif text-3xl font-normal text-stone-900">Unfinished tasks</h1>
      <p className="mt-3 text-[15px] text-stone-500">
        {tasks.length > 0 ? "Carry them to tomorrow, or drop them for good." : "Everything on the list is finished."}
      </p>
      <ol className="mt-6 space-y-2">
        {tasks.map((t) => {
          const d = decisions[t.id] ?? "carry";
          return (
            <li key={t.id} className="rounded-card border border-stone-200 bg-white px-4 py-3">
              <div className="flex items-center gap-3">
                <Numeral n={t.position} size="sm" tone="muted" className="w-4 text-center" />
                <span className="min-w-0 flex-1 truncate text-[15px] text-stone-900">{t.title}</span>
              </div>
              <div className="mt-3 ml-7 flex gap-2">
                <Toggle selected={d === "carry"} onClick={() => onDecide(t.id, "carry")}>
                  Carry to tomorrow
                </Toggle>
                <Toggle selected={d === "drop"} onClick={() => onDecide(t.id, "drop")}>
                  Drop
                </Toggle>
              </div>
            </li>
          );
        })}
      </ol>
      <Button full className="mt-8" disabled={busy} onClick={onNext}>
        Next
      </Button>
      <div className="mt-3 text-center">
        <Button variant="link" onClick={onBack}>
          Back
        </Button>
      </div>
    </section>
  );
}

function Toggle({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-control px-3 py-2 text-sm transition-opacity duration-150 ${
        selected ? "bg-stone-900 font-medium text-stone-50" : "border border-stone-300 text-stone-500 hover:text-stone-900"
      }`}
    >
      {children}
    </button>
  );
}
