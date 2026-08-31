-- Phase 6: rolling live-day pipeline progress.
-- Forward-only and additive: one new table. No drops, renames, or changes to
-- existing rows. Tracked per (chat_id, day, category) for base/profanity/criminal.
--
-- accepted_seq   — highest contiguous accepted sequence (monotonic per day)
-- completed_seq  — highest contiguous completed sequence (success/zero/skipped)
-- pending_count  — accepted but not yet resolved (neither completed nor failed)
-- failed_count   — tracked permanent failures (never represented as zero)
-- completed_through_ts — max message timestamp observed for completed work
--
-- No full message text, usernames, words, or user IDs are ever stored here:
-- only the opaque numeric sequence/counts/outcome and a timestamp.
CREATE TABLE IF NOT EXISTS stats_daily_pipeline_progress (
  chat_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  category TEXT NOT NULL,
  accepted_seq INTEGER NOT NULL DEFAULT 0,
  completed_seq INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  completed_through_ts INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, day, category)
);
