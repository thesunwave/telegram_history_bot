-- Forward migration: criminal event-date correctness.
-- Persist/query canonical message timestamp/day for criminal violations.
-- Previously created_at = processing time; now also persist violation_day/violation_ts.
-- Backward compatible: column may be NULL for old rows.

ALTER TABLE criminal_violations ADD COLUMN violation_day TEXT;
ALTER TABLE criminal_violations ADD COLUMN violation_ts INTEGER;
CREATE INDEX IF NOT EXISTS idx_criminal_violations_violation_day ON criminal_violations(violation_day);
CREATE INDEX IF NOT EXISTS idx_criminal_violations_violation_ts ON criminal_violations(violation_ts);
