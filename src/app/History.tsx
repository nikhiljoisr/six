import { useEffect, useState } from "react";
import { Label, Numeral } from "../components/ui";
import { api } from "../lib/api";
import { duration, longDate } from "../lib/format";
import type { DaySnapshot, PlanView } from "../lib/types";
import { useStore } from "../store";

// The last 30 days, newest first. Facts only.

export function History({ snapshot }: { snapshot: DaySnapshot }) {
  const navigate = useStore((s) => s.navigate);
  const [days, setDays] = useState<PlanView[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const from = shiftDays(snapshot.today, -29);
    api
      .getRange(from, snapshot.today)
      .then(setDays)
      .catch(() => setDays([]));
  }, [snapshot.today]);

  return (
    <div className="pb-16">
      <header className="relative flex items-center justify-center py-1">
        <button
          type="button"
          className="absolute left-0 text-sm text-stone-500 hover:text-stone-900"
          onClick={() => navigate({ name: "day" })}
        >
          Day
        </button>
        <Label>History</Label>
      </header>
      <h1 className="mt-8 font-serif text-3xl font-normal text-stone-900">Last 30 days</h1>

      {days === null && <p className="mt-8 text-sm text-stone-400">Loading…</p>}
      {days && days.length === 0 && <p className="mt-8 text-sm text-stone-500">No lists yet.</p>}

      <ol className="mt-8 space-y-6">
        {days?.filter((d) => d.locked_at).map((day) => {
          const complete = day.task_count > 0 && day.done_count === day.task_count;
          return (
            <li key={day.id}>
              <button type="button" className="w-full text-left" onClick={() => setOpen(open === day.id ? null : day.id)}>
                <div className="flex items-baseline justify-between">
                  <h2 className="font-serif text-xl font-normal text-stone-900">{longDate(day.date)}</h2>
                  <span className="text-sm tabular-nums text-stone-500">
                    {day.done_count}/{day.task_count} completed
                  </span>
                </div>
                <div className="mt-1">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${complete ? "border-amber-700/30 text-amber-700" : "border-stone-200 text-stone-500"}`}
                  >
                    {complete ? "Complete" : "Partial"}
                  </span>
                </div>
              </button>
              <ol className="mt-3 space-y-1">
                {day.tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 text-[15px]">
                    <Numeral n={t.position} size="sm" tone={t.status === "done" ? "dim" : "muted"} className="w-4 text-center" />
                    <span
                      className={`min-w-0 flex-1 truncate ${t.status === "done" ? "text-stone-400 line-through decoration-stone-300" : "text-stone-500"}`}
                    >
                      {t.title}
                    </span>
                    <span className="text-xs tabular-nums text-stone-400">{t.focus_seconds > 0 ? duration(t.focus_seconds) : ""}</span>
                  </li>
                ))}
              </ol>
              {open === day.id && day.reflection && (
                <p className="mt-3 rounded-card border border-stone-200 bg-white px-4 py-3 text-sm text-stone-500">{day.reflection}</p>
              )}
              {open === day.id && !day.reflection && <p className="mt-3 text-xs text-stone-400">No reflection recorded.</p>}
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
