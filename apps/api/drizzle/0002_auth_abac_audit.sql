CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until_utc INTEGER NULL,
  create_time_utc INTEGER NOT NULL,
  update_time_utc INTEGER NOT NULL,
  creator_id TEXT NOT NULL,
  updater_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  remark TEXT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (username);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL,
  csrf_token_hash TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  absolute_expires_time_utc INTEGER NOT NULL,
  idle_expires_time_utc INTEGER NOT NULL,
  create_time_utc INTEGER NOT NULL,
  update_time_utc INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_unique ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS sessions_user_id_index ON sessions (user_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_time_utc INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  actor_id TEXT NULL,
  action TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  resource_id TEXT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'error', 'denied')),
  reason_code TEXT NOT NULL,
  revision_before INTEGER NULL,
  revision_after INTEGER NULL
);

CREATE INDEX IF NOT EXISTS audit_events_request_id_index ON audit_events (request_id);
CREATE INDEX IF NOT EXISTS audit_events_time_index ON audit_events (event_time_utc);
CREATE INDEX IF NOT EXISTS audit_events_actor_id_index ON audit_events (actor_id);

INSERT OR IGNORE INTO schema_migrations (version, applied_time_utc)
VALUES (2, CAST(unixepoch('subsec') * 1000 AS INTEGER));
