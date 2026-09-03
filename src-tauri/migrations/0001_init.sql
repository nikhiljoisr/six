-- 0001_init.sql — Six: initial schema (mirrors §5.2 of docs/SPEC.md).
-- Timestamps are ISO 8601 UTC text ('YYYY-MM-DDTHH:MM:SS.mmmZ').
-- plan_date is a local business date 'YYYY-MM-DD' respecting the day rollover hour.

CREATE TABLE daily_plans (
  id                TEXT PRIMARY KEY,           -- uuid v7
  plan_date         TEXT NOT NULL UNIQUE,       -- 'YYYY-MM-DD', local, respecting the 05:00 rollover
  locked_at         TEXT,                       -- ISO8601 UTC; NULL = drafting
  edited_after_lock INTEGER NOT NULL DEFAULT 0,
  reviewed_at       TEXT,
  reflection        TEXT,
  updated_at        TEXT NOT NULL,
  device_id         TEXT NOT NULL
);

CREATE TABLE tasks (
  id            TEXT PRIMARY KEY,
  plan_id       TEXT NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL CHECK (position BETWEEN 1 AND 6),
  title         TEXT NOT NULL,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'planned'
                CHECK (status IN ('planned','active','paused','done','deferred','skipped')),
  carried_from  TEXT REFERENCES tasks(id),      -- lineage across days
  completed_at  TEXT,
  updated_at    TEXT NOT NULL,
  device_id     TEXT NOT NULL
  -- Position uniqueness per plan is enforced in Rust (domain::plan), not by a UNIQUE
  -- constraint: SQLite checks UNIQUE per row and cannot defer it, so reordering a full
  -- list of six would fail on the first swap.
);
CREATE INDEX idx_tasks_plan_position ON tasks(plan_id, position);

CREATE TABLE sessions (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  started_at          TEXT NOT NULL,
  ended_at            TEXT,                     -- NULL = running
  ended_reason        TEXT CHECK (ended_reason IN
                      ('done','paused','break','deferred','skipped','superseded','day_end','trimmed')),
  last_interaction_at TEXT,                     -- for idle detection
  device_id           TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_sessions_task ON sessions(task_id);
CREATE INDEX idx_sessions_open ON sessions(task_id) WHERE ended_at IS NULL;

CREATE TABLE events (                            -- immutable log; source for analytics
  id            TEXT PRIMARY KEY,
  task_id       TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  plan_id       TEXT REFERENCES daily_plans(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN
                ('locked','edited_after_lock','activated','completed','paused','resumed',
                 'deferred','skipped','overridden','reopened','reviewed')),
  occurred_at   TEXT NOT NULL,
  device_id     TEXT NOT NULL
);
CREATE INDEX idx_events_plan ON events(plan_id);
CREATE INDEX idx_events_task ON events(task_id);

CREATE TABLE settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
INSERT INTO settings (key, value, updated_at) VALUES
  ('evening_hour',    '18', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('checkin_minutes', '75', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('break_minutes',   '5',  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('day_start_hour',  '5',  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE sync_queue (                        -- Phase 2; created now, unused until then
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name    TEXT NOT NULL,
  row_id        TEXT NOT NULL,
  op            TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  queued_at     TEXT NOT NULL
);
