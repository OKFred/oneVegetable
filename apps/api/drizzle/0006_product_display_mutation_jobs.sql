DROP INDEX IF EXISTS product_mutation_jobs_request_id_unique;
DROP INDEX IF EXISTS product_mutation_jobs_open_product_unique;
DROP INDEX IF EXISTS product_mutation_jobs_product_time_index;
DROP INDEX IF EXISTS product_mutation_jobs_status_time_index;

ALTER TABLE product_mutation_jobs RENAME TO product_mutation_jobs_v5;

CREATE TABLE product_mutation_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('updateProduct', 'updateProductDisplay')),
  status TEXT NOT NULL CHECK (
    status IN (
      'submitted',
      'auditing',
      'verifying',
      'verified',
      'recovery-required',
      'recovering',
      'recovered',
      'failed'
    )
  ),
  category_id INTEGER NULL CHECK (category_id IS NULL OR category_id > 0),
  language TEXT NULL CHECK (language IS NULL OR language IN ('zh_CN', 'en_US')),
  payload_fingerprint TEXT NOT NULL CHECK (length(payload_fingerprint) = 64),
  field_expectations_json TEXT NOT NULL CHECK (json_valid(field_expectations_json)),
  encrypted_product_id TEXT NULL,
  target_display TEXT NULL CHECK (target_display IS NULL OR target_display IN ('online', 'offline')),
  original_display TEXT NULL CHECK (original_display IS NULL OR original_display IN ('online', 'offline')),
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
  remark TEXT NULL,
  CHECK (
    (
      operation = 'updateProduct'
      AND category_id IS NOT NULL
      AND language IS NOT NULL
      AND encrypted_product_id IS NULL
      AND target_display IS NULL
      AND original_display IS NULL
    )
    OR
    (
      operation = 'updateProductDisplay'
      AND category_id IS NULL
      AND language IS NULL
      AND encrypted_product_id IS NOT NULL
      AND target_display IS NOT NULL
      AND original_display IS NOT NULL
    )
  )
);

INSERT INTO product_mutation_jobs (
  id,
  request_id,
  product_id,
  operation,
  status,
  category_id,
  language,
  payload_fingerprint,
  field_expectations_json,
  encrypted_product_id,
  target_display,
  original_display,
  trace_id,
  reason_code,
  message,
  submitted_time_utc,
  last_checked_time_utc,
  completed_time_utc,
  create_time_utc,
  update_time_utc,
  creator_id,
  updater_id,
  revision,
  remark
)
SELECT
  id,
  request_id,
  product_id,
  operation,
  status,
  category_id,
  language,
  payload_fingerprint,
  field_expectations_json,
  NULL,
  NULL,
  NULL,
  trace_id,
  reason_code,
  message,
  submitted_time_utc,
  last_checked_time_utc,
  completed_time_utc,
  create_time_utc,
  update_time_utc,
  creator_id,
  updater_id,
  revision,
  remark
FROM product_mutation_jobs_v5;

DROP TABLE product_mutation_jobs_v5;

CREATE UNIQUE INDEX product_mutation_jobs_request_target_unique
  ON product_mutation_jobs (request_id, product_id, operation);
CREATE UNIQUE INDEX product_mutation_jobs_open_product_unique
  ON product_mutation_jobs (product_id)
  WHERE status IN ('submitted', 'auditing', 'verifying', 'recovery-required', 'recovering');
CREATE INDEX product_mutation_jobs_product_time_index
  ON product_mutation_jobs (product_id, submitted_time_utc DESC);
CREATE INDEX product_mutation_jobs_status_time_index
  ON product_mutation_jobs (status, update_time_utc DESC);

INSERT OR IGNORE INTO schema_migrations (version, applied_time_utc)
VALUES (6, CAST(unixepoch('subsec') * 1000 AS INTEGER));
