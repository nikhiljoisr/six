-- 0002_pomodoro.sql — Pomodoro (Step 4b, agreed 2026-09-03).
-- A pomodoro annotates a session; sessions remain the single truth for focus time.

CREATE TABLE pomodoros (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  session_id      TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  started_at      TEXT NOT NULL,
  planned_seconds INTEGER NOT NULL CHECK (planned_seconds > 0),
  ended_at        TEXT,                        -- NULL = running
  outcome         TEXT CHECK (outcome IN ('completed','interrupted','finished_early')),
  acknowledged_at TEXT,                        -- the ring was answered (break, one more, keep going)
  device_id       TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_pomodoros_task ON pomodoros(task_id);
CREATE INDEX idx_pomodoros_open ON pomodoros(task_id) WHERE ended_at IS NULL;

INSERT INTO settings (key, value, updated_at) VALUES
  ('pomodoro_enabled',            '1',  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('pomodoro_minutes',            '25', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('long_break_minutes',          '15', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('pomodoros_before_long_break', '4',  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
