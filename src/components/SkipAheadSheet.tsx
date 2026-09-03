import { useEffect, useRef, useState } from "react";
import type { TaskView } from "../lib/types";
import { Button } from "./ui";

// The escape hatch, with a buffer. Skipping ahead is always possible, but the app asks
// three times with rising insistence and the last answer is a press-and-hold, so the
// method is broken on purpose or not at all. Nothing is logged until the hold completes.

const HOLD_MS = 1500;

interface Props {
  target: TaskView;
  /** The earliest unfinished task the user would be leaving behind. */
  blocking: TaskView;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SkipAheadSheet({ target, blocking, onCancel, onConfirm }: Props) {
  const [stage, setStage] = useState(0);
  const [progress, setProgress] = useState(0);
  const holdStart = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  const done = useRef(false);

  const stopHold = () => {
    holdStart.current = null;
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    setProgress(0);
  };

  useEffect(() => () => stopHold(), []);

  const startHold = () => {
    if (done.current) return;
    holdStart.current = performance.now();
    timer.current = window.setInterval(() => {
      if (holdStart.current === null) return;
      const p = Math.min(1, (performance.now() - holdStart.current) / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        done.current = true;
        stopHold();
        onConfirm();
      }
    }, 40);
  };

  const b = blocking.position;
  const t = target.position;
  const stages = [
    {
      title: "Skip ahead?",
      body: "The Ivy Lee method works best when you finish tasks in priority order. Sure you want to break order?",
      stay: `Stay on ${b}`,
      go: "Skip ahead",
    },
    {
      title: "Still sure?",
      body: `Task ${b} is on the list because it is the most important thing today. Ten more minutes on it might be enough.`,
      stay: `Back to ${b}`,
      go: "Yes, still sure",
    },
    {
      title: "Last ask.",
      body: `This gets logged as an override. Hold the button if you really need ${t} now.`,
      stay: `Stay on ${b}`,
      go: "Hold to skip ahead",
    },
  ] as const;
  const s = stages[stage];
  const last = stage === stages.length - 1;

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-stone-900/20" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal
        className="w-full max-w-md rounded-t-[16px] border-t border-stone-200 bg-stone-50 px-6 pb-8 pt-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex gap-1.5" aria-hidden>
          {stages.map((_, i) => (
            <span key={i} className={`h-1 w-4 rounded-full ${i <= stage ? "bg-stone-900" : "bg-stone-200"}`} />
          ))}
        </div>
        <h2 className="font-serif text-2xl font-normal text-stone-900">{s.title}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-stone-500">{s.body}</p>
        <div className="mt-6 space-y-2">
          <Button full onClick={onCancel}>
            {s.stay}
          </Button>
          {last ? (
            <button
              type="button"
              className="relative w-full overflow-hidden rounded-control border border-stone-300 px-4 py-3 text-[15px] font-medium text-stone-900 select-none"
              style={{ touchAction: "none" }}
              onPointerDown={(e) => {
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  // Some pointers cannot be captured; the hold still works without it.
                }
                startHold();
              }}
              onPointerUp={stopHold}
              onPointerCancel={stopHold}
              onPointerLeave={stopHold}
              onContextMenu={(e) => e.preventDefault()}
            >
              <span
                className="absolute inset-y-0 left-0 bg-stone-200"
                style={{ width: `${progress * 100}%`, transition: progress === 0 ? "width 150ms" : "none" }}
                aria-hidden
              />
              <span className="relative">{progress > 0 && progress < 1 ? "Keep holding…" : s.go}</span>
            </button>
          ) : (
            <Button full variant="secondary" onClick={() => setStage(stage + 1)}>
              {s.go}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
