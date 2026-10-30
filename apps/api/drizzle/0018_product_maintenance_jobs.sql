-- Durable intent metadata/receipts only. No credentials, raw provider bodies or URLs.
CREATE TABLE product_maintenance_jobs (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  context_identity TEXT NOT NULL CHECK (length(context_identity) = 64),
  context_gateway TEXT NOT NULL CHECK (length(context_gateway) = 64),
  entity_keys_json TEXT NOT NULL CHECK (
    json_valid(entity_keys_json) AND json_type(entity_keys_json) = 'array'
    AND json_array_length(entity_keys_json) > 0
  ),
  request_id TEXT NOT NULL,
  payload_fingerprint TEXT NOT NULL CHECK (length(payload_fingerprint) = 64),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL CHECK (
    status IN ('prepared', 'dispatching', 'accepted', 'rejected', 'partial', 'ambiguous', 'verified', 'cancelled')
  ),
  submit_attempted INTEGER NOT NULL CHECK (submit_attempted IN (0, 1)),
  create_time_utc INTEGER NOT NULL CHECK (create_time_utc >= 0),
  update_time_utc INTEGER NOT NULL CHECK (update_time_utc >= create_time_utc),
  active INTEGER NOT NULL CHECK (
    active = CASE WHEN status IN ('verified', 'rejected', 'cancelled') THEN 0 ELSE 1 END
  ),
  record_json TEXT NOT NULL CHECK (
    length(record_json) <= 100000 AND json_valid(record_json)
    AND json_extract(record_json, '$.ownerId') IS owner_id
    AND json_extract(record_json, '$.task.id') IS id
    AND json_extract(record_json, '$.task.revision') IS revision
    AND json_extract(record_json, '$.task.context.identity') IS context_identity
    AND json_extract(record_json, '$.task.context.gateway') IS context_gateway
    AND json_extract(record_json, '$.task.requestId') IS request_id
    AND json_extract(record_json, '$.task.intent.fingerprint') IS payload_fingerprint
    AND json_extract(record_json, '$.task.status') IS status
    AND json_extract(record_json, '$.task.submitAttempted') IS submit_attempted
    AND json_extract(record_json, '$.task.createTimeUtc') IS create_time_utc
    AND json_extract(record_json, '$.task.updateTimeUtc') IS update_time_utc
  ),
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX product_maintenance_jobs_owner_updated
  ON product_maintenance_jobs(owner_id, update_time_utc DESC, id);
CREATE INDEX product_maintenance_jobs_context_active
  ON product_maintenance_jobs(owner_id, context_identity, context_gateway, active);

-- A single SQLite/D1 statement checks every entity atomically. Price/inventory share
-- product:<id>; draft deletion uses draft:<id>. Partial/unknown jobs keep ALL locks.
CREATE TRIGGER product_maintenance_jobs_exclusive_insert
BEFORE INSERT ON product_maintenance_jobs
WHEN NEW.active = 1
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_MAINTENANCE_ENTITY_BUSY')
  WHERE EXISTS (
    SELECT 1 FROM product_maintenance_jobs AS other
    JOIN json_each(other.entity_keys_json) AS held
    JOIN json_each(NEW.entity_keys_json) AS incoming ON incoming.value = held.value
    WHERE other.owner_id = NEW.owner_id
      AND other.context_identity = NEW.context_identity
      AND other.context_gateway = NEW.context_gateway
      AND other.active = 1 AND other.id <> NEW.id
  );
END;

CREATE TRIGGER product_maintenance_jobs_exclusive_update
BEFORE UPDATE ON product_maintenance_jobs
WHEN NEW.active = 1
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_MAINTENANCE_ENTITY_BUSY')
  WHERE EXISTS (
    SELECT 1 FROM product_maintenance_jobs AS other
    JOIN json_each(other.entity_keys_json) AS held
    JOIN json_each(NEW.entity_keys_json) AS incoming ON incoming.value = held.value
    WHERE other.owner_id = NEW.owner_id
      AND other.context_identity = NEW.context_identity
      AND other.context_gateway = NEW.context_gateway
      AND other.active = 1 AND other.id <> NEW.id
  );
END;

-- Context, intent and entity ownership cannot be moved; an attempted send cannot
-- be reset, and completed jobs cannot be reactivated under an existing task ID.
CREATE TRIGGER product_maintenance_jobs_immutable_update
BEFORE UPDATE ON product_maintenance_jobs
WHEN NEW.owner_id IS NOT OLD.owner_id
  OR NEW.id IS NOT OLD.id
  OR NEW.context_identity IS NOT OLD.context_identity
  OR NEW.context_gateway IS NOT OLD.context_gateway
  OR NEW.entity_keys_json IS NOT OLD.entity_keys_json
  OR NEW.request_id IS NOT OLD.request_id
  OR NEW.payload_fingerprint IS NOT OLD.payload_fingerprint
  OR json_extract(NEW.record_json, '$.task.intent') IS NOT json_extract(OLD.record_json, '$.task.intent')
  OR json_extract(NEW.record_json, '$.task.baseline') IS NOT json_extract(OLD.record_json, '$.task.baseline')
  OR NEW.create_time_utc IS NOT OLD.create_time_utc
  OR NEW.revision <> OLD.revision + 1
  OR NEW.update_time_utc < OLD.update_time_utc
  OR (OLD.submit_attempted = 1 AND NEW.submit_attempted = 0)
  OR (OLD.active = 0 AND NEW.status IS NOT OLD.status)
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_MAINTENANCE_TASK_CORRUPT');
END;

INSERT INTO schema_migrations (version, applied_time_utc)
VALUES (18, CAST(unixepoch('subsec') * 1000 AS INTEGER));
