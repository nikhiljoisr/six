import { useEffect, useRef, useState } from "react";
import { Button, Chevron, Cross, Label, Numeral } from "../components/ui";
import { api } from "../lib/api";
import { longDate } from "../lib/format";
import type { DaySnapshot, PlanView, TaskInput } from "../lib/types";
import { useStore } from "../store";

// The planner: six rows, most important at the top. Rows carried from an earlier day
// arrive pre-filled and tagged. Locking saves the list; editing a locked list is logged
// by the Rust side.

interface Row {
  id: string | null;
  title: string;
  note: string;
  carriedFrom: string | null;
  showNote: boolean;
}

const EMPTY: Row = { id: null, title: "", note: "", carriedFrom: null, showNote: false };

function sixRows(rows: Row[]): Row[] {
  return Array.from({ length: 6 }, (_, i) => rows[i] ?? { ...EMPTY });
}

export function Planner({
  snapshot,
  date,
  mergeCarryover = false,
  onDone,
}: {
  snapshot: DaySnapshot;
  date: string;
  /** From the review: add carried tasks to the empty rows of an already-planned list. */
  mergeCarryover?: boolean;
  onDone?: () => void;
}) {
  const navigate = useStore((s) => s.navigate);
  const dispatch = useStore((s) => s.dispatch);
  const finish = () => (onDone ? onDone() : navigate({ name: "day" }));
  const isToday = date === snapshot.today;
  const existing: PlanView | null = isToday ? snapshot.today_plan : snapshot.tomorrow_plan;
  const editing = !!existing?.locked_at;

  const [rows, setRows] = useState<Row[] | null>(null);
  const [carriedFromLabel, setCarriedFromLabel] = useState("yesterday");
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragIndex = useRef<number | null>(null);

  // Pre-fill once: the existing list if there is one, otherwise the carryover.
  useEffect(() => {
    let cancelled = false;
    if (existing) {
      const base: Row[] = existing.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        note: t.note ?? "",
        carriedFrom: t.carried_from,
        showNote: !!t.note,
      }));
      if (!mergeCarryover) {
        setRows(sixRows(base));
        return;
      }
      api
        .getCarryover(date)
        .then((carry) => {
          if (cancelled) return;
          if (carry) setCarriedFromLabel(carry.from_date === dayBefore(date) ? "yesterday" : longDate(carry.from_date));
          const titles = new Set(base.map((r) => r.title.trim().toLowerCase()));
          const extra: Row[] = (carry?.tasks ?? [])
            .filter((t) => !titles.has(t.title.trim().toLowerCase()))
            .map((t) => ({ id: null, title: t.title, note: t.note ?? "", carriedFrom: t.carried_from ?? null, showNote: !!t.note }));
          setRows(sixRows([...base, ...extra].slice(0, 6)));
        })
        .catch(() => !cancelled && setRows(sixRows(base)));
      return () => {
        cancelled = true;
      };
    }
    api
      .getCarryover(date)
      .then((carry) => {
        if (cancelled) return;
        if (carry) setCarriedFromLabel(carry.from_date === dayBefore(date) ? "yesterday" : longDate(carry.from_date));
        setRows(
          sixRows(
            (carry?.tasks ?? []).map((t) => ({
              id: null,
              title: t.title,
              note: t.note ?? "",
              carriedFrom: t.carried_from ?? null,
              showNote: !!t.note,
            })),
          ),
        );
      })
      .catch(() => !cancelled && setRows(sixRows([])));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  if (!rows) return null;

  const update = (i: number, patch: Partial<Row>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || from === to) return;
    const next = rows.slice();
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    setRows(next);
  };
  const clear = (i: number) => update(i, { ...EMPTY });

  const filled = rows.filter((r) => r.title.trim().length > 0).length;
  const label = isToday ? "Today's six" : "Tomorrow's six";

  const save = async () => {
    const tasks: TaskInput[] = rows
      .filter((r) => r.title.trim().length > 0)
      .map((r) => ({ id: r.id, title: r.title.trim(), note: r.note.trim() || null, carried_from: r.carriedFrom }));
    setSaving(true);
    try {
      if (editing && existing) {
        const err = await dispatch(() => api.editPlan(existing.id, tasks));
        if (err) return;
      } else {
        const err = await dispatch(() => api.draftPlan(date, tasks));
        if (err) return;
        const fresh = useStore.getState().snapshot;
        const plan = isToday ? fresh?.today_plan : fresh?.tomorrow_plan;
        if (!plan) return;
        const lockErr = await dispatch(() => api.lockPlan(plan.id));
        if (lockErr) return;
      }
      finish();
    } finally {
      setSaving(false);
    }
  };

  // Drag to reorder: the numeral is the handle; rows swap as the pointer passes them.
  const onHandleDown = (i: number, e: React.PointerEvent<HTMLElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety; reordering works without it.
    }
    dragIndex.current = i;
    setDragging(i);
  };
  const onHandleMove = (e: React.PointerEvent<HTMLElement>) => {
    if (dragIndex.current === null || !listRef.current) return;
    const items = Array.from(listRef.current.children) as HTMLElement[];
    let target = dragIndex.current;
    items.forEach((el, idx) => {
      const r = el.getBoundingClientRect();
      if (e.clientY > r.top && e.clientY < r.bottom) target = idx;
    });
    if (target !== dragIndex.current) {
      move(dragIndex.current, target);
      dragIndex.current = target;
      setDragging(target);
    }
  };
  const onHandleUp = () => {
    dragIndex.current = null;
    setDragging(null);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="relative flex items-center justify-center py-1">
        <button
          type="button"
          className="absolute left-0 text-sm text-stone-500 hover:text-stone-900"
          onClick={finish}
        >
          Cancel
        </button>
        <Label>{label}</Label>
      </header>
      <h1 className="mt-8 font-serif text-3xl font-normal text-stone-900">{longDate(date)}</h1>
      <p className="mt-1 text-[15px] text-stone-500">Most important at the top.</p>

      <div ref={listRef} className="mt-8 space-y-2">
        {rows.map((row, i) => (
          <div
            key={i}
            className={`rounded-card border bg-white px-3 py-2.5 transition-opacity duration-150 ${dragging === i ? "border-stone-400 opacity-80" : "border-stone-200"}`}
          >
            <div className="flex items-center gap-3">
              <span
                className="w-7 shrink-0 cursor-grab text-center select-none active:cursor-grabbing"
                style={{ touchAction: "none" }}
                onPointerDown={(e) => onHandleDown(i, e)}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
                aria-label={`Row ${i + 1}, drag to reorder`}
              >
                <Numeral n={i + 1} size="lg" tone={row.title.trim() ? "ink" : "dim"} />
              </span>
              <div className="min-w-0 flex-1">
                <input
                  value={row.title}
                  placeholder={i === 0 ? "The most important thing" : ""}
                  onChange={(e) => update(i, { title: e.target.value })}
                  className="w-full bg-transparent py-1 text-[15px] text-stone-900 placeholder:text-stone-300 focus:outline-none"
                  maxLength={140}
                  autoFocus={i === 0 && !row.title}
                />
                {row.carriedFrom && (
                  <div className="text-[11px] text-amber-700">↑ from {carriedFromLabel}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center text-stone-400">
                <button type="button" className="p-1 hover:text-stone-900 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label="Move up">
                  <Chevron direction="up" />
                </button>
                <button type="button" className="p-1 hover:text-stone-900 disabled:opacity-30" disabled={i === rows.length - 1} onClick={() => move(i, i + 1)} aria-label="Move down">
                  <Chevron direction="down" />
                </button>
                <button type="button" className="ml-1 p-1 hover:text-stone-900 disabled:opacity-30" disabled={!row.title && !row.note} onClick={() => clear(i)} aria-label="Clear row">
                  <Cross />
                </button>
              </div>
            </div>
            {(row.showNote || row.note) && (
              <input
                value={row.note}
                placeholder="A one-line note"
                onChange={(e) => update(i, { note: e.target.value })}
                className="mt-1 ml-10 w-[calc(100%-2.5rem)] bg-transparent text-sm text-stone-500 placeholder:text-stone-300 focus:outline-none"
                maxLength={200}
              />
            )}
            {!row.showNote && !row.note && row.title.trim() && (
              <button
                type="button"
                className="ml-10 mt-0.5 text-[11px] text-stone-400 hover:text-stone-600"
                onClick={() => update(i, { showNote: true })}
              >
                note
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 mt-auto -mx-6 border-t border-stone-200 bg-stone-50/95 px-6 pb-8 pt-4 backdrop-blur">
        <Button full disabled={filled === 0 || saving} onClick={() => void save()}>
          {editing ? "Save changes" : isToday ? "Lock today's list" : "Lock tomorrow's list"}
        </Button>
        <p className="mt-2 text-center text-xs text-stone-500">{filled} of 6 filled</p>
      </div>
    </div>
  );
}

function dayBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const prev = new Date(y, m - 1, d - 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-${String(prev.getDate()).padStart(2, "0")}`;
}
