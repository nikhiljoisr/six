-- 0004_idle_gap.sql — the longest silence in a session, kept for the review.
-- An interaction after hours of nothing used to overwrite the only evidence of the idle
-- stretch. The session now remembers its longest silence (over three hours); the review
-- offers to take exactly that stretch out, and the work after it stays.

ALTER TABLE sessions ADD COLUMN idle_from TEXT;
ALTER TABLE sessions ADD COLUMN idle_until TEXT;
