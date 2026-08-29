-- Chat-scoped profile prevents a username observed in one chat leaking into another.
CREATE TABLE IF NOT EXISTS stats_chat_user_profile (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  last_message_ts INTEGER,
  PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_stats_chat_user_profile_chat
  ON stats_chat_user_profile (chat_id);
