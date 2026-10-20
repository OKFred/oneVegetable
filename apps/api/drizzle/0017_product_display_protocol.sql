-- Rebuild the old cipher-required CHECK without changing legacy receipt ownership.
DROP INDEX product_mutation_jobs_request_target_unique;
DROP INDEX product_mutation_jobs_open_product_unique;
DROP INDEX product_mutation_jobs_open_creation_fingerprint_unique;
DROP INDEX product_mutation_jobs_product_time_index;
DROP INDEX product_mutation_jobs_status_time_index;
DROP INDEX product_mutation_jobs_batch_index;
ALTER TABLE product_mutation_jobs RENAME TO product_mutation_jobs_v16;
CREATE TABLE product_mutation_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('publishProduct','saveProductDraft','updateProduct','updateProductDisplay')),
  status TEXT NOT NULL CHECK (status IN ('submitted','auditing','verifying','verified','recovery-required','recovering','recovered','failed')),
  category_id INTEGER CHECK (category_id IS NULL OR category_id > 0),
  language TEXT CHECK (language IS NULL OR language IN ('zh_CN','en_US')),
  payload_fingerprint TEXT NOT NULL CHECK (length(payload_fingerprint) = 64),
  field_expectations_json TEXT NOT NULL CHECK (json_valid(field_expectations_json)),
  encrypted_product_id TEXT,
  target_display TEXT CHECK (target_display IS NULL OR target_display IN ('online','offline')),
  original_display TEXT CHECK (original_display IS NULL OR original_display IN ('online','offline')),
  trace_id TEXT,
  reason_code TEXT,
  message TEXT,
  submitted_time_utc INTEGER NOT NULL,
  last_checked_time_utc INTEGER,
  completed_time_utc INTEGER,
  create_time_utc INTEGER NOT NULL,
  update_time_utc INTEGER NOT NULL,
  creator_id TEXT NOT NULL,
  updater_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  remark TEXT,
  batch_id TEXT,
  product_identity TEXT,
  product_gateway TEXT,
  authorization_protocol TEXT CHECK (authorization_protocol IN ('top','iop')),
  recovery_request_id TEXT,
  CHECK (
    (operation IN ('publishProduct','saveProductDraft','updateProduct')
      AND category_id IS NOT NULL AND language IS NOT NULL
      AND encrypted_product_id IS NULL AND target_display IS NULL AND original_display IS NULL)
    OR (operation = 'updateProductDisplay' AND category_id IS NULL AND language IS NULL
      AND target_display IS NOT NULL AND original_display IS NOT NULL
      AND ((COALESCE(authorization_protocol, 'top') = 'iop'
        AND product_identity IS NOT NULL AND length(product_identity) = 64
        AND product_gateway IS NOT NULL AND length(product_gateway) = 64)
        OR (COALESCE(authorization_protocol, 'top') = 'top' AND encrypted_product_id IS NOT NULL)))
  )
);
INSERT INTO product_mutation_jobs (
  id,request_id,product_id,operation,status,category_id,language,payload_fingerprint,field_expectations_json,
  encrypted_product_id,target_display,original_display,trace_id,reason_code,message,
  submitted_time_utc,last_checked_time_utc,completed_time_utc,create_time_utc,update_time_utc,creator_id,updater_id,revision,remark,
  batch_id,product_identity,product_gateway
)
SELECT id,request_id,product_id,operation,status,category_id,language,payload_fingerprint,field_expectations_json,
  encrypted_product_id,target_display,original_display,trace_id,reason_code,message,
  submitted_time_utc,last_checked_time_utc,completed_time_utc,create_time_utc,update_time_utc,creator_id,updater_id,revision,remark,
  batch_id,product_identity,product_gateway FROM product_mutation_jobs_v16;
DROP TABLE product_mutation_jobs_v16;
CREATE UNIQUE INDEX product_mutation_jobs_request_target_unique ON product_mutation_jobs(request_id,product_id,operation);
CREATE UNIQUE INDEX product_mutation_jobs_open_product_unique ON product_mutation_jobs(product_id)
  WHERE status IN ('submitted','auditing','verifying','recovery-required','recovering');
CREATE UNIQUE INDEX product_mutation_jobs_open_creation_fingerprint_unique ON product_mutation_jobs(operation,payload_fingerprint)
  WHERE operation IN ('publishProduct','saveProductDraft') AND status IN ('submitted','auditing','verifying','recovery-required','recovering');
CREATE INDEX product_mutation_jobs_product_time_index ON product_mutation_jobs(product_id,submitted_time_utc DESC);
CREATE INDEX product_mutation_jobs_status_time_index ON product_mutation_jobs(status,update_time_utc DESC);
CREATE INDEX product_mutation_jobs_batch_index ON product_mutation_jobs(batch_id,submitted_time_utc);

INSERT INTO schema_migrations (version, applied_time_utc)
VALUES (17, CAST(unixepoch('subsec') * 1000 AS INTEGER));
