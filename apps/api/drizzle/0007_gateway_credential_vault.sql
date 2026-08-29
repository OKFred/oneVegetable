ALTER TABLE users ADD COLUMN password_login_enabled INTEGER NOT NULL DEFAULT 1;

CREATE TABLE alibaba_gateway_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  encrypted_bundle TEXT NOT NULL,
  initialization_vector TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  key_version INTEGER NOT NULL,
  access_token_expires_time_utc INTEGER,
  refresh_token_expires_time_utc INTEGER,
  refresh_lease_id TEXT,
  refresh_lease_until_utc INTEGER,
  last_refresh_time_utc INTEGER,
  last_refresh_error_code TEXT,
  create_time_utc INTEGER NOT NULL,
  update_time_utc INTEGER NOT NULL,
  creator_id TEXT NOT NULL,
  updater_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  remark TEXT,
  CHECK (id = 'primary'),
  CHECK (algorithm = 'AES-256-GCM'),
  CHECK (schema_version = 1),
  CHECK (key_version >= 1)
);

INSERT INTO schema_migrations (version, applied_time_utc)
VALUES (7, CAST(unixepoch('subsec') * 1000 AS INTEGER));
