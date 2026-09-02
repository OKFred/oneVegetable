CREATE TABLE meta_app_configurations (
  id TEXT PRIMARY KEY NOT NULL,
  app_id TEXT NOT NULL,
  encrypted_app_secret TEXT NOT NULL,
  initialization_vector TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  key_version INTEGER NOT NULL,
  graph_api_version TEXT NOT NULL,
  public_origin TEXT NOT NULL,
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

CREATE TABLE meta_oauth_grants (
  id TEXT PRIMARY KEY NOT NULL,
  account_external_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  encrypted_user_token TEXT NOT NULL,
  initialization_vector TEXT NOT NULL,
  granted_scopes_json TEXT NOT NULL,
  token_expires_time_utc INTEGER,
  status TEXT NOT NULL,
  create_time_utc INTEGER NOT NULL,
  update_time_utc INTEGER NOT NULL,
  creator_id TEXT NOT NULL,
  updater_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  remark TEXT,
  CHECK (status IN ('connected', 'reconnect-required', 'disconnected'))
);

CREATE UNIQUE INDEX meta_oauth_grants_account_unique
  ON meta_oauth_grants(account_external_id);
CREATE INDEX meta_oauth_grants_status_index
  ON meta_oauth_grants(status, update_time_utc);

CREATE TABLE social_destinations (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL REFERENCES meta_oauth_grants(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  page_external_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  initialization_vector TEXT NOT NULL,
  tasks_json TEXT NOT NULL,
  can_publish INTEGER NOT NULL,
  unavailable_reason_code TEXT,
  create_time_utc INTEGER NOT NULL,
  update_time_utc INTEGER NOT NULL,
  CHECK (platform IN ('facebook', 'instagram')),
  CHECK (can_publish IN (0, 1))
);

CREATE UNIQUE INDEX social_destinations_platform_external_unique
  ON social_destinations(platform, external_id);
CREATE INDEX social_destinations_connection_index
  ON social_destinations(connection_id, platform);

CREATE TABLE meta_oauth_states (
  id TEXT PRIMARY KEY NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callback_url TEXT NOT NULL,
  expires_time_utc INTEGER NOT NULL,
  consumed_time_utc INTEGER,
  create_time_utc INTEGER NOT NULL
);

CREATE INDEX meta_oauth_states_expiry_index
  ON meta_oauth_states(expires_time_utc, consumed_time_utc);

CREATE TABLE social_media_assets (
  id TEXT PRIMARY KEY NOT NULL,
  opaque_token_hash TEXT NOT NULL UNIQUE,
  storage_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  expires_time_utc INTEGER NOT NULL,
  create_time_utc INTEGER NOT NULL
);

CREATE INDEX social_media_assets_expiry_index
  ON social_media_assets(expires_time_utc);

CREATE TABLE social_publish_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  destination_id TEXT NOT NULL REFERENCES social_destinations(id),
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  encrypted_caption TEXT NOT NULL,
  caption_initialization_vector TEXT NOT NULL,
  caption_length INTEGER NOT NULL,
  asset_id TEXT NOT NULL REFERENCES social_media_assets(id),
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  platform_container_id TEXT,
  platform_post_id TEXT,
  platform_request_id TEXT,
  platform_trace_id TEXT,
  publish_attempted_time_utc INTEGER,
  final_publish_attempted_time_utc INTEGER,
  next_advance_time_utc INTEGER,
  reason_code TEXT,
  message TEXT,
  expires_time_utc INTEGER NOT NULL,
  create_time_utc INTEGER NOT NULL,
  update_time_utc INTEGER NOT NULL,
  creator_id TEXT NOT NULL,
  updater_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  remark TEXT,
  CHECK (platform IN ('facebook', 'instagram')),
  CHECK (status IN ('prepared', 'processing', 'published', 'failed', 'unknown', 'cancelled', 'expired'))
);

CREATE INDEX social_publish_jobs_status_time_index
  ON social_publish_jobs(status, update_time_utc);
CREATE INDEX social_publish_jobs_actor_time_index
  ON social_publish_jobs(creator_id, create_time_utc);
CREATE INDEX social_publish_jobs_destination_time_index
  ON social_publish_jobs(destination_id, create_time_utc);

CREATE TABLE extension_social_pairings (
  id TEXT PRIMARY KEY NOT NULL,
  pairing_code_hash TEXT NOT NULL UNIQUE,
  extension_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  status TEXT NOT NULL,
  approved_by TEXT REFERENCES users(id),
  device_id TEXT,
  expires_time_utc INTEGER NOT NULL,
  create_time_utc INTEGER NOT NULL,
  update_time_utc INTEGER NOT NULL,
  CHECK (status IN ('pending', 'approved', 'consumed', 'cancelled', 'expired'))
);

CREATE INDEX extension_social_pairings_expiry_index
  ON extension_social_pairings(status, expires_time_utc);

CREATE TABLE extension_social_devices (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  extension_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_time_utc INTEGER NOT NULL,
  last_used_time_utc INTEGER,
  create_time_utc INTEGER NOT NULL,
  update_time_utc INTEGER NOT NULL,
  creator_id TEXT NOT NULL,
  updater_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  remark TEXT,
  CHECK (status IN ('active', 'revoked', 'expired'))
);

CREATE INDEX extension_social_devices_status_expiry_index
  ON extension_social_devices(status, expires_time_utc);
CREATE INDEX extension_social_devices_extension_index
  ON extension_social_devices(extension_id, status);

INSERT INTO schema_migrations (version, applied_time_utc)
VALUES (10, CAST(unixepoch('subsec') * 1000 AS INTEGER));
