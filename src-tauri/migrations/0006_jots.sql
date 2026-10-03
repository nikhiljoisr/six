-- Parked thoughts: one line jotted down mid-task so it can be let go of. They belong
-- to the day, are read back in the evening review, and never become a task by themselves.
CREATE TABLE jots (
  id          TEXT PRIMARY KEY,
  plan_id     TEXT NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  task_id     TEXT REFERENCES tasks(id) ON DELETE SET NULL,  -- the task in hand at the time
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_jots_plan ON jots(plan_id);
