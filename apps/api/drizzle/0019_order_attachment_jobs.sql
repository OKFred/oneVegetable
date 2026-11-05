-- Receipts only: bytes, credentials and raw provider responses are never stored.
CREATE TABLE order_attachment_jobs (
  job_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
  record_json TEXT NOT NULL CHECK (
    length(record_json) <= 16384 AND json_valid(record_json)
    AND json_extract(record_json, '$.ownerId') IS owner_id
    AND json_extract(record_json, '$.fingerprint') IS fingerprint
    AND json_extract(record_json, '$.receipt.jobId') IS job_id
    AND json_extract(record_json, '$.receipt.requestId') IS job_id
    AND json_extract(record_json, '$.receipt.gatewayId') IS json_extract(record_json, '$.context.gateway')
    AND json_extract(record_json, '$.receipt.protocol') IS 'iop'
    AND json_extract(record_json, '$.receipt.status') IN ('sending', 'accepted', 'failed', 'unknown')
  )
);

-- Lost responses must not be retried under a new ID. Accepted uploads may be explicitly repeated.
CREATE UNIQUE INDEX order_attachment_jobs_pending_content
ON order_attachment_jobs (
  owner_id,
  json_extract(record_json, '$.context.gateway'),
  json_extract(record_json, '$.receipt.sha256')
)
WHERE json_extract(record_json, '$.receipt.status') IN ('sending', 'unknown');

-- An attempted upload cannot change owner, context, file fingerprint or original intent.
CREATE TRIGGER order_attachment_jobs_immutable_update
BEFORE UPDATE ON order_attachment_jobs
WHEN NEW.job_id IS NOT OLD.job_id OR NEW.owner_id IS NOT OLD.owner_id
  OR NEW.fingerprint IS NOT OLD.fingerprint
  OR json_extract(OLD.record_json, '$.receipt.status') IS NOT 'sending'
  OR json_extract(NEW.record_json, '$.receipt.status') NOT IN ('accepted', 'failed', 'unknown')
  OR json_extract(NEW.record_json, '$.receipt.updatedTimeUtc') < json_extract(OLD.record_json, '$.receipt.updatedTimeUtc')
  OR json_remove(NEW.record_json, '$.receipt.status', '$.receipt.platformReference', '$.receipt.errorCode', '$.receipt.traceId', '$.receipt.updatedTimeUtc')
     IS NOT json_remove(OLD.record_json, '$.receipt.status', '$.receipt.platformReference', '$.receipt.errorCode', '$.receipt.traceId', '$.receipt.updatedTimeUtc')
BEGIN
  SELECT RAISE(ABORT, 'ORDER_ATTACHMENT_RECORD_CORRUPT');
END;

INSERT INTO schema_migrations (version, applied_time_utc)
VALUES (19, CAST(unixepoch('subsec') * 1000 AS INTEGER));
