CREATE TABLE webauthn_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key_base64url TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports_json TEXT NOT NULL DEFAULT '[]',
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL DEFAULT 0,
  rp_id TEXT NOT NULL,
  name TEXT NOT NULL,
  create_time_utc INTEGER NOT NULL,
  update_time_utc INTEGER NOT NULL,
  creator_id TEXT NOT NULL,
  updater_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  remark TEXT NULL
);

CREATE INDEX idx_webauthn_credentials_user_id
  ON webauthn_credentials(user_id, create_time_utc);

CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  user_id TEXT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NULL,
  rp_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  expires_time_utc INTEGER NOT NULL,
  consumed_time_utc INTEGER NULL,
  create_time_utc INTEGER NOT NULL
);

CREATE INDEX idx_webauthn_challenges_expiry
  ON webauthn_challenges(expires_time_utc, consumed_time_utc);

CREATE TABLE auth_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  consumed_time_utc INTEGER NULL,
  create_time_utc INTEGER NOT NULL
);

CREATE INDEX idx_auth_recovery_codes_user_id
  ON auth_recovery_codes(user_id, consumed_time_utc);

CREATE TABLE user_enrollment_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_time_utc INTEGER NOT NULL,
  consumed_time_utc INTEGER NULL,
  creator_id TEXT NOT NULL,
  create_time_utc INTEGER NOT NULL
);

CREATE INDEX idx_user_enrollment_tokens_expiry
  ON user_enrollment_tokens(expires_time_utc, consumed_time_utc);

INSERT INTO schema_migrations (version, applied_time_utc)
VALUES (8, CAST(unixepoch('subsec') * 1000 AS INTEGER));
