import { Day } from "./app/Day";
import { History } from "./app/History";
import { Planner } from "./app/Planner";
import { useStore } from "./store";

export default function App() {
  const snapshot = useStore((s) => s.snapshot);
  const view = useStore((s) => s.view);
  const error = useStore((s) => s.error);
  const clearError = useStore((s) => s.clearError);

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-6 pt-10">
      {!snapshot && !error && <p className="mt-20 text-center text-sm text-stone-400">Loading…</p>}
      {snapshot && view.name === "day" && <Day key="day" snapshot={snapshot} />}
      {snapshot && view.name === "planner" && <Planner key={`planner-${view.date}`} snapshot={snapshot} date={view.date} />}
      {snapshot && view.name === "history" && <History key="history" snapshot={snapshot} />}
      {error && (
        <button
          type="button"
          className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md border-t border-stone-200 bg-stone-50 px-6 py-3 text-left text-sm text-stone-500"
          onClick={clearError}
        >
          {error}
        </button>
      )}
    </main>
  );
}
