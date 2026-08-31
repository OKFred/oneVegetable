CREATE TABLE alibaba_credential_acquisition_jobs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  browser_session_id TEXT NULL,
  status TEXT NOT NULL,
  state_json TEXT NOT NULL,
  selected_application_id TEXT NULL,
  requested_callback_url TEXT NULL,
  active_slot INTEGER NULL,
  expires_time_utc INTEGER NOT NULL,
  create_time_utc INTEGER NOT NULL,
  update_time_utc INTEGER NOT NULL
);

CREATE UNIQUE INDEX alibaba_credential_acquisition_jobs_active_unique
  ON alibaba_credential_acquisition_jobs(active_slot)
  WHERE active_slot = 1;

CREATE INDEX alibaba_credential_acquisition_jobs_actor_time_index
  ON alibaba_credential_acquisition_jobs(actor_id, create_time_utc);

CREATE INDEX alibaba_credential_acquisition_jobs_expiry_index
  ON alibaba_credential_acquisition_jobs(active_slot, expires_time_utc);

INSERT INTO schema_migrations (version, applied_time_utc)
VALUES (9, CAST(unixepoch('subsec') * 1000 AS INTEGER));
