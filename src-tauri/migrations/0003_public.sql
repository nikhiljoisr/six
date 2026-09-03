-- 0003_public.sql — single device, public release.
-- Sync never shipped; the queue table goes. Two settings arrive: an optional sound on
-- timer transitions (off: Six is silent by default) and the first-launch guide flag.

DROP TABLE IF EXISTS sync_queue;

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('sound_enabled', '0', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('onboarded',     '0', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
