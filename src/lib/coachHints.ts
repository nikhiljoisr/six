// What the planner says about a checked list. Pure. The model only answered questions;
// the words are chosen here, and a hint lives only as long as the title it was about.

import type { CoachHint } from "./types.ts";

export interface Checked {
  /** The titles that were sent, in order (empty rows left out). */
  titles: string[];
  hints: (CoachHint | null)[];
}

/** Where the n-th row with this title sits now, so identical titles keep their own hints. */
function place(titles: string[], title: string, occurrence: number): number {
  let seen = 0;
  for (let i = 0; i < titles.length; i++) {
    if (titles[i] !== title) continue;
    if (seen === occurrence) return i;
    seen++;
  }
  return -1;
}

const occurrenceOf = (titles: string[], index: number) => titles.slice(0, index).filter((t) => t === titles[index]).length;

/**
 * One line per planner row, or null. A row keeps its hint while its title is exactly what
 * was checked, wherever the row has moved to; edit the title and the hint is gone. "Same
 * work as row N" names the other row by where it is now, and goes if that row has gone.
 */
export function hintsForRows(rows: string[], checked: Checked | null): (string | null)[] {
  const now = rows.map((t) => t.trim());
  if (!checked) return now.map(() => null);
  return now.map((title, i) => {
    if (!title) return null;
    const k = place(checked.titles, title, occurrenceOf(now, i));
    const hint = k < 0 ? null : checked.hints[k];
    if (!hint) return null;
    switch (hint.kind) {
      case "two_tasks":
        return "Reads as two tasks.";
      case "no_finish":
        return "No clear finish.";
      case "most_of_a_day":
        return "Looks like most of a day.";
      case "same_as": {
        const twin = hint.row - 1;
        if (twin < 0 || twin >= checked.titles.length) return null;
        const at = place(now, checked.titles[twin], occurrenceOf(checked.titles, twin));
        return at < 0 || at === i ? null : `Same work as row ${at + 1}.`;
      }
    }
  });
}

/** What the planner's foot line says after a check. */
export function checkSummary(hints: (CoachHint | null)[]): string {
  const n = hints.filter(Boolean).length;
  return n === 0 ? "Checked. Nothing to say." : `Checked. ${n} ${n === 1 ? "row has" : "rows have"} a note.`;
}
