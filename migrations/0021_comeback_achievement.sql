ALTER TABLE achievement_enrollments ADD COLUMN comeback_last_message_ts INTEGER;
ALTER TABLE achievement_enrollments ADD COLUMN comeback_replies_since INTEGER;
ALTER TABLE achievement_awards ADD COLUMN comeback_reply_json TEXT;
ALTER TABLE achievement_awards ADD COLUMN comeback_reply_at INTEGER;
CREATE INDEX achievement_comeback_reply_due ON achievement_awards(comeback_reply_at)
  WHERE comeback_reply_at IS NOT NULL;
