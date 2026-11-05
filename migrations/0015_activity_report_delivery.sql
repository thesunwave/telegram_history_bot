-- Atomic, at-most-once claim for opt-in daily activity reports.
-- Claim before contacting Telegram: an ambiguous network failure must not
-- cause a second copy of the same report to be delivered.
CREATE TABLE IF NOT EXISTS activity_report_delivery (
  chat_id INTEGER NOT NULL,
  report_day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'claimed',
  claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  PRIMARY KEY (chat_id, report_day)
);
