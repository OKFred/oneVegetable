CREATE TABLE IF NOT EXISTS product_description_templates (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  category TEXT NOT NULL CHECK (category IN ('company', 'logistics', 'packaging', 'service', 'custom')),
  language TEXT NOT NULL CHECK (language IN ('zh_CN', 'en_US')),
  html TEXT NOT NULL CHECK (length(CAST(html AS BLOB)) <= 262144),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  create_time_utc INTEGER NOT NULL,
  update_time_utc INTEGER NOT NULL,
  creator_id TEXT NOT NULL,
  updater_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  remark TEXT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS product_description_templates_language_name_unique
  ON product_description_templates (language, lower(name));
CREATE INDEX IF NOT EXISTS product_description_templates_language_status_index
  ON product_description_templates (language, status);
CREATE INDEX IF NOT EXISTS product_description_templates_category_index
  ON product_description_templates (category);

INSERT OR IGNORE INTO schema_migrations (version, applied_time_utc)
VALUES (4, CAST(unixepoch('subsec') * 1000 AS INTEGER));
