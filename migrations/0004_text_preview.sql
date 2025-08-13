-- 0004_text_preview.sql
-- Adds optional text_preview column to criminal_violations with index
-- This migration is idempotent and safe to run multiple times

-- Add column text_preview if it does not exist
-- Cloudflare D1 uses modern SQLite, so simple ALTER should work
ALTER TABLE criminal_violations ADD COLUMN text_preview TEXT;

-- Optional: create an index to speed up queries by preview if needed (rare). Skipping for now.
-- CREATE INDEX IF NOT EXISTS idx_criminal_violations_text_preview ON criminal_violations(text_preview);