import { useEffect, useState } from "react";
import { Button, Label, Numeral, Rule } from "../components/ui";
import { api } from "../lib/api";
import { duration, shiftDays, shortDate, tildePath, weekOf, weekday } from "../lib/format";
import type { DaySnapshot, PlanView, Stats as StatsView } from "../lib/types";
import { useStore } from "../store";

// Facts only (SPEC §4.8), led by the one Ivy Lee cares about: how often the top three got
// done this week. Then two lines of supporting facts (a fact that is zero is left out), the
// week as dots, how each position on the list has fared over the last 30 days, the most
// carried task, and an export to plain text and JSON. Counts are always "n of m".

export function Stats({ snapshot }: { snapshot: DaySnapshot }) {
  const navigate = useStore((s) => s.navigate);
  const week = weekOf(snapshot.today);
  const [stats, setStats] = useState<StatsView | null>(null);
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [month, setMonth] = useState<StatsView | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getStats(week.from, week.to),
      api.getRange(week.from, week.to),
      api.getStats(shiftDays(snapshot.today, -29), snapshot.today),
    ])
      .then(([w, p, m]) => {
        if (cancelled) return;
        setStats(w);
        setPlans(p);
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

  return (
    <div className="pb-16 pl-8 pr-0 pt-2">
      <header className="flex h-5 items-baseline justify-between gap-6 leading-5">
        <h1 className="font-serif text-[15px] font-normal text-stone-900">This week</h1>
        <nav className="flex shrink-0 items-baseline gap-4 whitespace-nowrap font-serif text-[12px] text-stone-500">
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

      {stats && stats.days_planned === 0 && <p className="mt-8 text-[15px] leading-6 text-stone-500">No list has been planned this week yet.</p>}
      {stats && stats.days_planned > 0 && (
        <>
          <p className="label mt-6">Top 3 done</p>
          <p className="clock mt-1 text-[34px] leading-10 text-stone-900">
            {stats.top3_done} of {stats.top3_total}
          </p>
          <div className="mt-3 text-[15px] leading-6 tabular-nums text-stone-900">
            <p>{facts([[stats.tasks_total, `${stats.tasks_done} of ${stats.tasks_total} tasks done`], [1, `${stats.days_planned} of ${stats.days_in_range} days planned`]])}</p>
            <p>
              {facts([
                [stats.focus_seconds, `${duration(stats.focus_seconds)} focused`],
                [
                  stats.pomodoros,
                  `${stats.pomodoros} ${stats.pomodoros === 1 ? "pomodoro" : "pomodoros"}${stats.pomodoros_interrupted > 0 ? `, ${stats.pomodoros_interrupted} interrupted` : ""}`,
                ],
              ])}
            </p>
          </div>
          <p className="mt-1 font-serif text-[12px] leading-5 tabular-nums text-stone-500">
            {facts([
              [stats.overrides, `${stats.overrides} ${stats.overrides === 1 ? "override" : "overrides"}`],
              [stats.days_reviewable, `${stats.days_reviewed} of ${stats.days_reviewable} days reviewed`],
            ])}
          </p>

          <WeekDots from={week.from} plans={plans} today={snapshot.today} />

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

/** Facts joined on one line, leaving out any whose count is zero. */
function facts(items: [number, string][]): string {
  return items
    .filter(([n]) => n > 0)
    .map(([, s]) => s)
    .join(" · ");
}

const WEEK_GRID = "-ml-10 grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] items-center";

/**
 * The week as dots: a column a day, a row for each position on the list, numbered in the
 * margin like the list itself. Ink is done; a ring is a task that was not (or not yet).
 */
function WeekDots({ from, plans, today }: { from: string; plans: PlanView[]; today: string }) {
  const days = Array.from({ length: 7 }, (_, i) => shiftDays(from, i));
  const byDate = new Map(plans.filter((p) => p.locked_at).map((p) => [p.date, p]));
  const said = days
    .map((d) => {
      const p = byDate.get(d);
      return `${weekday(d)}: ${p ? `${p.done_count} of ${p.task_count} done` : "no list"}`;
    })
    .join(". ");
  return (
    <div className="mt-6" role="img" aria-label={said}>
      {[1, 2, 3, 4, 5, 6].map((pos) => (
        <div key={pos} className={`${WEEK_GRID} h-6`}>
          <Numeral n={pos} size="xxs" tone="dim" className="pr-3 text-right" />
          {days.map((d) => {
            const t = byDate.get(d)?.tasks.find((x) => x.position === pos);
            return (
              <span key={d} className="flex justify-center">
                {t && <span className={`h-2 w-2 rounded-full ${t.status === "done" ? "bg-stone-900" : "border border-stone-400"}`} />}
              </span>
            );
          })}
        </div>
      ))}
      <div className={`${WEEK_GRID} mt-1 font-serif text-[12px] leading-5`} aria-hidden>
        <span />
        {days.map((d) => (
          <span key={d} className={`text-center ${d === today ? "text-stone-900" : "text-stone-500"}`}>
            {weekday(d).slice(0, 3)}
          </span>
        ))}
      </div>
    </div>
  );
}
