ALTER TABLE product_mutation_jobs ADD COLUMN batch_id TEXT;
ALTER TABLE product_mutation_jobs ADD COLUMN product_identity TEXT;
ALTER TABLE product_mutation_jobs ADD COLUMN product_gateway TEXT;
CREATE INDEX product_mutation_jobs_batch_index ON product_mutation_jobs(batch_id, submitted_time_utc);
INSERT INTO schema_migrations (version, applied_time_utc) VALUES (15, CAST(unixepoch('subsec') * 1000 AS INTEGER));
