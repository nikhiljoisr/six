import { useEffect, useState } from "react";
import { Button, Label } from "../components/ui";
import { api } from "../lib/api";
import { duration, shiftDays, shortDate, weekOf } from "../lib/format";
import type { DaySnapshot, Stats as StatsView } from "../lib/types";
import { useStore } from "../store";

// Facts only (SPEC §4.8): this week, a 7-day trend without axes, the most carried task,
// and an export to plain text and JSON.

export function Stats({ snapshot }: { snapshot: DaySnapshot }) {
  const navigate = useStore((s) => s.navigate);
  const week = weekOf(snapshot.today);
  const [stats, setStats] = useState<StatsView | null>(null);
  const [trend, setTrend] = useState<StatsView | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getStats(week.from, week.to), api.getStats(shiftDays(snapshot.today, -6), snapshot.today)])
      .then(([w, t]) => {
        if (cancelled) return;
        setStats(w);
        setTrend(t);
      })
      .catch((e) => !cancelled && setProblem(e?.message ?? "Could not load stats."));
    return () => {
      cancelled = true;
    };
  }, [snapshot.today, week.from, week.to]);

  const doExport = async () => {
    try {
      const r = await api.exportRange(week.from, week.to, "both");
      setExported(`Saved to ${r.dir.replace(/^\/Users\/[^/]+/, "~")}`);
    } catch (e) {
      setProblem((e as { message?: string })?.message ?? "Export failed.");
    }
  };

  const pct = (done: number, total: number) => (total === 0 ? "–" : `${Math.round((done * 100) / total)}%`);

  return (
    <div className="pb-16">
      <header className="relative flex items-center justify-center py-1">
        <button type="button" className="absolute left-0 text-sm text-stone-500 hover:text-stone-900" onClick={() => navigate({ name: "history" })}>
          History
        </button>
        <Label>Stats</Label>
      </header>
      <h1 className="mt-8 font-serif text-3xl font-normal text-stone-900">This week</h1>
      <p className="mt-1 text-sm text-stone-500">
        {shortDate(week.from)} to {shortDate(week.to)}
      </p>

      {problem && <p className="mt-8 text-sm text-stone-500">{problem}</p>}
      {!stats && !problem && <p className="mt-8 text-sm text-stone-400">Loading…</p>}

      {stats && (
        <>
          <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5">
            <Fact label="Days planned" value={`${stats.days_planned}/${stats.days_in_range}`} />
            <Fact label="Tasks done" value={`${stats.tasks_done} of ${stats.tasks_total}`} />
            <Fact label="Top 3 done" value={pct(stats.top3_done, stats.top3_total)} sub={`${stats.top3_done} of ${stats.top3_total}`} />
            <Fact label="Tasks 4–6 done" value={pct(stats.rest_done, stats.rest_total)} sub={`${stats.rest_done} of ${stats.rest_total}`} />
            <Fact label="Focus" value={duration(stats.focus_seconds)} />
            <Fact label="Pomodoros" value={String(stats.pomodoros)} />
            <Fact label="Overrides" value={String(stats.overrides)} />
          </dl>

          {trend && (
            <section className="mt-10">
              <Label>Last 7 days</Label>
              <div className="mt-3 grid grid-cols-2 gap-6">
                <Spark label="Tasks done" values={trend.trend.map((d) => d.tasks_done)} format={(v) => String(v)} />
                <Spark label="Focus hours" values={trend.trend.map((d) => d.focus_seconds / 3600)} format={(v) => v.toFixed(1)} />
              </div>
              <p className="mt-2 text-[11px] text-stone-400">
                {shortDate(trend.from)} to {shortDate(trend.to)}
              </p>
            </section>
          )}

          <section className="mt-10">
            <Label>Most carried over</Label>
            {stats.most_carried ? (
              <p className="mt-2 text-[15px] text-stone-900">
                {stats.most_carried.title}
                <span className="text-stone-500">
                  {" "}
                  rolled {stats.most_carried.days} {stats.most_carried.days === 1 ? "day" : "days"}. Usually a task that needs breaking down.
                </span>
              </p>
            ) : (
              <p className="mt-2 text-sm text-stone-500">Nothing has rolled over yet.</p>
            )}
          </section>

          <section className="mt-10">
            <Button variant="secondary" onClick={() => void doExport()}>
              Export this week
            </Button>
            <p className="mt-2 text-xs text-stone-500">{exported ?? "Plain text and JSON, to ~/Six/exports."}</p>
          </section>
        </>
      )}
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="mt-1 font-serif text-2xl text-stone-900">{value}</dd>
      {sub && <dd className="text-xs text-stone-400">{sub}</dd>}
    </div>
  );
}

/** A charcoal sparkline, no axes. */
function Spark({ label, values, format }: { label: string; values: number[]; format: (v: number) => string }) {
  const w = 160;
  const h = 40;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`).join(" ");
  const last = values[values.length - 1] ?? 0;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-stone-500">{label}</span>
        <span className="text-sm tabular-nums text-stone-900">{format(last)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 h-10 w-full" aria-label={`${label}: ${values.map(format).join(", ")}`}>
        <polyline points={points} fill="none" stroke="#1c1917" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {values.map((v, i) => (
          <circle key={i} cx={(i * step).toFixed(1)} cy={(h - (v / max) * (h - 4) - 2).toFixed(1)} r="1.6" fill="#1c1917" />
        ))}
      </svg>
    </div>
  );
}
