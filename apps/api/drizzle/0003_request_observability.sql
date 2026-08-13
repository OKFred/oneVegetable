CREATE TABLE IF NOT EXISTS request_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_time_utc INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  runtime TEXT NOT NULL CHECK (runtime IN ('node', 'cloudflare')),
  route TEXT NOT NULL,
  operation TEXT NOT NULL,
  actor_id TEXT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'error', 'denied')),
  status_code INTEGER NOT NULL,
  duration_milliseconds INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS request_events_request_id_index ON request_events (request_id);
CREATE INDEX IF NOT EXISTS request_events_time_index ON request_events (event_time_utc);
CREATE INDEX IF NOT EXISTS request_events_actor_id_index ON request_events (actor_id);
CREATE INDEX IF NOT EXISTS request_events_outcome_index ON request_events (outcome);

INSERT OR IGNORE INTO schema_migrations (version, applied_time_utc)
VALUES (3, CAST(unixepoch('subsec') * 1000 AS INTEGER));
