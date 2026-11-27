-- Rise from Read-Only is announced by default. Members can opt out in their album.
ALTER TABLE achievement_enrollments ADD COLUMN comeback_muted INTEGER NOT NULL DEFAULT 0;
-- Group badges are announced as soon as the open week proves them.
ALTER TABLE achievement_groups ADD COLUMN next_live_check INTEGER NOT NULL DEFAULT 0;
CREATE INDEX achievement_live_due ON achievement_groups(next_live_check,chat_id) WHERE enabled=1;
ALTER TABLE achievement_awards ADD COLUMN live_at INTEGER;
ALTER TABLE achievement_awards ADD COLUMN announce_at INTEGER;
CREATE INDEX achievement_announce_due ON achievement_awards(announce_at) WHERE announce_at IS NOT NULL;
