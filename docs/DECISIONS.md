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
