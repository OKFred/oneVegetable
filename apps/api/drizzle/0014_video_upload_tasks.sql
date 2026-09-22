-- Metadata and receipts only: no file bytes, URLs, signed credentials or provider bodies.
CREATE TABLE video_upload_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  update_time_utc INTEGER NOT NULL,
  record_json TEXT NOT NULL CHECK (json_valid(record_json))
);
CREATE INDEX video_upload_tasks_owner_updated ON video_upload_tasks(owner_id, update_time_utc);
INSERT INTO schema_migrations (version, applied_time_utc) VALUES (14, CAST(unixepoch('subsec') * 1000 AS INTEGER));
