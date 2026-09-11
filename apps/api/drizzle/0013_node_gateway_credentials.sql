-- Preserve legacy ciphertext and its AAD version while allowing the internal v2 document.
CREATE TABLE alibaba_gateway_credentials_v2 (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'primary'),
  encrypted_bundle TEXT NOT NULL,
  initialization_vector TEXT NOT NULL,
  algorithm TEXT NOT NULL CHECK (algorithm = 'AES-256-GCM'),
  schema_version INTEGER NOT NULL CHECK (schema_version IN (1, 2)),
  key_version INTEGER NOT NULL CHECK (key_version >= 1),
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
  remark TEXT
);
INSERT INTO alibaba_gateway_credentials_v2 SELECT * FROM alibaba_gateway_credentials;
DROP TABLE alibaba_gateway_credentials;
ALTER TABLE alibaba_gateway_credentials_v2 RENAME TO alibaba_gateway_credentials;

-- Tombstone survives clearing; a managed service must never silently reuse startup credentials.
CREATE TABLE alibaba_gateway_credential_control (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'primary'),
  revision INTEGER NOT NULL,
  configuration_id TEXT NOT NULL
);
INSERT INTO alibaba_gateway_credential_control
  SELECT id, revision, lower(hex(randomblob(16))) FROM alibaba_gateway_credentials;
CREATE TRIGGER gateway_credential_insert AFTER INSERT ON alibaba_gateway_credentials BEGIN
  INSERT INTO alibaba_gateway_credential_control VALUES (NEW.id, NEW.revision, lower(hex(randomblob(16))))
  ON CONFLICT(id) DO UPDATE SET revision = NEW.revision, configuration_id = excluded.configuration_id;
END;
CREATE TRIGGER gateway_credential_update AFTER UPDATE ON alibaba_gateway_credentials BEGIN
  UPDATE alibaba_gateway_credential_control SET revision = NEW.revision WHERE id = NEW.id;
END;
CREATE TRIGGER gateway_credential_delete AFTER DELETE ON alibaba_gateway_credentials BEGIN
  UPDATE alibaba_gateway_credential_control SET revision = OLD.revision + 1, configuration_id = lower(hex(randomblob(16))) WHERE id = OLD.id;
END;
INSERT INTO schema_migrations (version, applied_time_utc) VALUES (13, CAST(unixepoch('subsec') * 1000 AS INTEGER));
