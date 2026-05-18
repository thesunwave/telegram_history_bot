-- Adds context-aware criminal analysis metadata.

ALTER TABLE criminal_violations ADD COLUMN decision TEXT;
ALTER TABLE criminal_violations ADD COLUMN evidence_json TEXT;
ALTER TABLE criminal_violations ADD COLUMN target_message_id INTEGER;
ALTER TABLE criminal_violations ADD COLUMN context_before INTEGER;
ALTER TABLE criminal_violations ADD COLUMN context_after INTEGER;
ALTER TABLE criminal_violations ADD COLUMN context_total_messages INTEGER;

CREATE INDEX idx_criminal_violations_target_message_id ON criminal_violations(target_message_id);
CREATE INDEX idx_criminal_violations_decision ON criminal_violations(decision);
