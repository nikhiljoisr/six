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
