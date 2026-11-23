CREATE TABLE achievement_groups (
  chat_id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL, start_day TEXT NOT NULL,
  generation TEXT NOT NULL
);
CREATE INDEX achievement_enabled_groups ON achievement_groups(enabled,chat_id);
CREATE TABLE achievement_enrollments (
  chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL CHECK(user_id > 0),
  enabled INTEGER NOT NULL, start_day TEXT NOT NULL, generation TEXT NOT NULL,
  last_day TEXT, progress_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY(chat_id,user_id)
);
CREATE INDEX achievement_personal_due ON achievement_enrollments(enabled,last_day,chat_id,user_id);
CREATE INDEX achievement_owned_albums ON achievement_enrollments(user_id,chat_id);
CREATE TABLE achievement_awards (
  chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL CHECK(user_id >= 0),
  badge_id TEXT NOT NULL, earned_day TEXT NOT NULL, result TEXT NOT NULL,
  rule_version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(chat_id,user_id,badge_id)
);
CREATE TABLE achievement_reports (
  chat_id INTEGER NOT NULL, week TEXT NOT NULL, report_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ready', telegram_message_id INTEGER,
  PRIMARY KEY(chat_id,week)
);
CREATE INDEX achievement_user_groups ON stats_chat_user_profile(user_id,chat_id);
CREATE INDEX achievement_reposts_by_owner ON stats_forwards(chat_id,user_id,day)
  WHERE source_type='channel';
CREATE INDEX achievement_buckets_by_owner ON stats_daily_bucket_user(chat_id,user_id,day);
