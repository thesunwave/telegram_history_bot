CREATE TABLE IF NOT EXISTS stats_forwards (
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('channel', 'person', 'other')),
  channel_id INTEGER,
  channel_title TEXT,
  channel_username TEXT,
  CHECK (
    (source_type = 'channel' AND channel_id IS NOT NULL) OR
    (source_type <> 'channel' AND channel_id IS NULL AND channel_title IS NULL AND channel_username IS NULL)
  ),
  PRIMARY KEY (chat_id, message_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_stats_forwards_chat_day ON stats_forwards (chat_id, day);
