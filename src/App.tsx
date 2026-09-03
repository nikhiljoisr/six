import { useEffect } from "react";
import { Day } from "./app/Day";
import { History } from "./app/History";
import { Planner } from "./app/Planner";
import { Review } from "./app/Review";
import { Settings } from "./app/Settings";
import { Stats } from "./app/Stats";
import { Banner } from "./components/Banner";
import { installNotificationActions } from "./lib/notifications";
import { installInteractionStamps } from "./lib/touch";
import { useStore } from "./store";

export default function App() {
  const snapshot = useStore((s) => s.snapshot);
  const view = useStore((s) => s.view);
  const error = useStore((s) => s.error);
  const clearError = useStore((s) => s.clearError);
  const nudge = useStore((s) => s.nudges[0] ?? null);

  useEffect(() => {
    void installNotificationActions();
    return installInteractionStamps();
  }, []);

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-6 pt-10">
      {!snapshot && !error && <p className="mt-20 text-center text-sm text-stone-400">Loading…</p>}
      {snapshot && view.name === "day" && <Day key="day" snapshot={snapshot} />}
      {snapshot && view.name === "planner" && <Planner key={`planner-${view.date}`} snapshot={snapshot} date={view.date} />}
      {snapshot && view.name === "history" && <History key="history" snapshot={snapshot} />}
      {snapshot && view.name === "review" && <Review key={`review-${view.planId}`} snapshot={snapshot} planId={view.planId} />}
      {snapshot && view.name === "stats" && <Stats key="stats" snapshot={snapshot} />}
      {snapshot && view.name === "settings" && <Settings key="settings" snapshot={snapshot} />}
      {nudge && <Banner nudge={nudge} />}
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
