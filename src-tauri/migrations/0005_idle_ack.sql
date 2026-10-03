-- A recorded silence the user chose to keep: the `idle_until` it was answered at. A
-- longer silence later on the same session is a new one, and is offered again.
ALTER TABLE sessions ADD COLUMN idle_ack TEXT;
