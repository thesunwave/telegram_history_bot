ALTER TABLE achievement_groups ADD COLUMN next_report_check INTEGER NOT NULL DEFAULT 0;
ALTER TABLE achievement_enrollments ADD COLUMN next_album_check INTEGER NOT NULL DEFAULT 0;
ALTER TABLE achievement_reports ADD COLUMN next_send_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX achievement_report_due ON achievement_groups(enabled,next_report_check,chat_id);
CREATE INDEX achievement_album_due ON achievement_enrollments(enabled,next_album_check,chat_id,user_id);
