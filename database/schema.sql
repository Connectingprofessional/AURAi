CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS tracking_sessions (
  id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz
);

CREATE TABLE IF NOT EXISTS location_points (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL,
  position geography(Point,4326) NOT NULL,
  accuracy_m double precision,
  altitude_m double precision,
  heading_deg double precision,
  speed_mps double precision,
  source text NOT NULL DEFAULT 'browser-gps'
);

CREATE INDEX IF NOT EXISTS location_points_position_gix ON location_points USING GIST(position);
CREATE INDEX IF NOT EXISTS location_points_session_time_idx ON location_points(session_id, recorded_at DESC);