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

## 2026-09-03 — Step 4b (Pomodoro), Nikhil's addition

Agreed terms. On by default with one switch to turn it off; after a break the next
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

Implementation notes:
- One pomodoro at a time, only on the active task. It rings at `started_at + planned`
  exactly, whenever the app next looks (every read settles rings, like the rollover; the
  elapsed poll broadcasts the change while the window is focused). Step 5 adds the banner.
- Leaving the active slot ends the pomodoro: `finished_early` on completion, `interrupted`
  for a break, defer, skip-ahead, day end, or an idle trim, unless it had already rung,
  in which case it is `completed` at its planned end and the transition answers the ring.
- "Keep going" answers a ring without starting anything; "One more" starts the next and
  answers the last; a break pauses the task as before. Nothing starts by itself.
- The long break is offered after every `pomodoros_before_long_break` completed
  pomodoros of the day, counted across tasks.
- The tray title is unchanged (no countdown, no count): it is already too long for a
  crowded notched menu bar. The popover carries the countdown and the dots.
- Settings: `pomodoro_enabled` (1), `pomodoro_minutes` (25), `long_break_minutes` (15),
  `pomodoros_before_long_break` (4). The switch lands in the Settings screen in Step 5.

## 2026-09-03 — Step 5

- **Nudges are planned in Rust, delivered two ways.** `domain::nudges::plan` (pure, tested)
  returns at most one pending nudge per kind. The scheduler keeps the OS in line with that
  list (cancel and re-schedule only when a time or text changes) and, while the main
  window is focused, cancels the OS copies and shows in-app banners instead, so nothing
  fires on top of an open window (SPEC §4.10). Focus changes re-sync both ways.
- **Six kinds.** The five from the brief plus `pomodoro_done` (Take 5 / Take N after a set ·
  One more). The check-in yields while a pomodoro is running: three pomodoros are the
  75 minutes anyway. Past-due nudges are not re-fired; "Later", "Keep going" and "5 more"
  are session-only snoozes.
- **Actions go through one command.** OS buttons (via the plugin's listener in the main
  window) and banner buttons both call `nudge_action(kind, action)`; nothing else knows
  what a button does.
- **Notifications need the bundle.** The plugin's native macOS path refuses to run outside
  a `.app`, so `lib.rs` registers it only when bundled; `pnpm tauri dev` shows a line in
  the log and keeps the banners. Settings says "Unavailable in this build" there.
- **Timed flips.** A 15-second ticker republishes when the business date or the evening
  phase changes, so the tray and the window follow the clock without a long-lived timer
  per event (SPEC §5.4).
- **Stats.** "This week" is Monday to Sunday; the trend is the last seven days. Export
  writes `six-<from>_<to>.txt` and `.json` (and `six-all-<date>.json`) to `~/Six/exports`.
- **Settings additions.** The pomodoro switch and lengths, and `tray_style` (`full` |
  `compact`) for notched menu bars. Sync shows "Not set up" until Step 6.
- **Ad-hoc signing needs a stable identifier.** Tauri's ad-hoc signature carries a random
  code-signing identifier (`six-<hash>`); with that, macOS refuses the notification
  permission request outright (UNErrorDomain 1) and shows no prompt. Re-signing the bundle
  with `--identifier com.nikhiljois.six` (see `pnpm sign:adhoc`) fixes it. Step 7 makes
  this part of packaging.

## 2026-09-03 — Mac only (Nikhil's decision)

Android and Supabase sync (SPEC §5.5, Step 6) are dropped. Six is a single-device macOS app.
The `sync_queue` table from migration 0001 stays, empty and unused; `device_id` and
`updated_at` stay on every row. The Settings screen no longer shows a Sync section, and
the pomodoro "foreground-only exactness on Android" note is moot.

## 2026-09-03 — Step 7 (packaging)

- `pnpm build:mac` runs `tauri build` (release, `.app` only) then re-signs ad-hoc with the
  stable identifier `com.nikhiljois.six`, which macOS notifications require.
- App icon: a serif "6" on stone-50 with a hairline stone-200 border, generated from an
  SVG via `pnpm tauri icon`. Nothing else decorative.
- Version 1.0.0. Minimum macOS 13.

## 2026-09-03 — Public release polish (Nikhil's request)

Assessed against the app as built; adjusted where the request assumed a different stack.
- **Local-first:** already true. Migration 0003 drops the never-used `sync_queue` table and
  the docs stop mentioning sync. A strict content security policy is set.
- **Sound:** conflicts with SPEC §2 ("no sounds, ever"), so it is a Settings switch, off by
  default: the system sound on the pomodoro-done and break-over notifications and a soft
  synthesised two-note chime on the in-app banner. Nothing else ever sounds.
- **Shortcuts:** Space toggles the active task between running and Take 5 (never while
  typing); Cmd+N opens the planner for the next unplanned day, not a quick-capture box,
  which would break the six ceiling; Cmd+, opens Settings; Cmd+W is the native Close
  Window, which hides to the menu bar.
- **Menu bar countdown:** already in the popover. A ticking title is ruled out by SPEC
  §4.11 (state change only) and by crowded notched menu bars.
- **Six ceiling, rollover, review, archive:** already built (Steps 1 to 3).
- **First launch:** a two-screen guide, stored as the `onboarded` setting, with an optional
  "Allow notifications" button, ending in the planner.
- **Distribution:** audit found no personal paths, secrets or test data; the CI release is
  now a universal binary; README rewritten for the public, with the Gatekeeper steps.

## 2026-09-03 — Nudges: Six's own banner by default

Finding: with an ad-hoc signature, macOS accepts the notification request, reports the
permission as granted, schedules without error, and then never shows anything; the app
never appears under System Settings → Notifications. A Developer ID (or at least a
certificate-backed) signature is required, which a free public build cannot assume.
Second finding: the plugin's Rust `Schedule::At` serialises nine fractional digits while
its Swift side parses exactly three, so even signed builds may need the `Interval` form.
Decision: nudges are delivered by Six itself. Focused window: banner in the window.
Window away: the popover opens under the menu bar as a banner, without taking focus, with
the nudge's buttons, and hides after 25 seconds unless the pointer is on it. The macOS
Notification Centre path stays behind a Settings switch (`nudge_style = system`) for
signed builds. The first-launch guide no longer asks for a permission.
- **Deliver before settling.** A ring that the ticker (or any read) settles is re-planned
  away before it can be shown. `scheduler::deliver_now` now runs at the start of the ticker,
  of `publish`, of `get_snapshot`, and of the elapsed poll, so whatever is due from the
  last plan is delivered first. Found by watching a ring vanish in the log.

## 2026-09-04 — Hardening after an external review

A second model reviewed v1.1.0 from the source bundle and reported fourteen code-traced
defects (its report and reproductions live outside the repo). Each was checked against
the code here; all fourteen held. What changed, and the shape it was given:

- **One operation at a time.** Commands, the ticker, interaction stamps and the
  housekeeping inside every snapshot now run under one async gate (`AppState::gate`), so
  a slow command can no longer save a copy of the day that another one has moved on from
  (two open sessions, a completed task back to active, every later save refused).
  Snapshots carry a revision; the frontend ignores an older one that arrives late.
- **A nudge acts only on the task it was about.** Banner buttons send the nudge's task;
  Rust refuses (`stale_nudge`, silent) when another task holds the slot, and the window
  drops a queued nudge as soon as a snapshot shows it no longer applies. Snoozes from
  Keep going and 5 more belong to the session or break they were given on.
- **The planner edits the list for exactly its date**, never "today's" or "tomorrow's"
  slot, and refuses to save once its date is neither.
- **Due before re-planned.** A ring that passed since the last plan is delivered from the
  old plan before the new one replaces it, on every reconcile (a focus change at the ring
  used to lose it).
- **A silence is kept, not erased.** The first interaction after more than three hours
  records the stretch on the session (migration 0004: `idle_from`, `idle_until`; the
  longest one wins) instead of overwriting the only evidence. The review offers to take
  exactly that stretch out; the work after it continues as a session of its own, still
  running if the original was. A pomodoro that ran into the silence ends there,
  interrupted, even if it had been counted as complete. `trim_session` now takes the two
  bounds of the silence.
- **Keyboard.** The last step of skipping ahead can be held with Space or Enter for the
  same 1.5 s; Escape leaves the sheet, Tab stays inside it, and the Space shortcut no
  longer fires on a focused button or inside a dialog.
- **Six's banner under the menu bar** shows one nudge at a time, each with its own spell
  on screen (the evening ritual and the end of day are due at the same minute), waits
  while the popover has focus, shows a failed action instead of hiding it, and its clicks
  count as interactions.
- Smaller: an evening hour before the day-start hour counts only the small hours as
  "after evening"; the streak no longer stops at 400 days; exports are written to a
  sibling and renamed into place; the app version is 1.2.0 everywhere and the release
  workflow refuses a tag that disagrees, runs the tests and the type-check first, and
  checks both architectures and the signature in the built app.

Declined from the same review: a gate around the OS notification sync (the OS path is
opt-in and idempotent), a broader consolidation of the command layer (the gate helper is
the whole of it), and a load-error state for History (deferred).

## 2026-09-05 — Second review: the installed app on a real Mac

A second model reviewed v1.2.0 by using the installed app with computer use, reading a
copy of the owner's database, and re-reading the code. Nine findings, all confirmed:

- **One Six per data folder.** The app takes an exclusive lock on `six.lock` in its data
  folder at startup. A second copy on the same folder (an old build still running while a
  new one is opened from Downloads) hands over to the running one (`open -b`) and exits,
  instead of writing its own view of the day over the first one's. Separate homes still
  run independently.
- **Window-addressed events are listened to per window.** Tauri hands an event
  addressed to one window to every listener that named no target, so the popover heard
  the main window's nudges and popped itself up on every foreground ring. The main
  window and the popover now listen through their own window handle.
- **A nudge acts only on its own moment.** Beyond the task check from the first review,
  a ring's buttons are refused once that ring has been answered (a new pomodoro is
  running), a check-in's once a pomodoro is running, a break's once the task resumed.
  The window prunes them on the same rules.
- **The long break is offered once per set.** It is due when the last completed pomodoro
  finished a set and no break has been taken since it ended; taking it clears it. The
  card and popover show "Take 15" whenever that is the break that would come.
- **Today's list can be edited from the day view**, as the guide promised. Removing a
  task that tomorrow's list carries keeps tomorrow's copy and only clears its lineage
  pointer.
- **Every command counts as an interaction.** The stamp used for idle detection is set
  by every mutation, not only by the once-a-minute pointer stamp, so a silence can no
  longer begin thirty seconds before the pomodoro the user started.
- **A pomodoro that only started inside a removed silence is removed with it**, and its
  row leaves the store. One that ran into the silence still ends where the silence began.
- **The review says what carry and drop can do** when tomorrow is already set: how many
  empty rows are free, that a full tomorrow takes nothing more, and that a task whose
  copy is already there is carried whatever is chosen.
- **The popover is 320×280** (was 220), so the nudge strip no longer pushes Done · Take 5
  · Defer below the fold. Settings controls are named by their visible labels for
  assistive technology. Settings' Back returns to the screen it was opened from. The
  skip-ahead sheet gives focus back to what opened it. History can retry a failed load.

Version 1.2.1.

## 2026-09-05 — 1.2.2: a ring's banner survives the instant before it settles

Seen on the owner's Mac right after 1.2.1 shipped: the pomodoro rang, the card showed
"Pomodoro done.", but no banner appeared. A ring is delivered on purpose before it is
settled, so at that instant the window's snapshot still shows the same pomodoro counting
down, and the new "answered ring" rule threw the nudge away. The rule now recognises the
ring's own pomodoro by its end time: still counting down to that same instant means the
ring is fresh; a different end time means "one more" was chosen; idle means it was
answered. Checked on the real binary and in the harness under the real ordering.
