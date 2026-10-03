// How a review runs, which depends on the day it is about. Pure, so it can be tested.

export interface ReviewFlow {
  /** The review is of a day that has ended, not of today. */
  past: boolean;
  /** How many screens: what happened, carry or drop, tomorrow's planner. */
  steps: 1 | 2 | 3;
  /** Whether carrying or dropping what was left still changes anything. */
  askCarry: boolean;
  /** Today's review ends in tomorrow's planner; a past day's returns to where it was opened. */
  endsIn: "planner" | "back";
}

/**
 * Today's review is the evening ritual: three screens, ending in tomorrow's planner. A
 * past day's review never plans anything. It asks about what was left only while that
 * day is still the latest list (the next planner draws from it); once a later list is
 * locked, that list already took what carried, and there is nothing left to decide.
 */
export function reviewFlow(isToday: boolean, isLatestList: boolean, unfinished: number): ReviewFlow {
  if (isToday) return { past: false, steps: 3, askCarry: true, endsIn: "planner" };
  const askCarry = isLatestList && unfinished > 0;
  return { past: true, steps: askCarry ? 2 : 1, askCarry, endsIn: "back" };
}
