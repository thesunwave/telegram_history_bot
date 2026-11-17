-- Anonymous self-host install counting (received only by the hosted instance).
-- Additive: one row per random install id, no chat/user identifiers or IPs.
CREATE TABLE IF NOT EXISTS telemetry_installs (
  install_id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  active_chats_7d TEXT NOT NULL,
  active_groups_7d TEXT NOT NULL,
  ping_days INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_telemetry_installs_last_seen
  ON telemetry_installs (last_seen);
