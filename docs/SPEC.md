# Build "Six" — a native Ivy Lee Method productivity app for macOS and Android

> This is the original brief, saved verbatim as the single source of truth. CLAUDE.md is a short summary of it.

You are building a complete, personal, single-user productivity app from scratch. Read this entire document before writing any code. It contains the product requirements, the design system, the engineering architecture, and the execution protocol. Treat it as the single source of truth. Nothing else exists.

---

## 1. Who this is for and why it exists

One user: me. I run on a MacBook (Apple Silicon, M4) and an Android phone (Samsung Galaxy S24 Ultra). This is not a product for distribution. It is a tool I want to use every day for years.

The app implements the **Ivy Lee Method** (1918, Bethlehem Steel). The method has four rules and no more:

1. At the end of each working day, write down the six most important tasks for tomorrow.
2. Rank them 1 to 6 in order of importance.
3. The next day, work on task 1 until it is finished. Only then move to task 2. And so on.
4. Whatever is unfinished at the end of the day rolls into tomorrow's list.

The power of the method is what it removes: decision-making during the day, list bloat, and the illusion that a 40-item to-do list is progress. Every feature in this app must serve those four rules or the reflection that supports them. If a feature would make this a general-purpose to-do app, it does not belong here.

**The app's job is to be the friction that makes the method stick**, delivered through an interface so calm and minimal that opening it feels like relief, not obligation.

---

## 2. Product principles (apply these to every decision)

- **Six is the ceiling, always.** There is no way to add a seventh task. Not through the UI, not through a shortcut, not through an import. If something urgent comes up, the user swaps it in for an existing task.
- **One task is active at a time.** Task 1 is the only thing that matters until it is done, deferred, or skipped. Tasks 2–6 are visible but visually subordinate.
- **Constraint with an escape hatch.** The user can skip ahead to a later task, but the app adds a moment of friction (a confirmation) and logs it as an override. The method is enforced by design, not by locks.
- **The evening ritual is the heart.** Planning tomorrow's six at the end of today is the single most important behaviour. The app surfaces this prompt at a configurable evening hour and makes it the primary action on screen until it is done.
- **Nothing makes noise.** No sounds, ever. Notifications are silent banners. Nudges are gentle questions, not alarms.
- **Facts, not gamification.** The end-of-day summary reports what happened ("3 of 6 done, top 3 complete, 4h 12m focused") without praise, confetti, or badges. The one exception is a streak counter for consecutive planned days, because planning consistency is the habit that matters.
- **Timers measure, they don't nag.** Focus time is recorded automatically and quietly. It exists for the evening reflection, not to create pressure during the day.
- **Offline first, always.** Every device is fully functional with no network. Sync is a background reconciliation that never blocks.
- **Boring technology.** Solo maintainer. Every choice must still make sense in a year. Prefer well-documented, mainstream libraries over clever ones.

---

## 3. Design system

### Feel
Typography-driven, calm, monochrome. Think a well-set page of a notebook, not a dashboard. Generous whitespace. Nothing decorative. The serif numerals 1 through 6 are the visual anchor of the entire app.

### Palette (exact — do not add colours)
- **Background**: warm off-white, Tailwind `stone-50` (#fafaf9).
- **Surfaces / cards**: white with a `stone-200` hairline border. Completed tasks use `stone-100` at 50% opacity.
- **Primary ink**: `stone-900` (#1c1917). Used for: the active task border (2px), the active task's numeral, every primary button (Lock, Mark complete, Plan), heading text.
- **Secondary text**: `stone-500`. Hints and dimmed items: `stone-400`, `stone-300`.
- **The one warm accent**: `amber-700` (#b45309). Used **only** for: the streak flame and count, the "Six done." end-of-day headline, the "Complete" badge on fully-finished past days, and the small "↑ from yesterday" carryover tag. Never on buttons. Never on the active task. If you find yourself reaching for amber anywhere else, stop.
- **No green, no red, no blue, no indigo.** Destructive actions (delete, clear) are `stone-400` text, not red.

### Typography
- Numerals 1–6 and all headings: a serif (system serif is fine; Charter, Georgia, or New York on macOS).
- Everything else: system sans (SF Pro on macOS, Roboto on Android).
- Weights: 400 regular, 500 medium only. Never 600 or 700.
- Small labels (section headers like "TOMORROW", "EVENING RITUAL"): 11–12px, uppercase, wide letter-spacing, `stone-500`.

### Layout
- Single column, max width 28rem, centred. Mobile-first: the same layout serves the phone and a narrow Mac window.
- Rounded corners: 12px on cards, 8px on buttons and inputs.
- The active task card is larger than the others (more padding, bigger numeral, full-width "Mark complete" button) so the eye lands there immediately.
- Transitions: subtle fades (150–200ms) when a task completes and the next one becomes active. No bouncing, no sliding, no spring physics.

---

## 4. Features and behaviour (complete specification)

### 4.1 The day (the "Day" view — the default screen)

Header: today's date (e.g. "THURSDAY, SEP 3") in small caps above the app name "Six" in serif. Top-right: streak flame + count (amber, only if streak > 0) and a calendar icon that opens History.

Below the header, one of these states:

**A. No list for today, before the evening hour**
Centred: "No list yet" label, serif headline "What are today's six?", one-line explanation, a primary button "Plan today's six". If yesterday has unfinished tasks, a small amber line: "2 tasks from yesterday will carry over."

**B. No list for today, after the evening hour**
The evening ritual takes over: "Evening ritual" label, serif headline "Set tomorrow's six.", one line "Plan it now so morning starts clear.", primary button "Plan tomorrow's six". If tomorrow is already planned, show its preview (read-only list with an "edit" link) instead.

**C. Today's list exists and is in progress**
A small "1 of 6 done" counter. Then the six task cards in order:
- **Done** tasks: compact, greyed, strikethrough, small "undo" link.
- **The active task**: large card, 2px charcoal border, big serif numeral, task title at 18px medium, elapsed focus time for this task shown quietly beneath the title (e.g. "1h 12m"), then three actions: a full-width primary "Mark complete" button, and beneath it two text-link actions side by side: "Take 5" and "Defer to tomorrow".
- **Paused task** (if the user took a break or paused): same card but the primary button reads "Resume" and the elapsed time is frozen.
- **Upcoming** tasks: compact, `stone-500` text, a tiny underlined "skip ahead" link.

Below the list, separated by a hairline: the **Tomorrow** area. If tomorrow isn't planned and it's before the evening hour: muted text "After 6 PM, plan tomorrow's six." with a secondary (outlined) "Plan tomorrow" button. If it's after the evening hour: the text becomes "Time to plan tomorrow's six." and the button becomes primary. If tomorrow is planned: a read-only preview of the list with an "edit" link.

**D. All six done**
Serif headline "Six done." in amber, subtitle "Today's list is complete.", the six tasks listed compact and struck through with undo links. Then the Tomorrow area as above. Then, if the end-of-day review hasn't been done, a primary "Review today" button.

### 4.2 The planner (planning today or tomorrow)

Full-screen. Header: "Cancel" link on the left, "TOMORROW'S SIX" label centred. Serif date headline, one line "Most important at the top."

Six rows. Each row: a large serif numeral, a text input, up/down chevrons to reorder, and an ✕ to clear. Rows are drag-reorderable on touch as well.

When planning tomorrow, the unfinished tasks from today are pre-filled at the top in order, each tagged "↑ from yesterday" in amber. The user may edit, reorder, or remove them before locking. Deferred tasks always carry; skipped tasks do not.

A sticky bottom bar: primary button "Lock tomorrow's list" (disabled until at least one row is filled), beneath it "4 of 6 filled". Locking saves the list and returns to the Day view. A locked list can still be edited via the "edit" link — the lock is a commitment, not a prison — but editing after lock is logged.

Every task has an optional one-line note (revealed by tapping a small "note" affordance in the row).

### 4.3 Task actions and the state machine

Each task is in exactly one of: `planned`, `active`, `paused`, `done`, `deferred`, `skipped`.

```
planned ──activate──▶ active ──complete──▶ done
   ▲                   │  ▲
   │                   │  └──resume──── paused
   │                   ├──pause / take 5──▶ paused
   │                   ├──defer────────▶ deferred   (carries to tomorrow)
   │                   └──skip─────────▶ skipped    (dropped, logged)
   └──reopen (from done / deferred / skipped, same day only)
```

Rules:
- Exactly one task per day may be `active` or `paused` at any time.
- The first `planned` task in position order is automatically activated when the list is locked (if it's today) or when the app is opened on the list's day.
- Completing the active task automatically activates the next `planned` task.
- Activating task *n* while any task *m < n* is still `planned` is an **override**. Show a bottom-sheet confirmation: serif "Skip ahead?", one line "The Ivy Lee method works best when you finish tasks in priority order. Sure you want to break order?", buttons "Cancel" (outlined) and "Skip ahead" (primary). If confirmed, the earlier task stays `planned` and the chosen one becomes `active`; log an `overridden` event.
- "Take 5" pauses the task and schedules a "break over" nudge in 5 minutes (configurable).
- "Defer to tomorrow" marks the task `deferred`, closes its session, and activates the next planned task. Deferred tasks are pre-filled into tomorrow's planner.
- "Skip" is available only in the evening review (see 4.5), not during the day. It drops the task permanently.
- Undo/reopen is allowed the same day only.

### 4.4 Timer and sessions

- A **session** starts when a task becomes `active` and ends on any transition out of `active`.
- Elapsed time is **always computed from timestamps** (`started_at` / `ended_at`), never from a running counter. A laptop sleeping mid-session still records the right duration. A session longer than 3 hours with no interaction is flagged in the evening review as "likely idle — trim to ___?" with a suggested cut at the last interaction.
- The UI shows elapsed time on the active card, updating once per second while the app is focused. When not focused, nothing ticks.
- Android: no background timer. Sessions are timestamps; the UI reconstructs elapsed time on resume.

### 4.5 The evening review

Triggered manually ("Review today") or from the evening notification. A full-screen flow, three panels, swipe or "Next":

1. **What happened** — factual summary in plain language: "3 of 6 done. Top 3 complete. 4h 12m focused." Then each task with its status and focus time. Any idle-flagged sessions appear here with the trim option.
2. **Unfinished tasks** — each remaining `planned`, `paused`, or `active` task with two choices: "Carry to tomorrow" (default, pre-selected) or "Drop". Dropping marks it `skipped`.
3. **Tomorrow's six** — the planner, pre-filled with carried tasks. Lock it here.

An optional single-line "One thought about today" text field on panel 1. Completing the review records it; the Day view then shows "Reviewed" quietly in the Tomorrow area.

### 4.6 Streak

Counted from data, never stored as a separate number: the number of consecutive calendar days (ending today or tomorrow) that have a locked plan. Planning tomorrow's list tonight extends the streak. Missing a day resets it. Shown as flame + number in amber in the header, only when > 0.

### 4.7 History

Opened from the calendar icon. A reverse-chronological list of the last 30 days. Each day: serif date, "4/6 completed", a small badge ("Complete" in amber if 6/6, "Partial" in stone otherwise), then the six tasks compact with done ones struck through and focus time per task on the right. Tapping a day expands its review reflection if one exists.

### 4.8 Stats

A separate view (reachable from History via a "Stats" link). Facts only, no charts that require explanation:
- This week: days planned (x/7), tasks done, top-3 completion rate, tasks 4–6 completion rate, total focus time, overrides.
- Rolling 7-day trend line for tasks done and focus hours (a simple sparkline, charcoal, no axes).
- Most carried-over task (the one that rolled the most days without finishing) — surfaced because it is usually a task that needs breaking down.
- Export: "Export this week" → plain text and JSON files to `~/Six/exports/` on macOS, share sheet on Android.

### 4.9 Settings

A minimal screen: evening ritual hour (default 18:00), check-in interval (default 75 min), break length (default 5 min), day rollover hour (default 05:00 — late-night work counts toward the correct day), notification permissions status, sync status and sign-in (Phase 2), export all data as JSON, and app version.

### 4.10 Notifications (silent, local)

All notifications are silent banners with no sound. Nothing fires while the main window is focused — an in-app banner is shown instead. Never more than one pending notification per category; re-scheduling replaces, never stacks.

| Trigger | When | Text | Actions |
|---|---|---|---|
| Evening ritual | Daily at the evening hour, only if tomorrow isn't locked | "Set tomorrow's six." | Plan · Later (snooze 30m) |
| Check-in | 75 min (configurable) after a session starts, re-armed on resume, cancelled if the session ends | "Still on [task]? 1h 15m so far." | Done · Keep going · Take 5 |
| Break over | 5 min after "Take 5" | "Back to [task]?" | Resume · 5 more |
| Unplanned morning | Day rollover + 3h, if no plan is locked for today | "No list for today yet." | Plan now |
| End of day | At the evening hour, if today's plan exists and the review isn't done | "3 of 6 done, 4h 12m focused. Review today?" | Review · Later |

Android: use inexact scheduling; do not request exact-alarm permission. ±10 minutes is acceptable for every trigger above.

### 4.11 macOS menu bar companion

The menu bar is where this app lives during the working day. The main window is for planning and review; the menu bar is for focus.

- **Tray title** (text next to the clock, no icon needed, or a minimal template icon plus text): `1/6 · Draft Q2 playbook` — position, a middle dot, the active task title truncated at 28 characters. Idle states: `Six · plan today` (no list), `Six · 4/6` (paused / between tasks), `Six · done` (all complete), `Six · plan tomorrow` (after the evening hour with tomorrow unplanned).
- The tray title updates on **state change only**, never per second. Per-second updates in the menu bar are distracting and waste CPU.
- **Left-click** opens a small popover-style window (about 320×220px) anchored to the tray: the active task's numeral and title, elapsed time (ticking while the popover is open), and three buttons: **Done** · **Take 5** · **Defer**. Below, a small "Open Six" link.
- **Right-click** shows a native menu: Open Six · Plan tomorrow · Pause / Resume · Review today · Quit.
- The main window may be closed to the menu bar; the app keeps running. Quit is explicit.

---

## 5. Engineering architecture

### 5.1 Stack (decided — do not revisit)

- **Tauri v2** for both macOS and Android from one codebase. The Rust core is the application; the web frontend is the view.
- **Frontend**: React 18 + TypeScript + Tailwind + Zustand. Vite for bundling.
- **Rust core**: owns every piece of domain logic — task state machine, session timing, streak, analytics, notification scheduling, tray state. Exposed to the frontend via Tauri `invoke` commands and events. **The frontend never computes durations, transitions, or streaks.** It renders state and dispatches intents. This keeps timer truth in one place and makes the UI replaceable.
- **Local persistence**: SQLite via `tauri-plugin-sql` (sqlx). Migrations are numbered SQL files checked into the repo.
- **Notifications**: `tauri-plugin-notifications` (the community plugin by Choochmeque that supports scheduling, actions, and Android channels on top of Tauri v2). Verify the current version and API before use.
- **Menu bar**: Tauri's tray icon API with `title` set on macOS.
- **Settings**: stored in the SQLite `settings` table, not a JSON file, so they sync in Phase 2.
- **Sync (Phase 2 only)**: Supabase (Postgres + Row Level Security + Realtime). Single user, email magic-link auth, token in the OS keychain.

Why this stack: one frontend serves both platforms; the menu bar feature this app hinges on is a supported Tauri API on macOS; the Rust core is a clean boundary so the Mac shell could be swapped to SwiftUI later without touching data, logic, or sync.

### 5.2 Database schema (SQLite; mirrored in Postgres for Phase 2)

```sql
CREATE TABLE daily_plans (
  id            TEXT PRIMARY KEY,           -- uuid v7
  plan_date     TEXT NOT NULL UNIQUE,       -- 'YYYY-MM-DD', local, respecting the 05:00 rollover
  locked_at     TEXT,                       -- ISO8601 UTC; NULL = drafting
  edited_after_lock INTEGER NOT NULL DEFAULT 0,
  reviewed_at   TEXT,
  reflection    TEXT,
  updated_at    TEXT NOT NULL,
  device_id     TEXT NOT NULL
);
CREATE TABLE tasks (
  id            TEXT PRIMARY KEY,
  plan_id       TEXT NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL CHECK (position BETWEEN 1 AND 6),
  title         TEXT NOT NULL,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'planned'
                CHECK (status IN ('planned','active','paused','done','deferred','skipped')),
  carried_from  TEXT REFERENCES tasks(id),  -- lineage across days
  completed_at  TEXT,
  updated_at    TEXT NOT NULL,
  device_id     TEXT NOT NULL,
  UNIQUE (plan_id, position)
);
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,                       -- NULL = running
  ended_reason  TEXT CHECK (ended_reason IN
                ('done','paused','break','deferred','skipped','superseded','day_end','trimmed')),
  last_interaction_at TEXT,                 -- for idle detection
  device_id     TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE TABLE events (                        -- immutable log; source for analytics
  id            TEXT PRIMARY KEY,
  task_id       TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  plan_id       TEXT REFERENCES daily_plans(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN
                ('locked','edited_after_lock','activated','completed','paused','resumed',
                 'deferred','skipped','overridden','reopened','reviewed')),
  occurred_at   TEXT NOT NULL,
  device_id     TEXT NOT NULL
);
CREATE TABLE settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
-- defaults: evening_hour=18, checkin_minutes=75, break_minutes=5, day_start_hour=5
CREATE TABLE sync_queue (                    -- Phase 2; create now, unused until then
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name    TEXT NOT NULL,
  row_id        TEXT NOT NULL,
  op            TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  queued_at     TEXT NOT NULL
);
```

Invariants enforced in Rust, not just the UI: max six tasks per plan; one `active`/`paused` task per plan; sessions never overlap for the same task; `completed_at` set iff status is `done`.

### 5.3 Rust core: commands and events

Expose these `invoke` commands (names are suggestions; keep them this shape):

- Plans: `get_day(date)`, `get_range(from, to)`, `draft_plan(date, tasks[])`, `lock_plan(plan_id)`, `edit_plan(plan_id, tasks[])`
- Tasks: `activate(task_id, {override: bool})`, `complete(task_id)`, `pause(task_id, {reason})`, `resume(task_id)`, `defer(task_id)`, `skip(task_id)`, `reopen(task_id)`, `set_note(task_id, note)`
- Review: `get_review(plan_id)`, `trim_session(session_id, ended_at)`, `complete_review(plan_id, reflection, decisions[])`
- Stats: `get_streak()`, `get_stats(range)`, `export(range, format)`
- Settings: `get_settings()`, `set_setting(key, value)`
- Emit a single `state_changed` event with the full day snapshot after any mutation; the frontend re-renders from that. No optimistic updates in the UI.

The tray title and all notification scheduling are driven from the same state-change path in Rust, so the menu bar and the nudges can never disagree with the window.

### 5.4 Day boundaries

"Today" is the local date at (now − `day_start_hour` hours). At the rollover, any `active`/`paused` task's open session is closed with `ended_reason='day_end'`. Implement rollover as a check on every state read plus a scheduled check at the rollover hour, not as a long-running timer.

### 5.5 Sync (Phase 2 — implement only when instructed)

- Every row carries `updated_at` and `device_id`. **Last-write-wins per row by `updated_at`.** No CRDTs. Single user; simultaneous conflicting edits are vanishingly rare.
- The one special case: only one device may hold a running session. Starting a task on device B closes the open session on device A with `ended_reason='superseded'` at B's start time. The Mac tray shows `Six · active on phone` when this happens.
- Push on every write (debounced 2s), pull on focus and every 60s while open, plus a Realtime subscription on the Mac.
- Supabase project, URL, and anon key will be supplied by me. Do not create accounts.

---

## 6. Repository layout

```
six/
  CLAUDE.md               ← a short summary of §2, §3 palette, §5.1 decisions, and §7 rules
  README.md               ← how to run, build, and where data lives
  package.json
  src/                    ← React + TS frontend
    app/                  ← routes/views: Day, Planner, Review, History, Stats, Settings, TrayPopover
    components/
    store/                ← Zustand store; mirrors Rust snapshot, dispatches invokes
    lib/                  ← invoke wrappers, formatting helpers (no domain logic)
  src-tauri/
    src/
      main.rs
      commands/           ← one file per domain area
      domain/             ← state machine, timing, streak, analytics — pure, tested
      db/                 ← sqlx queries, migrations runner
      scheduler/          ← notification and rollover scheduling
      tray/               ← macOS tray title + popover window (cfg(target_os = "macos"))
    migrations/           ← 0001_init.sql, ...
    tauri.conf.json
  supabase/               ← Phase 2: schema.sql, policies.sql
```

---

## 7. Execution protocol

Work in these steps, in order. **Stop at the end of each step**, show me what you built and exactly how to verify it, and wait for my "go" before starting the next.

**Step 0 — Prerequisites.** Check for Rust stable, Xcode Command Line Tools, Node 20+, pnpm, and the Tauri CLI. Report what's missing and how to install it. Do not install system-level tooling yourself. Android SDK / Studio is only needed at Step 6; do not install it earlier.

**Step 1 — Scaffold and core.** Create the Tauri v2 project, the repo layout above, the SQLite migrations, the Rust domain module with the full task state machine and invariants, and unit tests for every transition including overrides, day rollover, and the max-six rule. `cargo test` passes.

**Step 2 — Day, Planner, and History views.** The frontend rendered from the Rust snapshot. Planning, locking, carryover, activation, completion, undo, skip-ahead with confirmation, streak, and history all work end to end. `pnpm tauri dev` runs on this Mac.

**Step 3 — Timer, sessions, review.** Sessions recorded from timestamps, elapsed time on the active card, Take 5 / Resume / Defer, the idle flag, and the three-panel evening review with carry/drop decisions and reflection.

**Step 4 — Menu bar.** Tray title reflecting state, left-click popover with Done · Take 5 · Defer, right-click menu, close-to-tray behaviour, explicit Quit.

**Step 5 — Notifications and stats.** All five silent triggers from §4.10 with actions wired to the state machine; suppression while focused; in-app banner fallback. Stats view and export. Settings view.

**Step 6 — Android and sync.** Only when I say so. Android build via Tauri mobile, the Supabase schema and policies, the sync queue and reconciliation from §5.5, sign-in via magic link. Stop and ask me for the Supabase project details before touching the network.

**Step 7 — Package.** `pnpm tauri build` produces an ad-hoc-signed `.app` that launches on this M4 and, after Step 6, a debug APK for the Galaxy S24 Ultra. README documents both.

### Working rules

- Commit at the end of every step: `step N: <summary>`.
- Never create online accounts, enter credentials, or request paid services. If a step needs one, stop and tell me.
- Ad-hoc signing is fine; this is never distributed.
- Every piece of domain logic in `src-tauri/src/domain/` must have tests. The frontend has none required beyond type-checking.
- Verify library APIs against their current documentation before using them; do not rely on memory for plugin signatures.
- If something in this document is impossible or clearly wrong in practice, say so and propose the smallest change. Do not silently deviate.
- When in doubt about a product decision, choose the option that removes something rather than adds it.

### Definition of done for Phase 1 (Steps 0–5)

- `pnpm tauri dev` runs on this Mac.
- I can plan six tasks, lock the list, see task 1 become active, watch the timer, take a break, resume, complete, defer, skip ahead with the friction modal, and complete the evening review including planning tomorrow.
- The menu bar shows the active task title; Done · Take 5 · Defer work from the popover.
- The evening and check-in notifications fire silently at the configured times.
- History and Stats show correct data; export produces a readable text file.
- `pnpm tauri build` produces a signed `.app` that launches.
