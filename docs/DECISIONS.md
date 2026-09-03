# Decisions log

Dated amendments and interpretations of `SPEC.md`. The brief stays verbatim; anything that
differs from it, or that it left open, is recorded here.

## 2026-09-03 — Step 1

- **Schema:** `UNIQUE (plan_id, position)` was dropped from `tasks`. SQLite checks UNIQUE per
  row and cannot defer it, so reordering a full list of six fails on the first swap.
  Position uniqueness is enforced in Rust (`domain::plan`, checked again before every save).
  Postgres (Phase 2) can keep the constraint as `DEFERRABLE INITIALLY DEFERRED`.
- **Persistence:** `tauri-plugin-sql` opens the database and runs the migrations, exactly as
  specified; the Rust core takes the pool from the plugin's public `DbInstances`. The
  frontend is granted no `sql:` permissions.
- **Override scope:** an earlier task that is active or paused, not just planned, also makes
  starting a later task an override. Whatever held the slot returns to `planned` and its
  session closes as `superseded`.
- **Carryover source:** the most recent *locked* list before the target date, not strictly
  yesterday, so a missed planning day never loses tasks. Drafts never carry.
- **Review:** recorded once per day; unfinished tasks without a decision carry.
- **Auto-activation:** on every read of today's locked list, if nothing holds the slot the
  first planned task becomes active (SPEC §4.3, "when the app is opened on the list's day").

## 2026-09-03 — Step 2 (Nikhil's amendment)

- **Skip-ahead friction is a ladder, not a single confirmation.** Nikhil: it should not feel
  locked, but the app should ask a couple of times and irritate a little before allowing the
  move. Implemented as three escalating prompts in a bottom sheet; the third requires a
  1.5-second press-and-hold. Cancelling at any step logs nothing. Completing the hold sends
  `activate(task, override_order = true)` and logs one `overridden` event, as before.
  The "stay" option is always the primary button.
- **"Plan today instead" on the evening screen.** SPEC §4.1 state B (no list for today, after
  the evening hour) shows only the tomorrow ritual. Nikhil: planning today late must stay
  possible. A quiet text link below the ritual opens today's planner; the ritual stays the
  primary action.

## 2026-09-03 — Step 3

- **The ticking clock asks Rust.** The active card polls `get_elapsed` once a second while
  the window is focused and visible; Rust derives the number from session timestamps. The
  frontend never adds seconds itself. Unfocused or hidden, nothing ticks (SPEC §4.4).
- **Interaction stamps.** Any pointer or key activity calls `touch` at most once a minute,
  which sets `last_interaction_at` on the running session. That is what the idle flag
  (over three hours with no interaction) is measured against.
- **Where "Review today" lives.** SPEC §4.1 names the button only for the all-done state.
  Most evenings end with unfinished tasks, and the end-of-day notification (Step 5) is not
  the only way in, so after the evening hour the Tomorrow area offers "Review today" as the
  primary action (the review ends in tomorrow's planner) with "Plan tomorrow" as secondary.
  Before the evening hour the area is exactly as specified.
- **Review order.** Leaving panel 2 records the review (decisions, reflection, `reviewed`
  event). Panel 3 is the planner for tomorrow; cancelling there keeps the review and leaves
  tomorrow unplanned, which the Day view then offers as usual. If tomorrow was already
  planned, carried tasks are added to its empty rows (deduplicated by title) only in this
  review path, never when editing tomorrow directly.

## 2026-09-03 — Step 4

- **Title only, no tray icon.** SPEC §4.11 allows text alone; the menu bar shows the text.
- **Dock icon while the window is open, none when closed.** Closing the main window hides
  it and switches the app to the accessory activation policy, so Six lives in the menu bar
  alone. "Open Six" (popover, menu, or the Dock when present) switches back.
- **Tray refresh.** The title is set on every state change, and also on every snapshot
  read (window focus, popover open), since the evening hour can pass without a mutation.
  Never per second. The scheduler in Step 5 adds the timed flip at the evening hour.
- **Popover toggling.** Clicking the tray while the popover is open closes it: the click
  first takes the popover's focus (which hides it), and a click arriving within 400 ms of
  that is not treated as a request to reopen.
- **Menu text follows state.** "Pause" / "Resume" (disabled when nothing holds the slot),
  "Review today" (enabled when today's list is locked and unreviewed), "Plan tomorrow" /
  "Edit tomorrow".

## Planned — Step 4b (Pomodoro), agreed 2026-09-03

Nikhil's addition. On by default with one switch to turn it off; after a break the next
pomodoro waits for a tap; interruptions are recorded as facts, never voided or penalised;
on Android the timer is exact only while the app is in the foreground (no exact-alarm
permission). Countdown on the active card and in the popover, never in the tray title.
Silent banners: "Pomodoro done. Take 5?" (Take 5 · One more), long break after four.
Pomodoros annotate sessions; sessions remain the single truth for focus time.
- **Notched MacBooks can hide the title.** macOS hides any status item that would land in
  the notch zone, and the newest item is placed leftmost. On Nikhil's 13" MacBook the
  existing items leave roughly 65 points free, so `Six · plan today` (about 95) and an
  active-task title (up to 180) are hidden until other items are removed, while the app
  itself sets the title correctly (verified in the log). Options if it bites: hide other
  menu bar items, use an external display, or a compact style (`1/6`) as a Settings choice
  in Step 5. The popover and menu were verified with a temporarily shortened title.
- **Popover focus grace.** The status item takes key focus back for an instant after the
  click that opens the popover; a blur within 600 ms of showing is ignored and focus is
  re-asserted once after 150 ms. Without this the popover closed itself immediately.
