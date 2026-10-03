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

## 2026-09-06 — Clarity pass (1.3.0): say which clock is doing what

A UX brief (a comparison of Things, Session, Flow, Focus and HazeOver against the v1.2.0
screenshots, plus Apple and W3C guidance) asked for one thing: that the active task, the
recording state, the pomodoro and the consequence of the next click be readable at a
glance, without expanding the product. What changed, and where it touches a decision:

- **The two clocks are named.** The active card reads "42m recorded on this task" and,
  under it, one sentence per state: "No timer running." with the start link; "Pomodoro ·
  12:08 left"; "Pomodoro finished. Task time is still recording."; "On a break · 3:12
  left. Task time paused."; "Break over. Task time is paused until you resume."; "Paused.
  Task time paused." Rust now reports the break the paused task is on (`break` on the
  snapshot, `on_break`/`break_remaining` on the elapsed poll); the break countdown is
  Rust's reading, polled like the pomodoro's. A screen reader hears the state sentence on
  a change and never the ticking numbers.
- **Buttons say what they will do**, with the configured durations: "Take 5" / "Take 15",
  "Another 25 min", "Continue without timer", "Mark complete", "5 more minutes". The
  ring's three answers are one group per surface (the card's box, or the nudge), never
  duplicated below it; "Continue without timer" on a ring answers it in Rust
  (`acknowledge_pomodoro`) rather than snoozing a check-in.
- **The popover is one composition.** With a nudge showing, the nudge holds the actions
  and the task shrinks to its title and clocks; without one, the task, its clocks and one
  action row. The window fits its content (`size_popover`, 160–440 points) instead of a
  fixed 280. SPEC §4.11's "about 320×220" becomes "320 wide, as tall as its content".
- **The ceiling reads as permission.** "Choose up to six. Fewer is fine." beside the
  planner's save; a non-persisted example in the first row; at the first lock, the day
  view says task 1 started recording and a pomodoro is optional; the guide says the same.
- **Commitment is visible.** The review shows its date and where carries go, lists what
  tomorrow already holds, and the committing button reads "Save review & plan tomorrow"
  with a line saying cancelling the planner keeps the review. Saves are confirmed with a
  quiet line at the bottom only after Rust reports success ("List saved.", "Review
  saved.", "Trimmed. 1h 50m kept."); a failure keeps the input on screen.
- **Recorded time is described honestly.** The review's card is "Possible gap": "No
  interaction was recorded in Six from 10:10 to 13:30. You may have been working
  elsewhere." with the full date when a gap crosses midnight, "5h 20m recorded. Trimming
  keeps 1h 50m.", and a labelled kept / gap / kept line drawn from Rust's timestamps.
  "Trim to 1h 50m" and "Keep as recorded" stay equally weighted; nothing is subtracted
  on its own.
- **Readable and reachable.** Anything clickable is stone-500 or darker (stone-400 and
  stone-300 are for decoration and struck-through text only; CLAUDE.md's palette note
  says so now). Keyboard focus has a visible ring. Settings lists the shortcuts.
- **Prototype, off by default:** a thin monochrome line under a running countdown,
  showing what remains of that pomodoro (Settings → "Line under the countdown"). It is
  never a share of the day's work. Kept as an option for the friends test; removed if it
  does not earn its place.

Not done, by design: no seventh task, no set counters or six-dot rails, no mascots or
animation, no new permissions, no changes to routing, silence, the skip ladder or the
tomorrow-list policy.

## 2026-09-06 — Design critic loop (step 11): the day view as a set page

Seventeen iterations of the day view, each rendered offline (WKWebView harness, 480 wide)
and scored by a fresh Fable 5.1 critic that saw only the screenshot. Scores ran 4 → 5 → 6
(×6) → 5 → 6 → 7 → 7 → 6 → 6 → 7 → 7 → 7 → 6. From iteration 10 on the critiques
contradicted one another on the remaining points (centre the list vs. top-anchor it; timer
in the serif vs. the sans; the track above vs. below the timer; History in the serif vs.
the sans; check vs. fade vs. strike for done), so the design settled on what every critic
agreed on. What changed, and where it departs from SPEC §3 / CLAUDE.md:

- **Ground.** `--color-paper` (#f6f3ee) replaces stone-50 on the page, the popover, the
  sheets and the notice bars. The stone greys read as ink on it.
- **The window is the page.** Main window 480×560 (was 760). The day view sits at the
  page's optical centre: free space splits one part above the list, two below. Masthead
  is the date alone (serif 15, stone-600). "History" and the hover-revealed "Edit" moved
  to the footer line, right, in the serif at 12 (stone-400); the footer's own sentence is
  serif 12, stone-500. Margins are symmetric around the whole block, numerals included.
- **The list.** Hanging serif lining numerals in a 40pt gutter, right-aligned 12pt from
  the text edge, tabular. 32pt row pitch. Pending rows stone-600 with stone-500 numerals;
  done rows stone-500 with a stone-400 numeral and the completion time in serif figures at
  the right edge, no strike-through; deferred and skipped rows stone-400 with their tag.
- **The active block.** Title 20px regular ink; the note on its own 12px line (stone-500;
  today's recorded time stands in when there is no note); one utility line at 12px with
  the clock in tabular figures at the text edge ("12:07 left": ink digits, faint word)
  and the verbs right-aligned at 24pt gaps (Complete in ink, the rest stone-500), wrapping
  under the clock when they do not fit; while a countdown runs, a 1px full-measure
  hairline tight above that line, elapsed in stone-400 on stone-200. No box, no borders.
- **Verbs.** "Pause" (a break; the tooltip and aria label carry its length) and "Resume";
  "Defer". Shortcut hints left the page; ⌘↩ and Space live in tooltips and aria labels.
- **Tokens.** Radii 6 (card) / 4 (control), from 12 / 8. `text` and `link` button
  variants at 12px regular; `primary` 30px high at radius 6. Durations read "42 min" and
  "1 h 15 min" in Rust (`timing::describe`) and TS (`duration`). Nudge answers say
  "Break N min". The countdown line defaults on.
- **Rules bent, on purpose.** The day view uses weight 400 only (500 stays on `primary`
  and `secondary`). "Serif for numerals and headings" becomes: the serif is the app's own
  voice (date, numerals, footer, navigation); the sans is the user's words and the
  controls. CLAUDE.md's design lines are updated to match.

Verified: `cargo test` 127 passing; `pnpm typecheck` clean; harness renders of every
seeded state checked at 480×560. Open: the critic never went above 7/10 (the brief asked
for 9); the planner is cramped at 560 and scrolls under its save bar; the real-app atlas
in `Six atlas 1.3.0/` predates this pass. Released only on Nikhil's "go".

## 2026-09-06 — Step 12: the planner in the same shape, 1.4.0

Nikhil chose to accept the day view at the critic's 7/10 and release. The planner was
the one screen the 560-high window broke, so it now shares the day view's shape: the
date as a serif running head with the screen's label and "Cancel" on its baseline, six
rows with a hanging numeral as the drag handle, no cards, the note field only when a row
has a note or asked for one, and the row's controls (note, up, down, clear) shown while
the pointer is over the row or a field in it has focus. The save bar is solid paper, no
blur. Six rows with one note fit at 480×560 with the bar in view. Version 1.4.0. The
atlas in `Six atlas 1.4.0/` is rendered from the harness (see its README), not captured
from the installed app. Still open: the review and settings screens keep their large
serif headings and cards; they scroll at 560 and were left alone.

## 2026-09-07 — Step 13 (1.4.1): the window is a card; History in every state

Nikhil maximised the window and found a small column floating in a large field. Six's
window is a card, not a document, so it no longer maximises: `maximizable: false`, with
a size range of 360×520 to 560×760. Type never scales with the window; the day view keeps
its optical centre at any height in that range.

He also found History gone. The footer line that carries it had been placed inside the
"today's list is locked" branch of the day view, so the morning before planning and the
evening ritual had no way to History. The footer line now renders in every state:
tomorrow's line on the left once the list is locked, History (and the hover-revealed
Edit, when locked) on the right. Footer links are stone-500, per the clarity pass's rule
that anything clickable is stone-500 or darker; the earlier stone-400 broke it.

## 2026-09-07 — Step 14: the visual refresh (presentation only)

A visual design pass under a brief that fixed the rules: keep the stone/amber palette and
the amber restrictions, the light appearance, serif numerals and headings, the system sans
for body text and the single column; change composition, spacing, density, type scale,
alignment, separators, grouping and component presentation; change no behaviour. Three
roles: this pass implemented, a fresh Fable 5.1 critic reviewed rendered screenshots
(three rounds, the third scoped to five named elements), and a separate Fable 5.1 reviewer
compared the changed code with commit dadc5e5 for altered behaviour. Rust is untouched
(127 tests), as are the store, the API wrappers, the shortcuts and the types.

Two directions were rendered from the same seeded data for the day screen and the tray
panel. **A, the editorial ledger** (typographic hierarchy, hairline separators, a strong
current-task block) was chosen over **B, the compact instrument** (28pt rows, a two-cell
meter with caps labels and large serif figures). B's only advantage was bigger clock
figures; it paid with a third type voice and an instrument-panel feel, and its current
block was less distinct from the rows. A is carried through every screen.

The visual system, and where it amends SPEC §3 / the 2026-09-06 entries:

- **Structure.** Every screen opens with a masthead on one baseline: the screen's own line
  in the serif at 15 (the date, "Evening review", "Last 30 days", "This week", "Settings",
  "Six") and, at the right, either a serif 13 fact ("1 of 6 done", "2 of 3") or the sans 12
  navigation (Cancel, Back, Day · Stats · Settings). A stone-200 hairline closes the
  masthead; another sits above the footer line. Lists hang their serif numerals in a 40pt
  rail, right-aligned 12pt from one shared text edge (72pt from the window's left), on
  every screen that lists tasks: the day, the planner, the review, history, the tomorrow
  preview.
- **The current task** is the one bounded block on the day screen: an ink (stone-900)
  rule above and a hairline below, across the whole column, rail included. Title 20 in the
  sans, the note at 13, then one 13pt line naming both clocks: "Task time 45 min" at the
  text edge, "Pomodoro 12:07 left" (or "Break 3:12 left", "Pomodoro finished", "Pomodoro
  not running", "Break over") at the margin, the live value at weight 500. While a
  countdown runs, a full-measure stone-300 hairline under that line carries what remains
  in ink, anchored under the clock it measures; a timer that has ended leaves the empty
  track. A rung pomodoro's two answers sit on their own line under the clock. One filled
  28pt button is the primary action (Complete, or Resume while paused); Pause, Defer and
  "Start a pomodoro" are 13pt text.
- **Rows** keep the 32pt pitch: pending stone-600, done stone-500 with the completion
  time in serif figures at the right edge, deferred and dropped stone-500 with their tag.
  The same "done" language repeats in the review, history and the tomorrow preview.
- **Surfaces.** No cards remain on the day, planner, review, history or settings screens;
  groups are hairline-separated (Settings rows, history days, the review's unfinished
  tasks). The review's "Possible gap" is a block bounded like the current task (ink rule
  above, hairline below). Text fields keep a white ground and a stone-200 hairline at
  radius 4; the planner's fields show a resting hairline across the full measure so an
  empty row reads as a place to type, with the placeholder at stone-400. Carry/drop is a
  segmented pair (stone-300 border, the chosen half on stone-200) so the committing button
  is the only filled button on the panel.
- **Transient messages.** The in-window banner is a full-width paper strip with a hairline
  below, its first answer in ink text and the rest grey, so the current task keeps the
  only filled button on screen. The tray's banner strip keeps one small filled answer,
  because there it holds the only actions. The skip-ahead sheet opens under a 2px ink rule
  with a serif 20 title and a "1 of 3" count in place of the dot rail.
- **The tray panel** uses one task row in every state: numeral 22, title 15, then the two
  clocks as a label/value ledger with the same track, then a rung pomodoro's answers, then
  Done (filled, 28pt) with Resume, Pause, Defer and the start link as text. Under a nudge
  the row shows without its actions. Footer: "Open Six" and the count in serif 12 above a
  hairline.
- **Type scale:** 22 (empty-state and guide headings) / 20 (current title, panel titles) /
  15 (rows, body, masthead) / 13 (facts, controls, notes) / 12 (meta, navigation, footer) /
  11 caps (section labels). Weights 400, with 500 on filled buttons, the live clock value
  and the banner's first answer. Contrast on the paper ground: stone-900 15.8:1, stone-600
  6.9:1, stone-500 4.3:1, amber-700 4.5:1; stone-400 (2.3:1) is decoration only, so status
  words, tags, completion times and sub-facts moved to stone-500.
- **Motion.** A `prefers-reduced-motion` rule makes the short fades and the track's
  easing immediate.

Amendments recorded, not silently made: SPEC §3's white cards with hairline borders and
the active card's 2px border become hairline groups and an ink rule; the 12/8 radii stay
at the 2026-09-06 values 6/4; SPEC §4.1's centred empty-state headline is now left-aligned
under the masthead at 22, not 30; the planner's cards became rows on 2026-09-06 and now
carry resting field hairlines; the tray's "elapsed time" line is the same two-clock ledger
as the window.

Critic rounds and their outcome: round one asked for the ring's answers on their own line,
the banner without a filled button, resting hairlines under planner fields, the track
under the clock it measures and carry/drop without stacked primaries; all done. Round two
asked for one track rule on both surfaces, a stronger ring mark, the banner built like
the tray strip, one right-aligned status string per row and one tray task row; done,
except that round three then reversed the banner's filled button (it returned to text)
and the track's anchoring (now right). Round three's request for "finished" in amber was
declined: SPEC §3 reserves amber, and the active task may not carry it. Its
word-boundary truncation request needs measurement in the view and was left.

Regression review: the reviewer confirmed every action handler, payload, shortcut, the
skip ladder's hold, hover/focus parity, accessible names and live regions, the popover's
self-sizing and that no timing moved into the view. It found three slips, all fixed: the
tray had lost the completed-pomodoro dots and hidden its clocks from assistive
technology; the window's dots vanished in two states; the carry/drop group clipped the
focus outline.

Verified: `cargo test` 127 passing; `pnpm typecheck` clean; every seeded state rendered
in the harness at 480×560 and the tray at 320 (before and after, in the deliverable);
the refreshed debug bundle run under an isolated home with its database identity
confirmed by `lsof`, where Space paused and resumed the task in that database, and one
native capture of the running state taken by window id. That capture showed the window's
560 points include the title bar, so the true viewport is about 532 and the day view had
grown a few points too tall with a pomodoro running; the list's two spacers lost 12
points and the tightest states were re-checked at 480×532 in the harness. Not verified
natively: the popover and the 532 fit (the scratch window came up at another frame on
the second run); not verified at all: VoiceOver's reading of the "2 of 3" counters, and
the planner control overlay against a 140-character title. Excluded from this pass, as behaviour:
hiding the current task's actions while a banner is up; splitting the check-in's
duration into a second line (nudge copy lives in Rust); word-boundary truncation.
Not released; version unchanged.

## 2026-09-07 — Step 14b: tested on the Mac before any release

Nikhil asked for the refresh to be tested for real before shipping. The final commit was
built as a debug bundle and run as a scratch copy under an isolated home with seeded
data (its process and database paths confirmed by `lsof`; the installed Six and its
database were never touched), and driven through the screen with the pointer and the
keyboard while the installed app kept running beside it.

Verified on the real build, with the database read after each step: hover-revealed row
controls (start, skip ahead, undo, Edit) and their focus rings by Tab; Pause and Resume by
click and by Space; a break interrupting the pomodoro; Start a pomodoro; Complete with
the next task activating; undo; Defer with the slot handed back; the skip-ahead ladder
by pointer, ending in the 1.5-second hold, and again entirely by keyboard, ending in a
held Return, each logging one override; Escape leaving the sheet; ⌘E into the planner,
typing, the note affordance, reordering by chevron and by dragging the numeral, Save
("edited after locking" and the notice); ⌘N and ⌘,; History, Stats and Settings, a
number field and the switch saving; the window clamping to 360×520 and 560×760 and the
layout at both; the finished-pomodoro state with its answers, and "Continue without
timer"; Six's own banner under the menu bar on break-over, opened while the window was
hidden, with Resume acting from it; the evening review end to end (trim, reflection,
carry/drop with a visible focus ring, save, tomorrow's planner, cancel keeping the
review); the first-run guide into the first planner.

Three things the run surfaced, all fixed here: the first-run guide's second screen no
longer fits the real viewport once it gained a masthead (its spacing is tightened so both
screens fit at 532); the "Line under the countdown" switch had had no effect since the
line became part of the timer on 2026-09-06 (it now controls the track in the window and
the tray; the default stays on); rows in the review and history showed "0 min" for
recorded time under a minute (now shown only from a minute up).

Not testable on this Mac: the tray item itself, which the notch hides for the newest
status item (the popover was exercised through the break-over banner instead, and in
the harness); and reduced motion, which needs a system setting.

## 2026-09-19 — Step 16: four brittle spots fixed; TypeSafe explored, outside the app

Nikhil asked where TypeSafe (hosted System One judgments: Noul, Choice, Score) could
stand in for fragile code, and then what it could add to make Six more useful. The
codebase was surveyed against TypeSafe's own first rule, "use code when you can".

**Fixed in code, because none of it needed judgment.**
- The scheduler chose the long-break notification set by comparing a button's label to a
  string it formatted itself; `nudges::break_label` and `another_label` are now the one
  source of that wording for the nudge planner and the scheduler.
- The notification permission word was a lowercased `Debug` string (which would have sent
  "promptwithrationale", a word Settings does not know); it is an explicit match now.
- The tray title was cut mid-word at 28 characters, and 14 of the 17 titles in the owner's
  database are longer than that. It is cut at the end of a word when that keeps at least
  12 characters, never left hanging on a connecting word ("and", "to", "with"…), and a
  single long word is still cut where it must be. SPEC §4.11's 28-character limit holds.
- The home-folder regex appeared four times in the view; it is `format.ts`'s `tildePath`.

**Where judgment would help, ranked.** (1) A planning coach at the evening ritual: is a
row two tasks in one, does it have a clear finish, is it a duplicate of another row in
different words. A search for " and " cannot do the first: 8 of the owner's 17 titles
contain it, some one task and some two. (2) A check-in interval sized to the task instead
of one global 75 minutes, which makes the app nag less on deep work and sooner on a
five-minute call. (3) A weekly fact about the kind of work done. (4) A tray title chosen
from code-made candidates. Not recommended: ranking tasks by importance (the model cannot
know what matters to the owner), anything that generates text, and judging an idle gap
(there is no evidence to judge).

**Why none of it is in the app.** TypeSafe is `POST https://api.typesafe.ai/v1/systemone`
with a bearer key. Six promises no network requests of any kind (SPEC §2, the README, a
CSP that blocks all connections, no HTTP client in the Rust core), the task titles are
private, and the working rules forbid creating accounts or handling credentials. So the
work is a bench beside the app, `tools/typesafe-eval/`: one fan-out request per list, the
policy in code (one hint per row at most), synthetic lists by default, a local stand-in
server and a self-test that needs no key. It is not bundled, not run by CI and never
reads Six's database. No live TypeSafe call has been made; whether the judgments are
good enough is exactly what the bench is for, with the owner's key and the owner's say.

Verified: `cargo test` 127 passing with the new truncation cases; `pnpm typecheck` clean;
`node tools/typesafe-eval/selftest.mjs` passing. Version unchanged; not released.

## 2026-10-03 — Audit, and step 18 (Tier 1): the quick wins

An audit of 1.5.1 (read-only; aggregate counts from a copy of the owner's database, no
titles) found the app unused since 7 September, three planned days in all, no review ever
recorded, and three things wrong in the repository itself. Nikhil asked for all three
tiers of the enhancement plan, one at a time. This is the first.

- **The streak is back.** The planning streak (SPEC §4.1, §4.6: the one counter Six
  keeps) stopped being shown in step 11, when the masthead became the date alone; Rust
  kept computing it and no entry recorded its removal. That was an undocumented
  regression. It returns to the masthead, right, before the count: the flame and the
  number in `amber-700`, only when the streak is above zero, named for assistive
  technology ("Planning streak: 3 days in a row with a locked list").
- **A harness that lives in the repo.** The stand-in core and the screenshot renderer
  behind every visual check since step 10 lived in a temporary folder, and were gone.
  `tools/harness/` holds them now: `mock-tauri.js` (a fixed clock, ~35 seeded scenes),
  `serve.mjs`, `render.swift` (an offscreen WKWebView, works with the screen locked) and
  `shots.mjs`. Renders are 480×532, the window's real content area. Not bundled.
- **View logic has tests.** What the clocks say (`lib/clocks.ts`), when a queued nudge
  still applies and which nudge an OS notification was (`lib/nudgeRules.ts`), and where
  "back" leads (`lib/nav.ts`) are pure modules with tests in `tests/`, run by Node's own
  test runner (`pnpm test`; no new dependency) and by CI. This amends the working rule
  "Frontend: type-check only" to "type-check, plus tests for pure view logic".
- **The planner takes the keyboard.** Return moves to the next row, Option+↑/↓ moves the
  row and the focus with it (title or note, whichever held it), Cmd+Return saves or
  locks from anywhere on the screen. A Return that commits text from an input method is
  left to the input method. The day view's Cmd+Return (complete the active task) now
  ignores a key another handler has taken, the repeats of a held key, and anything
  pressed while a dialog is open: without those, one long Cmd+Return could save the list
  and then complete the active task on the day view it returned to, and Cmd+Return on a
  button of the skip-ahead sheet completed the task behind the sheet.
- **Esc goes back** from History, Stats and Settings (never from the planner or the
  review, which hold unsaved input). **P starts a pomodoro** on the active task. Settings
  and the README list every shortcut, including Cmd+Return and Cmd+E, which were missing.
- **A task changing state fades in** over 180 ms, the transition SPEC §3 asked for and
  the list never had. The fade plays when a task takes the current slot or leaves it
  (started, completed, deferred, dropped); pausing is not such a change, and an undo that
  returns a row to the list keeps the row, so the keyboard focus stays on it. The fade is
  applied only while the page is on screen, so a row made while the window is hidden
  cannot wait at zero opacity.
- **The ring state fits.** A rung pomodoro pushed the footer 12 points below the window's
  532; the list's two flexible spacers give those points back when the page is tight.
- **Housekeeping.** Four unused exports are gone (`TimerLine`, `recordedClause`,
  `breakLabel`, `CalendarIcon`). The release workflow runs the view tests and uses the
  current major versions of its actions (checkout 7, setup-node 7, upload-artifact 7,
  pnpm/action-setup 6; their notes show no change to the inputs used here; the next
  release run is the proof).

Left alone on purpose: the OS-notification path still sends no task id with a button
press, so the stale-task guard does not apply there. The plugin can carry one (`extra`),
but macOS ignores notifications from ad-hoc builds, so the change could not be tested on
any build this project ships.

Verified: `cargo test` 127 passing; `pnpm typecheck` clean; `pnpm test` 21 passing; every
harness scene rendered before and after; the keyboard paths driven in a browser against
the harness (Return, Option+arrows, Cmd+Return in the planner without touching the active
task; P, Space, Cmd+Return on the day view; Esc from Stats, Settings and History).

An independent review of the step then found nine things, all in the keyboard paths; the
ones that were faults are fixed in step 18b and the wording above describes the result.

## 2026-10-03 — Step 19 (Tier 2): what a daily habit needs

The audit's plainest finding was that Six had not been opened since 7 September: nothing
starts it, nothing summons it, a day that ends without its review is never offered one
again, and three long sessions had been closed by the day's rollover with their silences
never looked at. This step is about those four things, plus a place for a stray thought
and a copy of the database. Everything here is additive; nothing that worked before
changed its behaviour, and every new switch is off until chosen.

- **Open Six at login.** Settings → This Mac. Off by default. `tauri-plugin-autostart`
  2.5.1 writes one LaunchAgent, `~/Library/LaunchAgents/com.nikhiljois.six.plist`, and
  removes it when the switch goes off. The answer is macOS's, read from macOS each time
  Settings opens; it is not a row in Six's settings. A login launch is an ordinary launch:
  the window shows, because the point is to have the list in front of you.
- **One shortcut from anywhere.** Settings → Keyboard → "From anywhere": Off (the
  default), Option+Cmd+6, Control+Option+6 or Control+Option+Space. It shows Six, or sends
  it back to the menu bar when it is already in front. `tauri-plugin-global-shortcut`
  2.3.2. A short list and not a recorder, so the choice is always one macOS can register;
  a combination another app holds is refused with a sentence and the previous one keeps
  working. It needs no permission.
- **A day that ended without its review can still have one.** The snapshot carries
  `unreviewed`: the last locked day before today, when it has no review and is at most a
  week old (`domain/review.rs`). The screens that show no list for today offer it in one
  line ("Yesterday was not reviewed. Review it"); History offers "Review this day" on any
  unreviewed past day, of any age. How such a review runs is `lib/reviewFlow.ts`: today's
  review is unchanged (three screens, ending in tomorrow's planner); a past day's never
  plans anything and returns to where it was opened; it asks carry or drop only while
  that day is still the latest locked list, because only then does the answer change
  what the next planner is given. Once a later list exists it is one screen. Rust's
  `complete_review` is unchanged: tasks left open are recorded as carried, which is what
  happened to them (an unreviewed day's unfinished tasks have always been offered to the
  next planner).
- **A silence is offered when you come back.** SPEC §2 says a long silence is recorded
  and the review offers to take it out, and that Six never subtracts time by itself.
  Both still hold. What is new is the moment: the snapshot carries `return_gap`, the
  unanswered silence on the running session, and the day view shows it in the banner
  under the title bar with two answers, "Take 4 h 14 min out" and "Keep as recorded". It
  is the day's state, not a nudge: it is not scheduled, makes no sound, and stays until
  answered. Keeping is remembered on the session (`sessions.idle_ack`, migration 0005),
  so the same silence is not offered twice; the evening review still lists it. One limit,
  inherited: a session keeps only its longest silence, so a second, shorter one after a
  kept one is not offered.
- **Parked thoughts ("Jot").** J, or "Jot" under the list, opens one line; Return keeps
  it. It is stored with the day and the task in hand (`jots`, migration 0006; 200
  characters, 30 a day), read back in the evening review ("Parked thoughts", each
  removable), shown in History when a day is open, and included in both exports. It is
  never a task and nothing converts it into one; that control was left out on purpose.
  This is not the "quick add" the audit brief asked for, which SPEC §2 rules out (the six
  are chosen deliberately, in the planner). A thought that matters tomorrow reaches a
  list by hand. Jots are read with the `Day` and written by their own commands;
  `save_day` never touches them.
- **A daily copy of the database.** Once per calendar day, at startup or on the first
  tick of a new day, Six writes `backups/six-YYYY-MM-DD.db` beside the database
  (`VACUUM INTO`, a consistent copy while in use) and keeps the newest seven. No switch.
  A failure is logged and nothing else notices.
- **Smaller things.** The carry-over line wrote a weekday in lower case ("from thursday,
  oct 1"); it now reads "from Thursday, Oct 1". The harness renders retry when WebKit's
  snapshot fails on a starved machine, take a batch size, and have scenes for everything
  above.

New dependencies, both official Tauri plugins, both pinned so Tauri itself stays at
2.11.5: `tauri-plugin-autostart =2.5.1`, `tauri-plugin-global-shortcut =2.3.2`. Privacy
is unchanged: still no network, no accounts, no telemetry. The README says where the two
new files live (the LaunchAgent and the backups folder).

Not built, from the audit brief, because recorded decisions rule them out: a per-second
countdown in the menu bar (SPEC §4.11: the title changes on state, not on time), quick
capture of tasks, progress rings and glows, estimated-against-actual pomodoro counts and
velocity trends (SPEC §2: facts, not gamification).

Verified: `cargo test` 144 passing (17 new: the return offer and its answer, parked
thoughts, a late review, the shortcut setting, the backup, the store round trips);
`pnpm typecheck` clean; `pnpm test` 24 passing (3 new, `reviewFlow`). All 44 harness
scenes rendered; against the step 18 renders, 21 are pixel-identical and the 12 locked
day scenes differ only by the new "Jot" link in the footer. In a browser against the
harness: J opens the field without typing a "j", Esc and an empty blur close it, Return
saves and trims, Space in the field leaves the task alone; both answers to the return
offer; a late review from the morning screen through carry or drop and back. Natively,
on a scratch copy under its own home folder: the build starts on a seeded database, both
migrations apply, the daily copy is written to the scratch home, Option+Cmd+6 registers
at startup, and a stored shortcut outside the list is ignored. Not verified natively:
clicking through the new screens in the real window (the screen was locked during this
step), which includes the login switch writing its LaunchAgent. That pass is owed before
a release.

## 2026-10-03 — Step 20 (Tier 3): facts, minutes, sounds, and a dark appearance

Four things from the third tier. Each is either read-only over data Six already keeps or
a setting that defaults to how Six has always been. Two of them amend the brief.

- **Three facts the data already held.** Stats gains "Days reviewed" (of the days
  planned), the pomodoros that were interrupted (under the count, only when there are
  any; one finished early with its task is neither), and "Done by position": for each of
  the six positions, how many times a task in that place got done over the last 30
  days. That last one is the method's own question (do the lists stop at three?). All
  three are computed in `domain/analytics.rs` and added to the text export. Still not
  built: estimated against actual pomodoros and velocity trends (SPEC §2).
- **Minutes left in the menu bar (amends SPEC §4.11).** §4.11 says the title changes on
  state, never per second. That still holds by default. Settings → Menu bar → "Minutes
  left" adds the whole minutes left of a running pomodoro (`2/6 · 18m · Draft…`, or
  `2/6 · 18m` compact) or of a break (`Six · break 3m`). They sit beside the position,
  where a crowded menu bar clips last, and are rounded up, so "1m" is the last minute.
  The 15-second ticker brings the title in line without broadcasting anything; the title
  is only set when it changes, so it changes once a minute. Never per second.
- **Three sounds, three levels.** Sound stays off by default. Switched on, Settings
  offers Two notes (the original), Bell and Knock, at Soft, Normal or Loud; choosing one
  plays it. All are a few oscillators (`lib/soundPlan.ts`); nothing ships and nothing is
  loaded, so custom sound files are still not offered. A test pins "Two notes, Normal" to
  the exact numbers Six has always used.
- **A dark appearance (amends SPEC §3).** Settings → This Mac → Appearance: Light (the
  default), Dark, or Follow macOS. The palette is unchanged in role: `styles.css`
  redefines the eleven colour variables under `data-theme="dark"` (paper #1b1917, ink
  #ece8e1, secondary #a39c93 at 6.5:1, amber lifted to #e2a04a) and no component names a
  dark colour. Two things had to change for it: the Stats sparkline took a hard-coded
  ink and now takes the current colour, and the veil behind the skip-ahead sheet darkens
  instead of lightening. Rust makes the window frames dark for "Dark"; for "Light" and
  "Follow macOS" the frame is left to macOS as it always was, so a Six that never touches
  the setting looks exactly as before (on a Mac set to dark that means a dark frame over
  the light page, which is what it had). The last setting seen is remembered by the web
  view so a window opens in the right appearance before Rust has answered.

Verified: `cargo test` 149 passing (5 new); `pnpm typecheck` clean; `pnpm test` 28
passing (4 new: the sound plan and the appearance rule). All 44 scenes rendered light and
dark. Light: 37 are pixel-identical to step 19; Stats differs by its new facts. Dark:
every screen read through on contact sheets (day, planner, review, history, stats,
settings, first run, the sheet, the menu bar panel). Not verified natively: the frame
following the setting, the menu bar minutes ticking, and the sounds by ear (the screen
was locked); owed with the Tier 2 pass.

