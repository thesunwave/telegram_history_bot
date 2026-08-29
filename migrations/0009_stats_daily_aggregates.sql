-- Phase 2: daily aggregate read-model tables dual-written by CountersDO.
-- Forward-only and additive: creates new tables/indexes, never alters existing data.
-- Live writes record coverage statuses (never 'complete'), so only days verified by
-- backfill + parity become eligible for the Phase 3 D1 read path.

CREATE TABLE IF NOT EXISTS stats_daily_user (
  chat_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  voice_count INTEGER NOT NULL DEFAULT 0,
  voice_duration_seconds INTEGER NOT NULL DEFAULT 0,
  video_note_count INTEGER NOT NULL DEFAULT 0,
  video_note_duration_seconds INTEGER NOT NULL DEFAULT 0,
  profanity_count INTEGER NOT NULL DEFAULT 0,
  criminal_count INTEGER NOT NULL DEFAULT 0,
  criminal_severity INTEGER NOT NULL DEFAULT 0,
  last_message_ts INTEGER,
  PRIMARY KEY (chat_id, day, user_id)
);

CREATE INDEX IF NOT EXISTS idx_stats_daily_user_chat_day
  ON stats_daily_user (chat_id, day);

CREATE INDEX IF NOT EXISTS idx_stats_daily_user_chat_user_day
  ON stats_daily_user (chat_id, user_id, day);

CREATE TABLE IF NOT EXISTS stats_daily_hour (
  chat_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  hour INTEGER NOT NULL CHECK (hour >= 0 AND hour <= 23),
  message_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, day, hour)
);

CREATE TABLE IF NOT EXISTS stats_daily_bucket_user (
  chat_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  bucket TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, day, bucket, user_id)
);

CREATE INDEX IF NOT EXISTS idx_stats_daily_bucket_user_chat_day_bucket
  ON stats_daily_bucket_user (chat_id, day, bucket);

CREATE TABLE IF NOT EXISTS stats_daily_profanity_word (
  chat_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  word TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, day, word)
);

CREATE TABLE IF NOT EXISTS stats_daily_profanity_word_user (
  chat_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  word TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, day, word, user_id)
);

CREATE INDEX IF NOT EXISTS idx_stats_daily_word_user_chat_day_word
  ON stats_daily_profanity_word_user (chat_id, day, word);

CREATE INDEX IF NOT EXISTS idx_stats_daily_word_user_chat_word_day
  ON stats_daily_profanity_word_user (chat_id, word, day);

CREATE TABLE IF NOT EXISTS stats_user_profile (
  user_id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  last_seen_ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stats_daily_coverage (
  chat_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  base_status TEXT NOT NULL DEFAULT 'none',
  profanity_status TEXT NOT NULL DEFAULT 'none',
  criminal_status TEXT NOT NULL DEFAULT 'none',
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, day)
);
