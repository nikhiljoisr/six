import { useEffect, useRef, useState } from "react";
import { Button, Chevron, Cross, Numeral, Rule } from "../components/ui";
import { api } from "../lib/api";
import { checkSummary, hintsForRows, type Checked } from "../lib/coachHints";
import { longDate } from "../lib/format";
import { isAppError, type DaySnapshot, type PlanView, type TaskInput } from "../lib/types";
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

// The title field wraps. Two layers share one grid cell: an unseen copy of the text that
// gives the row its height and its first baseline, and the field itself stretched over
// it. A one-line title is 32pt, as it always was. The right margin is kept for the row's
// controls, which appear over it.
const TITLE_FIELD = "col-start-1 row-start-1 w-full min-w-0 py-1 pr-28 text-[15px] leading-6 whitespace-pre-wrap [overflow-wrap:anywhere]";

// The note wraps the same way. Its grid is inline, as the one-line field it replaced
// was, so it sits on the row's own line and a one-line note is exactly where it was.
const NOTE_FIELD = "col-start-1 row-start-1 w-full min-w-0 text-[12px] leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]";

/** A title is one line of text however long it runs: a pasted line break becomes a space. */
const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, " ");

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
  // The list for exactly this date. If the Mac's date moved while the planner was open
  // (a clock set back, a changed day-start hour), `date` may be neither today nor
  // tomorrow any more; then nothing is saved, and no other day's list is touched.
  const dateIsPlannable = isToday || date === snapshot.tomorrow;
  const existing: PlanView | null =
    [snapshot.today_plan, snapshot.tomorrow_plan].find((p) => p?.date === date) ?? null;
  const editing = !!existing?.locked_at;

  const [rows, setRows] = useState<Row[] | null>(null);
  const [carriedFromLabel, setCarriedFromLabel] = useState("yesterday");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  // The planning coach (Settings; off by default). Nothing is sent until "Check the list"
  // is pressed; then the titles on screen go to TypeSafe once, and each row may get one
  // remark. It never blocks or changes saving.
  const coachOn = snapshot.settings.coach_enabled;
  const [checked, setChecked] = useState<Checked | null>(null);
  const [checking, setChecking] = useState(false);
  // What the foot line says after a check, and the titles it was said about: once a
  // title changes, the line goes back to the count.
  const [coachSays, setCoachSays] = useState<{ text: string; about: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragIndex = useRef<number | null>(null);
  // Keyboard: Return moves to the next row, Option+arrow moves the row itself. Rows are
  // keyed by place, so after a move the focus follows the row to its new place.
  const titleRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const noteRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const focusAfterRender = useRef<{ row: number; note: boolean } | null>(null);
  const focusField = (row: number, note = false) => {
    const el = (note && noteRefs.current[row]) || titleRefs.current[row];
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  };
  useEffect(() => {
    if (focusAfterRender.current === null) return;
    const { row, note } = focusAfterRender.current;
    focusAfterRender.current = null;
    focusField(row, note);
  });
  // Cmd+Return saves from anywhere on the screen, focused field or not.
  const saveFromKey = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented) return;
      e.preventDefault();
      saveFromKey.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  const titlesNow = rows.map((r) => r.title.trim()).filter((t) => t.length > 0);
  const about = titlesNow.join("\n");
  const check = async () => {
    const titles = titlesNow;
    if (titles.length === 0 || checking) return;
    setChecking(true);
    setCoachSays(null);
    try {
      const view = await api.coachPlan(titles);
      setChecked({ titles, hints: view.hints });
      setCoachSays({ text: checkSummary(view.hints), about });
    } catch (e) {
      setCoachSays({ text: isAppError(e) ? e.message : "The check did not work. The list is as you left it.", about });
    } finally {
      setChecking(false);
    }
  };
  const footLine = coachSays && coachSays.about === about ? coachSays.text : null;
  const rowHints = coachOn ? hintsForRows(rows.map((r) => r.title), checked) : [];

  const save = async () => {
    setSaveError(null);
    if (!dateIsPlannable) return;
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
        const plan = [fresh?.today_plan, fresh?.tomorrow_plan].find((p) => p?.date === date);
        if (!plan) {
          setSaveError("The date changed before the list could be locked. The draft is saved.");
          return;
        }
        const lockErr = await dispatch(() => api.lockPlan(plan.id));
        if (lockErr) return;
      }
      useStore.getState().notify(editing ? "Changes saved." : "List saved.");
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

  const canSave = dateIsPlannable && filled > 0 && !saving;
  saveFromKey.current = () => {
    if (canSave) void save();
  };
  const onRowKey = (i: number, note: boolean, e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // An input method composing text owns its keys, including the Return that commits
    // (which WebKit reports after the composition has ended, as key code 229).
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229 || e.metaKey || e.ctrlKey) return;
    if (e.altKey && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const to = e.key === "ArrowUp" ? i - 1 : i + 1;
      e.preventDefault();
      if (to < 0 || to >= rows.length) return;
      move(i, to);
      focusAfterRender.current = { row: to, note };
      return;
    }
    if (e.key === "Enter" && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      if (i + 1 < rows.length) focusField(i + 1);
    }
  };

  return (
    <div className="flex min-h-screen flex-col pl-8 pr-0 pt-2">
      <header className="flex h-5 items-baseline justify-between gap-6 leading-5">
        <h1 className="font-serif text-[15px] font-normal text-stone-900">{label}</h1>
        <nav className="flex shrink-0 items-baseline gap-4 whitespace-nowrap font-serif text-[12px] text-stone-500">
          <button type="button" className="hover:text-stone-900" onClick={finish}>
            Cancel
          </button>
        </nav>
      </header>
      <p className="mt-1 font-serif text-[12px] leading-5 text-stone-500">{longDate(date)}. Most important at the top.</p>
      <Rule className="mt-3" />

      {/* Six rows in the day view's own shape: a hanging numeral (the drag handle), the
          title, and the row's controls at the margin, shown while the pointer is over it. */}
      <div ref={listRef} className="mt-6">
        {rows.map((row, i) => (
          <div
            key={i}
            className={`group relative -ml-10 grid grid-cols-[2.5rem_minmax(0,1fr)] items-baseline py-1 transition-opacity duration-150 ${dragging === i ? "opacity-60" : ""}`}
          >
            <span
              className="cursor-grab pr-3 text-right leading-8 select-none active:cursor-grabbing"
              style={{ touchAction: "none" }}
              onPointerDown={(e) => onHandleDown(i, e)}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              onPointerCancel={onHandleUp}
              aria-label={`Row ${i + 1}, drag to reorder`}
            >
              <Numeral n={i + 1} size="xs" tone={row.title.trim() ? "ink" : "dim"} className="leading-8" />
            </span>
            <div className="min-w-0 border-b border-stone-200 pb-0.5 focus-within:border-stone-400">
              <div className="grid">
                <div aria-hidden className={`${TITLE_FIELD} invisible`}>
                  {row.title}
                  {"\u200b"}
                </div>
                <textarea
                  ref={(el) => {
                    titleRefs.current[i] = el;
                  }}
                  rows={1}
                  value={row.title}
                  aria-label={`Task ${i + 1}`}
                  placeholder={i === 0 ? "e.g. Draft the opening section" : ""}
                  onChange={(e) => update(i, { title: oneLine(e.target.value) })}
                  onKeyDown={(e) => onRowKey(i, false, e)}
                  className={`${TITLE_FIELD} resize-none overflow-hidden bg-transparent text-stone-900 placeholder:text-stone-400 focus:outline-none`}
                  maxLength={140}
                  autoFocus={i === 0 && !row.title}
                />
              </div>
              {row.carriedFrom && <div className="font-serif text-[12px] leading-5 text-amber-700">from {carriedFromLabel}</div>}
              {rowHints[i] && <div className="font-serif text-[12px] leading-5 text-stone-500">{rowHints[i]}</div>}
              {(row.showNote || row.note) && (
                <div className="inline-grid w-full">
                  <div aria-hidden className={`${NOTE_FIELD} invisible`}>
                    {row.note}
                    {"\u200b"}
                  </div>
                  <textarea
                    ref={(el) => {
                      noteRefs.current[i] = el;
                    }}
                    rows={1}
                    value={row.note}
                    aria-label={`Note for task ${i + 1}`}
                    placeholder="A one-line note"
                    onChange={(e) => update(i, { note: oneLine(e.target.value) })}
                    onKeyDown={(e) => onRowKey(i, true, e)}
                    className={`${NOTE_FIELD} resize-none overflow-hidden bg-transparent text-stone-500 placeholder:text-stone-400 focus:outline-none`}
                    maxLength={200}
                    autoFocus={row.showNote && !row.note}
                  />
                </div>
              )}
            </div>
            <div className="absolute top-1 right-0 flex items-baseline gap-x-3 pl-4 text-[12px] leading-8 text-stone-400 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
              {!row.showNote && !row.note && row.title.trim() && (
                <button type="button" className="hover:text-stone-900" onClick={() => update(i, { showNote: true })}>
                  note
                </button>
              )}
              <button type="button" className="hover:text-stone-900 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, i - 1)} title="Option+↑" aria-label="Move up (Option+Up)">
                <Chevron direction="up" />
              </button>
              <button type="button" className="hover:text-stone-900 disabled:opacity-30" disabled={i === rows.length - 1} onClick={() => move(i, i + 1)} title="Option+↓" aria-label="Move down (Option+Down)">
                <Chevron direction="down" />
              </button>
              <button type="button" className="hover:text-stone-900 disabled:opacity-30" disabled={!row.title && !row.note} onClick={() => clear(i)} aria-label="Clear row">
                <Cross />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* The last row's own line closes the list; the foot adds none of its own. */}
      <div className="sticky bottom-0 mt-auto -ml-14 -mr-6 bg-paper pl-14 pr-6 pb-8 pt-4">
        {(!dateIsPlannable || saveError) && (
          <p role="alert" className="mb-3 text-sm text-stone-500">
            {saveError ?? "This date is no longer today or tomorrow. Check the Mac's clock; the rows are still here."}
          </p>
        )}
        <p role="status" className="font-serif text-[12px] leading-5 text-stone-500">
          {(coachOn && footLine) || `Choose up to six. Fewer is fine.${filled > 0 ? ` ${filled} of 6.` : ""}`}
        </p>
        <div className="mt-3 flex items-center justify-end gap-5">
          {coachOn && (
            <button
              type="button"
              className="font-serif text-[12px] leading-5 text-stone-500 hover:text-stone-900 disabled:opacity-40"
              disabled={checking || filled === 0}
              title="Sends these task titles to TypeSafe, once"
              onClick={() => void check()}
            >
              {checking ? "Checking…" : "Check the list"}
            </button>
          )}
          <Button className="px-4" disabled={!canSave} title="⌘↩" onClick={() => void save()}>
            {editing ? "Save changes" : isToday ? "Lock today's list" : "Lock tomorrow's list"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function dayBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const prev = new Date(y, m - 1, d - 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-${String(prev.getDate()).padStart(2, "0")}`;
}
