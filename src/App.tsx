import { useStore } from "./store";
import { dayLabel } from "./lib/format";

// Step 1 smoke screen: proves the Rust snapshot reaches the webview. The real Day,
// Planner and History views arrive in Step 2.
export default function App() {
  const snapshot = useStore((s) => s.snapshot);
  const error = useStore((s) => s.error);

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-6 pt-12 pb-16">
      <header className="flex items-start justify-between">
        <div>
          <div className="label">{snapshot ? dayLabel(snapshot.today) : " "}</div>
          <h1 className="mt-2 font-serif text-4xl font-normal text-stone-900">Six</h1>
        </div>
        {snapshot && snapshot.streak > 0 && (
          <div className="mt-1 text-sm text-amber-700">🔥 {snapshot.streak}</div>
        )}
      </header>

      <section className="mt-16 text-center">
        {error && <p className="text-sm text-stone-500">{error}</p>}
        {!error && !snapshot && <p className="text-sm text-stone-400">Loading…</p>}
        {snapshot && !snapshot.today_plan && (
          <>
            <div className="label">No list yet</div>
            <h2 className="mt-3 font-serif text-2xl font-normal">What are today's six?</h2>
            <p className="mt-2 text-sm text-stone-500">The planner arrives in Step 2.</p>
          </>
        )}
        {snapshot?.today_plan && (
          <ol className="space-y-2 text-left">
            {snapshot.today_plan.tasks.map((t) => (
              <li key={t.id} className="flex gap-3 rounded-[12px] border border-stone-200 bg-white px-4 py-3">
                <span className="font-serif text-xl text-stone-900">{t.position}</span>
                <span className="text-stone-900">{t.title}</span>
                <span className="ml-auto text-xs text-stone-400">{t.status}</span>
              </li>
            ))}
          </ol>
        )}
        {snapshot && (
          <p className="mt-10 text-xs text-stone-400">
            core ready · {snapshot.phase.replace("_", " ")} · rollover {snapshot.settings.day_start_hour}:00
          </p>
        )}
      </section>
    </main>
  );
}
