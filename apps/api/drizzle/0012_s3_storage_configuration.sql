CREATE TABLE s3_storage_configurations (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'primary'),
  encrypted_configuration TEXT NOT NULL,
  initialization_vector TEXT NOT NULL,
  algorithm TEXT NOT NULL CHECK (algorithm = 'AES-256-GCM'),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  key_version INTEGER NOT NULL CHECK (key_version = 1),
  create_time_utc INTEGER NOT NULL,
  update_time_utc INTEGER NOT NULL,
  creator_id TEXT NOT NULL,
  updater_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  remark TEXT NULL
);

INSERT OR IGNORE INTO schema_migrations (version, applied_time_utc)
VALUES (12, CAST(unixepoch('subsec') * 1000 AS INTEGER));
