-- Phase 3a correction: D1-authoritative backfill job state + coverage reason codes
-- Forward-only and additive: one new table and one nullable column. No drops,
-- renames, or changes to existing rows. Applied after 0009 in the same database
-- (summaries), so the job checkpoint lives in the same transactional store as
-- the aggregate rows it writes

-- Singleton named backfill job state. D1 is the authoritative checkpoint for
-- the full-history aggregate backfill. Progress is never stored in COUNTERS KV
CREATE TABLE IF NOT EXISTS stats_backfill_state (
  job_name TEXT PRIMARY KEY,          -- 'daily_aggregates_v1'
  version INTEGER NOT NULL,           -- state model version (bump invalidates old rows)
  status TEXT NOT NULL,               -- 'running' | 'done'
  phase TEXT NOT NULL,                -- base|words|media_stats|media_duration|profanity|criminal|criminal_severity|hours|buckets|profanity_words|profanity_word_users|finalize|done
  cutoff_day TEXT NOT NULL,           -- immutable UTC day (YYYY-MM-DD) persisted at job init
                                      -- source keys with day >= cutoff are skipped (live dual-write owns them)
  cursor TEXT,                        -- KV list cursor used to fetch the current page (NULL = start)
                                      -- for the finalize phase it is the (chat_id:day) page cursor
  page_offset INTEGER NOT NULL DEFAULT 0, -- index into the current list page
  lease_owner TEXT,                   -- opaque per-invocation run id
  lease_expires_at INTEGER,           -- unix seconds (expired or absent lease is acquirable)
  revision INTEGER NOT NULL DEFAULT 0,  -- bumped on every state write (CAS/audit)
  error_code TEXT,                    -- safe enumerated job error code, never raw text
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Safe, short, enumerated reason for a (chat_id, day) that must NOT be served
-- as complete. Live writes never set this. Backfill sets it for anomalies and
-- clears it only when finalize parity succeeds. Values come from the closed set
-- source_key_invalid, source_value_invalid, missing_activity_total,
-- message_count_mismatch
ALTER TABLE stats_daily_coverage ADD COLUMN reason_code TEXT;
