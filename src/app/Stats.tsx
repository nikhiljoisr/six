import { useEffect, useState } from "react";
import { Button, Label, Numeral, Rule } from "../components/ui";
import { api } from "../lib/api";
import { duration, shiftDays, shortDate, tildePath, weekOf } from "../lib/format";
import type { DaySnapshot, Stats as StatsView } from "../lib/types";
import { useStore } from "../store";

// Facts only (SPEC §4.8): this week, a 7-day trend without axes, how each position on the
// list has fared over the last 30 days, the most carried task, and an export to plain
// text and JSON.

export function Stats({ snapshot }: { snapshot: DaySnapshot }) {
  const navigate = useStore((s) => s.navigate);
  const week = weekOf(snapshot.today);
  const [stats, setStats] = useState<StatsView | null>(null);
  const [trend, setTrend] = useState<StatsView | null>(null);
  const [month, setMonth] = useState<StatsView | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getStats(week.from, week.to),
      api.getStats(shiftDays(snapshot.today, -6), snapshot.today),
      api.getStats(shiftDays(snapshot.today, -29), snapshot.today),
    ])
      .then(([w, t, m]) => {
        if (cancelled) return;
        setStats(w);
        setTrend(t);
        setMonth(m);
      })
      .catch((e) => !cancelled && setProblem(e?.message ?? "Could not load stats."));
    return () => {
      cancelled = true;
    };
  }, [snapshot.today, week.from, week.to]);

  const doExport = async () => {
    try {
      const r = await api.exportRange(week.from, week.to, "both");
      setExported(`Saved to ${tildePath(r.dir)}`);
    } catch (e) {
      setProblem((e as { message?: string })?.message ?? "Export failed.");
    }
  };

  const pct = (done: number, total: number) => (total === 0 ? "–" : `${Math.round((done * 100) / total)}%`);

  return (
    <div className="pb-16 pl-8 pr-0 pt-2">
      <header className="flex h-5 items-baseline justify-between gap-6 leading-5">
        <h1 className="font-serif text-[15px] font-normal text-stone-900">This week</h1>
        <nav className="flex shrink-0 items-baseline gap-4 whitespace-nowrap font-sans text-[12px] text-stone-500">
          <button type="button" className="hover:text-stone-900" onClick={() => navigate({ name: "history" })}>
            History
          </button>
        </nav>
      </header>
      <Rule className="mt-3" />
      <p className="mt-3 font-serif text-[12px] leading-5 text-stone-500">
        {shortDate(week.from)} to {shortDate(week.to)}
      </p>

      {problem && <p className="mt-8 text-[13px] text-stone-500">{problem}</p>}
      {!stats && !problem && <p className="mt-8 font-serif text-[12px] text-stone-400">Loading…</p>}

      {stats && (
        <>
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5">
            <Fact label="Days planned" value={`${stats.days_planned}/${stats.days_in_range}`} />
            <Fact label="Tasks done" value={`${stats.tasks_done} of ${stats.tasks_total}`} />
            <Fact label="Top 3 done" value={pct(stats.top3_done, stats.top3_total)} sub={`${stats.top3_done} of ${stats.top3_total}`} />
            <Fact label="Tasks 4–6 done" value={pct(stats.rest_done, stats.rest_total)} sub={`${stats.rest_done} of ${stats.rest_total}`} />
            <Fact label="Focus" value={duration(stats.focus_seconds)} />
            <Fact label="Pomodoros" value={String(stats.pomodoros)} sub={stats.pomodoros_interrupted > 0 ? `${stats.pomodoros_interrupted} interrupted` : undefined} />
            <Fact label="Overrides" value={String(stats.overrides)} />
            <Fact label="Days reviewed" value={`${stats.days_reviewed} of ${stats.days_planned}`} />
          </dl>

          {trend && (
            <section className="mt-8 border-t border-stone-200 pt-5">
              <Label>Last 7 days</Label>
              <div className="mt-3 grid grid-cols-2 gap-6">
                <Spark label="Tasks done" values={trend.trend.map((d) => d.tasks_done)} format={(v) => String(v)} />
                <Spark label="Focus hours" values={trend.trend.map((d) => d.focus_seconds / 3600)} format={(v) => v.toFixed(1)} />
              </div>
              <p className="mt-2 font-serif text-[12px] text-stone-400">
                {shortDate(trend.from)} to {shortDate(trend.to)}
              </p>
            </section>
          )}

          {month && month.tasks_total > 0 && (
            <section className="mt-6 border-t border-stone-200 pt-5">
              <Label>Done by position</Label>
              <ol className="mt-2">
                {month.by_position
                  .filter((p) => p.total > 0)
                  .map((p) => (
                    <li key={p.position} className="-ml-10 grid h-7 grid-cols-[2.5rem_minmax(0,1fr)_5rem] items-center" aria-label={`Task ${p.position}: done ${p.done} of ${p.total} times`}>
                      <Numeral n={p.position} size="xxs" tone="muted" className="pr-3 text-right" />
                      <div className="h-1 bg-stone-200" aria-hidden>
                        <div className="h-full bg-stone-900" style={{ width: `${(p.done * 100) / p.total}%` }} />
                      </div>
                      <span className="text-right font-serif text-[12px] tabular-nums text-stone-500" aria-hidden>
                        {p.done} of {p.total}
                      </span>
                    </li>
                  ))}
              </ol>
              <p className="mt-2 font-serif text-[12px] text-stone-400">
                Last 30 days, {shortDate(month.from)} to {shortDate(month.to)}
              </p>
            </section>
          )}

          <section className="mt-6 border-t border-stone-200 pt-5">
            <Label>Most carried over</Label>
            {stats.most_carried ? (
              <p className="mt-2 text-[15px] leading-6 text-stone-900">
                {stats.most_carried.title}
                <span className="text-stone-500">
                  {" "}
                  rolled {stats.most_carried.days} {stats.most_carried.days === 1 ? "day" : "days"}. Usually a task that needs breaking down.
                </span>
              </p>
            ) : (
              <p className="mt-2 text-[13px] text-stone-500">Nothing has rolled over yet.</p>
            )}
          </section>

          <section className="mt-6 border-t border-stone-200 pt-5">
            <Button size="sm" className="px-3" onClick={() => void doExport()}>
              Export this week
            </Button>
            <p className="mt-2 font-serif text-[12px] leading-5 text-stone-500">{exported ?? "Plain text and JSON, to ~/Six/exports."}</p>
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
      <dd className="clock mt-1 text-[22px] leading-7 text-stone-900">{value}</dd>
      {sub && <dd className="font-serif text-[12px] text-stone-500">{sub}</dd>}
    </div>
  );
}

/** An ink sparkline, no axes. */
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
        <span className="text-[13px] text-stone-500">{label}</span>
        <span className="clock text-[13px] text-stone-900">{format(last)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 h-10 w-full text-stone-900" aria-label={`${label}: ${values.map(format).join(", ")}`}>
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {values.map((v, i) => (
          <circle key={i} cx={(i * step).toFixed(1)} cy={(h - (v / max) * (h - 4) - 2).toFixed(1)} r="1.6" fill="currentColor" />
        ))}
      </svg>
    </div>
  );
}
