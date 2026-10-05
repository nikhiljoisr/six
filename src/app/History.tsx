import { useEffect, useState } from "react";
import { Numeral, Rule } from "../components/ui";
import { api } from "../lib/api";
import { clockTime, duration, longDate } from "../lib/format";
import type { DaySnapshot, PlanView, TaskStatus } from "../lib/types";
import { useStore } from "../store";

// The last 30 days, newest first. Facts only.

const STATUS_WORD: Record<TaskStatus, string> = {
  done: "done",
  active: "in progress",
  paused: "paused",
  planned: "not started",
  deferred: "carried",
  skipped: "dropped",
};

export function History({ snapshot }: { snapshot: DaySnapshot }) {
  const navigate = useStore((s) => s.navigate);
  const [days, setDays] = useState<PlanView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = () => {
    setFailed(false);
    const from = shiftDays(snapshot.today, -29);
    api
      .getRange(from, snapshot.today)
      .then(setDays)
      .catch(() => {
        setDays([]);
        setFailed(true);
      });
  };
  useEffect(load, [snapshot.today]);

  return (
    <div className="pb-16 pl-8 pr-0 pt-2">
      <header className="flex h-5 items-baseline justify-between gap-6 leading-5">
        <h1 className="font-serif text-[15px] font-normal text-stone-900">Last 30 days</h1>
        <nav className="flex shrink-0 items-baseline gap-4 whitespace-nowrap font-sans text-[12px] text-stone-500">
          <button type="button" className="hover:text-stone-900" onClick={() => navigate({ name: "day" })}>
            Day
          </button>
          <button type="button" className="hover:text-stone-900" onClick={() => navigate({ name: "stats" })}>
            Stats
          </button>
          <button type="button" className="hover:text-stone-900" onClick={() => navigate({ name: "settings" })}>
            Settings
          </button>
        </nav>
      </header>
      <Rule className="mt-3" />

      {days === null && <p className="mt-8 font-serif text-[12px] text-stone-400">Loading…</p>}
      {failed && (
        <button type="button" className="mt-8 text-[13px] text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-900" onClick={load}>
          The last 30 days could not be loaded. Try again
        </button>
      )}
      {days && days.length === 0 && !failed && <p className="mt-8 text-[13px] text-stone-500">No lists yet.</p>}

      <ol className="mt-2 divide-y divide-stone-200">
        {days?.filter((d) => d.locked_at).map((day) => {
          const complete = day.task_count > 0 && day.done_count === day.task_count;
          return (
            <li key={day.id} className="py-4">
              <button
                type="button"
                className="flex w-full items-baseline justify-between gap-4 text-left"
                aria-expanded={open === day.id}
                onClick={() => setOpen(open === day.id ? null : day.id)}
              >
                <h2 className="font-serif text-[15px] font-normal text-stone-900">{longDate(day.date)}</h2>
                <span className="shrink-0 font-serif text-[12px] tabular-nums text-stone-500">
                  {day.done_count} of {day.task_count} done{complete && <span className="text-amber-700"> · Complete</span>}
                </span>
              </button>
              <ol className="mt-2">
                {day.tasks.map((t) => (
                  <li key={t.id} className="-ml-10 grid min-h-7 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-baseline">
                    <Numeral n={t.position} size="xxs" tone={t.status === "done" ? "muted" : "dim"} className="pr-3 text-right leading-7" />
                    <span className={`min-w-0 py-1 text-[14px] leading-5 [overflow-wrap:anywhere] ${t.status === "done" ? "text-stone-600" : "text-stone-500"}`}>{t.title}</span>
                    <span className="whitespace-nowrap pl-4 text-right font-serif text-[12px] leading-6 tabular-nums text-stone-500">
                      {[t.status === "done" ? "" : STATUS_WORD[t.status], t.focus_seconds >= 60 ? duration(t.focus_seconds) : ""].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ol>
              {open === day.id && day.jots.length > 0 && (
                <ul className="mt-2" aria-label="Parked thoughts">
                  {day.jots.map((j) => (
                    <li key={j.id} className="flex items-baseline justify-between gap-4 text-[13px] leading-6 text-stone-500">
                      <span className="min-w-0">{j.text}</span>
                      <span className="shrink-0 font-serif text-[12px] tabular-nums">parked {clockTime(j.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {open === day.id && day.reflection && <p className="mt-2 text-[13px] leading-5 text-stone-500">{day.reflection}</p>}
              {open === day.id && !day.reflection && (day.reviewed_at || day.is_today) && (
                <p className="mt-2 font-serif text-[12px] leading-5 text-stone-400">No reflection recorded.</p>
              )}
              {open === day.id && !day.reviewed_at && !day.is_today && (
                <p className="mt-2 font-serif text-[12px] leading-5 text-stone-500">
                  Not reviewed.{" "}
                  <button type="button" className="text-stone-900 hover:text-stone-500" onClick={() => navigate({ name: "review", planId: day.id })}>
                    Review this day
                  </button>
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function shiftDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
