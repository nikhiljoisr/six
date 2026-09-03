# Six

A personal Ivy Lee Method app for macOS and Android, built with Tauri v2. One user, six
tasks a day, one active at a time. The brief lives in [`docs/SPEC.md`](docs/SPEC.md).

## Status

| Step | What | State |
|---|---|---|
| 0 | Prerequisites | done |
| 1 | Scaffold, schema, Rust core + tests | done |
| 2 | Day, Planner, History views | done |
| 3 | Timer, sessions, evening review | done |
| 4 | macOS menu bar | done |
| 4b | Pomodoro (agreed addition) | done |
| 5 | Notifications, stats, settings | next |
| 6 | Android + sync (on request) | |
| 7 | Packaging | |

## Prerequisites (macOS)

- Xcode Command Line Tools (`xcode-select --install`)
- Rust stable via rustup (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- Node 20+ and pnpm (`brew install pnpm`)

The Tauri CLI is a dev dependency; no global install is needed.

## Run

```bash
pnpm install
pnpm tauri dev
```

The first run compiles the Rust side (a few minutes); later runs are fast. The window is
480×760 by default.

## Test

```bash
cd src-tauri && cargo test
```

Domain logic (`src-tauri/src/domain/`) is pure and fully unit-tested: the task state
machine, overrides, day rollover, the six-task ceiling, timing, idle detection, streak,
settings. The store (`src-tauri/src/db/`) is tested against an in-memory SQLite database
with the real migrations. The frontend is type-checked only:

```bash
pnpm typecheck
```

## Build

```bash
pnpm tauri build
```

Produces an ad-hoc-signed `Six.app` under `src-tauri/target/release/bundle/macos/`.
(Packaging is finalised in Step 7.)

## Pomodoro

A pomodoro (25 minutes by default) runs on the active task and rings at its planned end;
the active card and the popover count it down. A ring waits for a tap: a break ("Take 5",
or a long break after every fourth), "One more", or "Keep going". Leaving the task early
records the pomodoro as interrupted or finished early. Sessions remain the truth for focus
time; pomodoros only annotate them. Settings keys: `pomodoro_enabled`, `pomodoro_minutes`,
`long_break_minutes`, `pomodoros_before_long_break` (migration 0002).

## Menu bar (macOS)

The tray title shows the active task (`1/6 · Draft Q2 playbook`) or the day's state
(`Six · plan today`, `Six · 4/6`, `Six · done`, `Six · plan tomorrow`). Left-click opens the
popover with Done · Take 5 · Defer; right-click opens the menu (Open Six · Plan tomorrow ·
Pause/Resume · Review today · Quit Six). Closing the main window keeps Six running in the
menu bar without a Dock icon; Quit is explicit.

On a notched MacBook, macOS hides the newest status item when the bar is crowded, so the
title may not appear until other menu bar items are removed (see docs/DECISIONS.md).

## Where data lives

| What | Where |
|---|---|
| Database | `~/Library/Application Support/com.nikhiljois.six/six.db` (SQLite, WAL mode) |
| Exports | `~/Six/exports/` (Step 5) |

Schema: `src-tauri/migrations/0001_init.sql`. Deleting the database file resets the app.

## Layout

```
src/                 React + TypeScript frontend (renders the Rust snapshot, dispatches intents)
  app/               views: Day, Planner, Review, History, Stats, Settings, TrayPopover
  components/
  store/             Zustand mirror of the snapshot
  lib/               invoke wrappers, formatting helpers (no domain logic)
src-tauri/
  src/domain/        state machine, timing, streak, day boundaries, settings — pure, tested
  src/db/            sqlx store over the tauri-plugin-sql pool
  src/commands/      Tauri commands and the read model (snapshot)
  src/scheduler/     notifications + rollover scheduling (Step 5)
  src/tray/          macOS menu bar (Step 4)
  migrations/        numbered SQL migrations
docs/SPEC.md         the brief
docs/DECISIONS.md    dated amendments and interpretations
```

## Commands exposed to the frontend

Plans: `get_snapshot`, `get_day`, `get_range`, `get_carryover`, `draft_plan`, `lock_plan`, `edit_plan`.
Tasks: `activate`, `complete`, `pause`, `resume`, `defer`, `skip`, `reopen`, `set_note`, `touch`, `get_elapsed`, `start_pomodoro`, `acknowledge_pomodoro`.
Review: `get_review`, `trim_session`, `complete_review`. Stats: `get_streak`.
Settings: `get_settings`, `set_setting`. Window: `show_main`, `hide_popover`. Every mutation
broadcasts `state_changed` with the full day snapshot and updates the macOS tray.
