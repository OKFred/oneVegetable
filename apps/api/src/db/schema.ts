import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const schemaMigrations = sqliteTable('schema_migrations', {
  version: integer('version').primaryKey(),
  appliedTimeUtc: integer('applied_time_utc').notNull()
});

export const appMetadata = sqliteTable('app_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createTimeUtc: integer('create_time_utc').notNull(),
  updateTimeUtc: integer('update_time_utc').notNull(),
  creatorId: text('creator_id').notNull(),
  updaterId: text('updater_id').notNull(),
  revision: integer('revision').notNull().default(1),
  remark: text('remark')
});

export const schema = { schemaMigrations, appMetadata };
export const CURRENT_SCHEMA_VERSION = 1;
