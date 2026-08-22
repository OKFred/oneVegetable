CREATE TABLE IF NOT EXISTS product_mutation_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('updateProduct')),
  status TEXT NOT NULL CHECK (status IN ('submitted', 'auditing', 'verified', 'recovery-required', 'failed')),
  category_id INTEGER NOT NULL CHECK (category_id > 0),
  language TEXT NOT NULL CHECK (language IN ('zh_CN', 'en_US')),
  payload_fingerprint TEXT NOT NULL CHECK (length(payload_fingerprint) = 64),
  field_expectations_json TEXT NOT NULL CHECK (json_valid(field_expectations_json)),
  trace_id TEXT NULL,
  reason_code TEXT NULL,
  message TEXT NULL,
  submitted_time_utc INTEGER NOT NULL,
  last_checked_time_utc INTEGER NULL,
  completed_time_utc INTEGER NULL,
  create_time_utc INTEGER NOT NULL,
  update_time_utc INTEGER NOT NULL,
  creator_id TEXT NOT NULL,
  updater_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  remark TEXT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS product_mutation_jobs_request_id_unique
  ON product_mutation_jobs (request_id);
CREATE UNIQUE INDEX IF NOT EXISTS product_mutation_jobs_open_product_unique
  ON product_mutation_jobs (product_id)
  WHERE status IN ('submitted', 'auditing');
CREATE INDEX IF NOT EXISTS product_mutation_jobs_product_time_index
  ON product_mutation_jobs (product_id, submitted_time_utc DESC);
CREATE INDEX IF NOT EXISTS product_mutation_jobs_status_time_index
  ON product_mutation_jobs (status, update_time_utc DESC);

INSERT OR IGNORE INTO schema_migrations (version, applied_time_utc)
VALUES (5, CAST(unixepoch('subsec') * 1000 AS INTEGER));
