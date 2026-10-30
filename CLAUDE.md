# Six — working notes for Claude

Six is a personal, single-user Ivy Lee Method app for macOS (Tauri v2). The full brief is
`docs/SPEC.md`; it is the single source of truth, amended only by dated entries in
`docs/DECISIONS.md`. This file is the short version. Android and sync were dropped on
3 Sep 2026: one Mac, one SQLite file.

## Product principles (SPEC §2)
- Six is the ceiling, always. No seventh task, ever, by any path. A parked thought (J, "Jot") is one line kept for the evening review; it is never a task and nothing turns it into one.
- One task is active at a time. Task 1 until it is done, deferred or skipped.
- Constraint with an escape hatch: skipping ahead is always possible but goes through a three-step ladder (two asks, then a press-and-hold, by pointer or by holding Space/Enter) and is logged as an override. Never a hard lock; never a single tap. See docs/DECISIONS.md.
- The evening ritual (planning tomorrow's six) is the heart; it is the primary action once the evening hour passes.
- Silent by default. An optional sound on timer transitions is a Settings switch, off out of the box (three synthesised sounds, three levels); nothing else ever sounds.
- Facts, not gamification. The only counter is the planning streak.
- Timers measure, they don't nag. Pomodoro (Nikhil's addition, on by default) is a rhythm layer over sessions: a countdown on the active card, a silent ring answered by a tap; interruptions are recorded as facts, never penalised. Focus time exists for the evening reflection. A long silence in a session is recorded; Six offers to take it out when you come back and again in the review, and never subtracts time by itself.
- Offline by default. No accounts, no telemetry, and no network unless the planning coach is switched on (Settings; off out of the box). With it on, the one request Six ever makes is the one the user asks for with "Check the list": that list's task titles to TypeSafe.
- Boring technology. Solo maintainer; every choice must still make sense in a year.
- When in doubt, remove rather than add.

## Palette and type (SPEC §3) — exact, do not add colours
- Ground `--color-paper`. No cards on the day, planner, review, history or settings screens: groups are `stone-200` hairline-separated; the current task and the review's gap block are bounded by an ink rule above (`--color-rule`) and a hairline below. Text fields stay white with a hairline at radius 4.
- Ink `stone-900`: the active numeral, every filled button (one per surface: when a screen's filled button is elsewhere, the current task's is an ink text button), headings, the live clock value. The current task's top rule is `--color-rule` (ink in light, softened in dark), and it is also the countdown: it shortens while a pomodoro or break runs.
- Secondary `stone-500` (also status words, tags, completion times); decoration only `stone-400`, `stone-300` for decoration and struck-through text only. Anything clickable reads at `stone-500` or darker (a 2.5:1 hint is not a control). Destructive actions are `stone-500` text, never red.
- `amber-700` only for: streak flame + count, "Six done." headline, "Complete" badge on 6/6 days, "↑ from yesterday" tag. Never on buttons or the active task.
- No green, red, blue or indigo. The serif is the app's own voice (date, numerals 1–6, footer, navigation, headings); the system sans is the user's words and the controls. Weights 400/500 only; the day view is 400 throughout.
- Single column, max-width 28rem, centred, on the paper ground (`--color-paper`). 6px card radius, 4px controls. 150–200ms fades, no springs.
- Labels are sentence case (serif 12px) and rare: a heading or the content usually says it. Finished rows are struck through. Buttons fit their words; a page's committing button sits at the right, Mac-style, and sheets hang from the title bar. Counts read "n of m".
- The window is a card that can grow (360×520 to 720×1140). Up to 480 wide the page reflows at its normal size; past that the whole page is drawn larger in proportion, to 1.5×, by the web view's page zoom, set from Rust on resize (`domain/window.rs`). No layout is designed for a wider column, so none is needed. The green button zooms to the largest size and back; it never enters full screen. The size is remembered.
- Dark appearance (Settings; light is the default) is the same roles remapped: `src/styles.css` redefines the colour variables under `data-theme="dark"`. Components never name a dark colour and there are no `dark:` variants; a colour that is not one of the variables (a hex in a component) breaks it.

## Architecture decisions (SPEC §5.1) — decided, do not revisit
- Tauri v2, macOS only. React 18 + TypeScript + Tailwind + Zustand, Vite.
- The Rust core owns all domain logic (`src-tauri/src/domain/`): state machine, timing, streak, analytics, scheduling, tray state. **The frontend never computes durations, transitions or streaks.** It renders the snapshot and dispatches intents.
- One operation at a time: every read-modify-save (commands, the ticker, interaction stamps, the housekeeping inside a snapshot) runs under `AppState::gate`. Functions marked "gate held" never take it themselves. Snapshots carry a revision; the frontend ignores an older one arriving late.
- SQLite via `tauri-plugin-sql` (sqlx). Migrations are numbered SQL files in `src-tauri/migrations/`. The frontend has no SQL permissions; Rust takes the plugin's pool.
- Every mutation emits one `state_changed` event carrying the full day snapshot. No optimistic UI.
- Nudges are planned in Rust; delivered as an in-app banner while the window is focused, otherwise as Six's own banner under the menu bar (the popover). `tauri-plugin-notifications` is an opt-in for signed builds only. Menu bar: Tauri tray with `title`.
- Settings live in the SQLite `settings` table. Single device; no sync, no network. Two answers live with macOS instead: whether Six opens at login (a LaunchAgent, `tauri-plugin-autostart`) and the registered global shortcut (`tauri-plugin-global-shortcut`; the choice itself is a setting). Both are off until chosen.
- Parked thoughts (`jots`) are read with the `Day` and written by their own commands; `save_day` never touches them.
- A copy of the database is written once per calendar day, at startup and by the ticker (`db/backup.rs`, `VACUUM INTO`, seven kept).
- Tauri stays at 2.11.5: plugins are pinned to versions that do not pull a newer one.
- The planning coach links no HTTP client: `src-tauri/src/coach.rs` runs the system's `curl` and reads the key with `security` from the Keychain, both through pipes. The webview's CSP is unchanged and the webview cannot reach the network. The questions and the policy are pure (`domain/coach.rs`) and pinned, with the bench in `tools/typesafe-eval`, to one request fixture.
- "Today" is the local date at (now − day_start_hour). Rollover is checked on every state read.

## Working rules (SPEC §7)
- Work step by step; stop at the end of each step and wait for "go". Commit as `step N: <summary>`.
- Never create online accounts, enter credentials or request paid services.
- Every piece of domain logic has tests (`cd src-tauri && cargo test`). Frontend: type-check, plus tests for pure view logic (`pnpm test`, Node's own runner over `tests/`). Look at interface changes in the harness (`tools/harness/`, renders at the real 480×532) before shipping them.
- Verify library APIs against current docs before use.
- If the brief is impossible or wrong in practice, say so and propose the smallest change. Never deviate silently.
