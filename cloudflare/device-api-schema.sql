-- Run once:  npx wrangler d1 execute trackmenow --remote --file=device-api-schema.sql
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  device_token_hash TEXT NOT NULL,
  viewer_token_hash TEXT,
  pairing_code_hash TEXT,
  pairing_expires_at TEXT,
  consented_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS devices_phone_idx ON devices(phone);
CREATE INDEX IF NOT EXISTS devices_pairing_idx ON devices(pairing_code_hash);
CREATE INDEX IF NOT EXISTS devices_viewer_idx ON devices(viewer_token_hash);

CREATE TABLE IF NOT EXISTS telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  accuracy REAL,
  altitude REAL,
  speed REAL,
  heading REAL,
  radio_json TEXT,
  FOREIGN KEY(device_id) REFERENCES devices(id)
);
CREATE INDEX IF NOT EXISTS telemetry_device_time_idx ON telemetry(device_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
