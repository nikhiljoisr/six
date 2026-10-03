// Where "back" leads from each screen. Pure, so Esc and the Back link agree and it can be tested.

import type { View } from "../store/index.ts";

/** The screen that Esc (or Back) returns to, or null where leaving could discard typing. */
export function backFrom(view: View, previous: View | null): View | null {
  switch (view.name) {
    case "history":
      return { name: "day" };
    case "stats":
      return { name: "history" };
    case "settings":
      return previous && previous.name !== "settings" ? previous : { name: "history" };
    default:
      // The day view is home; the planner and the review hold unsaved input.
      return null;
  }
}
