-- For a database that was created with the OLD schema (devices + telemetry only).
-- Run once in the D1 Console. Safe to skip on a brand-new database that used device-api-schema.sql.
ALTER TABLE devices ADD COLUMN pairing_expires_at TEXT;
CREATE INDEX IF NOT EXISTS devices_pairing_idx ON devices(pairing_code_hash);
CREATE INDEX IF NOT EXISTS devices_viewer_idx ON devices(viewer_token_hash);
CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
