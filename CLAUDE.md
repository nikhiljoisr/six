# Six — working notes for Claude

Six is a personal, single-user Ivy Lee Method app (macOS + Android, Tauri v2). The full
brief is `docs/SPEC.md`; it is the single source of truth, amended only by dated entries in
`docs/DECISIONS.md`. This file is the short version.

## Product principles (SPEC §2)
- Six is the ceiling, always. No seventh task, ever, by any path.
- One task is active at a time. Task 1 until it is done, deferred or skipped.
- Constraint with an escape hatch: skipping ahead is always possible but goes through a three-step ladder (two asks, then a press-and-hold) and is logged as an override. Never a hard lock; never a single tap. See docs/DECISIONS.md.
- The evening ritual (planning tomorrow's six) is the heart; it is the primary action once the evening hour passes.
- Nothing makes noise. No sounds. Silent banners only.
- Facts, not gamification. The only counter is the planning streak.
- Timers measure, they don't nag. Pomodoro (Nikhil's addition, on by default) is a rhythm layer over sessions: a countdown on the active card, a silent ring answered by a tap; interruptions are recorded as facts, never penalised. Focus time exists for the evening reflection.
- Offline first. Sync (Phase 2) never blocks.
- Boring technology. Solo maintainer; every choice must still make sense in a year.
- When in doubt, remove rather than add.

## Palette and type (SPEC §3) — exact, do not add colours
- Background `stone-50`. Cards white with `stone-200` hairline; done tasks `stone-100` at 50%.
- Ink `stone-900`: active card border (2px), active numeral, every primary button, headings.
- Secondary `stone-500`; hints `stone-400`, `stone-300`. Destructive actions are `stone-400` text, never red.
- `amber-700` only for: streak flame + count, "Six done." headline, "Complete" badge on 6/6 days, "↑ from yesterday" tag. Never on buttons or the active task.
- No green, red, blue or indigo. Serif for numerals 1–6 and headings; system sans elsewhere. Weights 400/500 only.
- Single column, max-width 28rem, centred. 12px card radius, 8px controls. 150–200ms fades, no springs.

## Architecture decisions (SPEC §5.1) — decided, do not revisit
- Tauri v2, one codebase for macOS and Android. React 18 + TypeScript + Tailwind + Zustand, Vite.
- The Rust core owns all domain logic (`src-tauri/src/domain/`): state machine, timing, streak, analytics, scheduling, tray state. **The frontend never computes durations, transitions or streaks.** It renders the snapshot and dispatches intents.
- SQLite via `tauri-plugin-sql` (sqlx). Migrations are numbered SQL files in `src-tauri/migrations/`. The frontend has no SQL permissions; Rust takes the plugin's pool.
- Every mutation emits one `state_changed` event carrying the full day snapshot. No optimistic UI.
- Notifications: `tauri-plugin-notifications` (Choochmeque). Menu bar: Tauri tray with `title`.
- Settings live in the SQLite `settings` table. Sync (Phase 2): Supabase, last-write-wins by `updated_at`.
- "Today" is the local date at (now − day_start_hour). Rollover is checked on every state read.

## Working rules (SPEC §7)
- Work step by step; stop at the end of each step and wait for "go". Commit as `step N: <summary>`.
- Never create online accounts, enter credentials or request paid services.
- Every piece of domain logic has tests (`cd src-tauri && cargo test`). Frontend: type-check only.
- Verify library APIs against current docs before use.
- If the brief is impossible or wrong in practice, say so and propose the smallest change. Never deviate silently.


macOS only, single device: Android and Supabase sync were dropped on 3 Sep 2026.
