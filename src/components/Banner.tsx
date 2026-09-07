import { useEffect } from "react";
import { api } from "../lib/api";
import { chime } from "../lib/sound";
import type { Nudge } from "../lib/types";
import { useStore } from "../store";
import { Button } from "./ui";

// The in-app form of a nudge (SPEC §4.10): while the window is focused nothing fires at
// the OS; the same title, body and actions appear here instead. One at a time. A button
// acts on the task the nudge was about; if that task has moved on, Rust says so and the
// banner simply goes.

export function Banner({ nudge }: { nudge: Nudge }) {
  const dispatch = useStore((s) => s.dispatch);
  const dismiss = useStore((s) => s.dismissNudge);
  const sound = useStore((s) => s.snapshot?.settings.sound_enabled ?? false);
  useEffect(() => {
    if (sound && (nudge.kind === "pomodoro_done" || nudge.kind === "break_over")) chime();
  }, [sound, nudge.kind, nudge.due]);
  const act = async (id: string) => {
    const err = await dispatch(() => api.nudgeAction(nudge.kind, id, nudge.task_id));
    if (!err || err.code === "stale_nudge") dismiss(nudge.kind);
  };
  return (
    <div className="fixed inset-x-0 top-0 z-30" role="status">
      <div className="w-full border-b border-stone-200 bg-paper py-3 pl-[72px] pr-10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[15px] leading-6 text-stone-900">{nudge.title}</div>
            {nudge.body && <div className="text-[13px] leading-5 text-stone-500">{nudge.body}</div>}
          </div>
          <button
            type="button"
            className="shrink-0 font-serif text-[12px] leading-6 text-stone-500 hover:text-stone-900"
            onClick={() => dismiss(nudge.kind)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-5 gap-y-1">
          {nudge.actions.map((a, i) => (
            <Button key={a.id} variant={i === 0 ? "text" : "link"} onClick={() => void act(a.id)}>
              {a.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
