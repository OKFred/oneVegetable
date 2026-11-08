-- Credentials are write-only; attempt receipts contain no shipment or provider response.
CREATE TABLE shipping_service_configurations (
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'freightos'),
  ciphertext TEXT,
  initialization_vector TEXT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at_utc INTEGER NOT NULL,
  PRIMARY KEY (owner_id, provider),
  CHECK ((ciphertext IS NULL) = (initialization_vector IS NULL))
);

CREATE TABLE shipping_quote_attempts (
  owner_id TEXT NOT NULL,
  request_id TEXT COLLATE NOCASE NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'freightos'),
  configuration_revision INTEGER NOT NULL CHECK (configuration_revision >= 1),
  day_utc INTEGER NOT NULL,
  attempted_at_utc INTEGER NOT NULL,
  -- Serial lease released; this is NOT a successful or accepted quote receipt.
  completed_at_utc INTEGER,
  outcome_unknown INTEGER NOT NULL DEFAULT 1 CHECK (outcome_unknown IN (0, 1)),
  PRIMARY KEY (owner_id, request_id)
);
CREATE INDEX shipping_quote_attempts_daily
  ON shipping_quote_attempts(owner_id, provider, day_utc);
CREATE UNIQUE INDEX shipping_quote_attempts_serial
  ON shipping_quote_attempts(owner_id, provider) WHERE completed_at_utc IS NULL;

INSERT INTO schema_migrations (version, applied_time_utc)
VALUES (20, CAST(unixepoch('subsec') * 1000 AS INTEGER));
