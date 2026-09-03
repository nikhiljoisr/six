import { api } from "../lib/api";
import type { Nudge } from "../lib/types";
import { useStore } from "../store";
import { Button } from "./ui";

// The in-app form of a nudge (SPEC §4.10): while the window is focused nothing fires at
// the OS; the same title, body and actions appear here instead. One at a time.

export function Banner({ nudge }: { nudge: Nudge }) {
  const dispatch = useStore((s) => s.dispatch);
  const dismiss = useStore((s) => s.dismissNudge);
  const act = async (id: string) => {
    dismiss(nudge.kind);
    await dispatch(() => api.nudgeAction(nudge.kind, id));
  };
  return (
    <div className="fixed inset-x-0 top-0 z-30 flex justify-center px-4 pt-4" role="status">
      <div className="w-full max-w-md rounded-card border border-stone-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[15px] font-medium text-stone-900">{nudge.title}</div>
            {nudge.body && <div className="mt-0.5 text-sm text-stone-500">{nudge.body}</div>}
          </div>
          <button
            type="button"
            className="shrink-0 text-xs text-stone-400 hover:text-stone-600"
            onClick={() => dismiss(nudge.kind)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-1">
          {nudge.actions.map((a, i) => (
            <Button key={a.id} variant={i === 0 ? "primary" : "link"} className={i === 0 ? "px-3 py-1.5 text-sm" : ""} onClick={() => void act(a.id)}>
              {a.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
