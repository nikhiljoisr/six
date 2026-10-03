import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { clockOn, clockTime, duration } from "../lib/format";
import { chime } from "../lib/sound";
import type { IdleFlag, Nudge } from "../lib/types";
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
    if (!sound || (nudge.kind !== "pomodoro_done" && nudge.kind !== "break_over")) return;
    const chosen = useStore.getState().snapshot?.settings;
    chime(chosen?.sound_style, chosen?.sound_level);
  }, [sound, nudge.kind, nudge.due]);
  const act = async (id: string) => {
    const err = await dispatch(() => api.nudgeAction(nudge.kind, id, nudge.task_id));
    if (!err || err.code === "stale_nudge") dismiss(nudge.kind);
  };
  return (
    <Frame title={nudge.title} body={nudge.body} onDismiss={() => dismiss(nudge.kind)}>
      {nudge.actions.map((a, i) => (
        <Button key={a.id} variant={i === 0 ? "text" : "link"} onClick={() => void act(a.id)}>
          {a.label}
        </Button>
      ))}
    </Frame>
  );
}

/**
 * Back after a long silence on the running task: say what was recorded and offer to take
 * the silence out while it is fresh. It is the day's state, not a nudge: it stays until it
 * is answered, it is never automatic, and keeping the time is one click (the evening
 * review can still take the silence out).
 */
export function GapBanner({ flag }: { flag: IdleFlag }) {
  const dispatch = useStore((s) => s.dispatch);
  const [busy, setBusy] = useState(false);
  const answer = async (run: () => ReturnType<typeof api.keepGap>, said?: string) => {
    setBusy(true);
    const err = await dispatch(run);
    setBusy(false);
    if (!err && said) useStore.getState().notify(said);
  };
  return (
    <Frame
      title={`No interaction from ${clockOn(flag.gap_start, flag.gap_end)} to ${clockTime(flag.gap_end)}.`}
      body={`Six has ${duration(flag.seconds)} recorded on this task.`}
    >
      <Button
        variant="text"
        disabled={busy}
        onClick={() => void answer(() => api.trimReturnGap(flag.session_id), "Taken out of the recorded time.")}
      >
        Take {duration(flag.gap_seconds)} out
      </Button>
      <Button variant="link" disabled={busy} onClick={() => void answer(() => api.keepGap(flag.session_id))}>
        Keep as recorded
      </Button>
    </Frame>
  );
}

/** The banner under the title bar: a title, a line of detail, and its answers. */
function Frame({ title, body, onDismiss, children }: { title: string; body?: string; onDismiss?: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 top-0 z-30" role="status">
      <div className="w-full border-b border-stone-200 bg-paper py-3 pl-[72px] pr-10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[15px] leading-6 text-stone-900">{title}</div>
            {body && <div className="text-[13px] leading-5 text-stone-500">{body}</div>}
          </div>
          {onDismiss && (
            <button type="button" className="shrink-0 font-serif text-[12px] leading-6 text-stone-500 hover:text-stone-900" onClick={onDismiss} aria-label="Dismiss">
              ✕
            </button>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-5 gap-y-1">{children}</div>
      </div>
    </div>
  );
}
