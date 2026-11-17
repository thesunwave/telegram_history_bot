-- Longest single voice message / video note per user and day.
-- Forward-only and additive: written by live CountersDO events only, so days
-- before this migration keep 0 ("unknown") and backfill never touches these columns.

ALTER TABLE stats_daily_user ADD COLUMN voice_max_duration_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats_daily_user ADD COLUMN video_note_max_duration_seconds INTEGER NOT NULL DEFAULT 0;
