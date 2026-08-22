import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    passwordSalt: text('password_salt').notNull(),
    role: text('role', { enum: ['admin', 'user'] }).notNull(),
    status: text('status', { enum: ['active', 'disabled'] }).notNull(),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntilUtc: integer('locked_until_utc'),
    createTimeUtc: integer('create_time_utc').notNull(),
    updateTimeUtc: integer('update_time_utc').notNull(),
    creatorId: text('creator_id').notNull(),
    updaterId: text('updater_id').notNull(),
    revision: integer('revision').notNull().default(1),
    remark: text('remark')
  },
  (table) => [uniqueIndex('users_username_unique').on(table.username)]
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    csrfTokenHash: text('csrf_token_hash').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    absoluteExpiresTimeUtc: integer('absolute_expires_time_utc').notNull(),
    idleExpiresTimeUtc: integer('idle_expires_time_utc').notNull(),
    createTimeUtc: integer('create_time_utc').notNull(),
    updateTimeUtc: integer('update_time_utc').notNull()
  },
  (table) => [
    uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_user_id_index').on(table.userId)
  ]
);

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    eventTimeUtc: integer('event_time_utc').notNull(),
    requestId: text('request_id').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    resourceKind: text('resource_kind').notNull(),
    resourceId: text('resource_id'),
    outcome: text('outcome', { enum: ['success', 'error', 'denied'] }).notNull(),
    reasonCode: text('reason_code').notNull(),
    revisionBefore: integer('revision_before'),
    revisionAfter: integer('revision_after')
  },
  (table) => [
    index('audit_events_request_id_index').on(table.requestId),
    index('audit_events_time_index').on(table.eventTimeUtc),
    index('audit_events_actor_id_index').on(table.actorId)
  ]
);

export const requestEvents = sqliteTable(
  'request_events',
  {
    id: text('id').primaryKey(),
    eventTimeUtc: integer('event_time_utc').notNull(),
    requestId: text('request_id').notNull(),
    environment: text('environment').notNull(),
    runtime: text('runtime', { enum: ['node', 'cloudflare'] }).notNull(),
    route: text('route').notNull(),
    operation: text('operation').notNull(),
    actorId: text('actor_id'),
    outcome: text('outcome', { enum: ['success', 'error', 'denied'] }).notNull(),
    statusCode: integer('status_code').notNull(),
    durationMilliseconds: integer('duration_milliseconds').notNull()
  },
  (table) => [
    index('request_events_request_id_index').on(table.requestId),
    index('request_events_time_index').on(table.eventTimeUtc),
    index('request_events_actor_id_index').on(table.actorId),
    index('request_events_outcome_index').on(table.outcome)
  ]
);

export const productDescriptionTemplates = sqliteTable(
  'product_description_templates',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    category: text('category', {
      enum: ['company', 'logistics', 'packaging', 'service', 'custom']
    }).notNull(),
    language: text('language', { enum: ['zh_CN', 'en_US'] }).notNull(),
    html: text('html').notNull(),
    status: text('status', { enum: ['active', 'archived'] }).notNull(),
    createTimeUtc: integer('create_time_utc').notNull(),
    updateTimeUtc: integer('update_time_utc').notNull(),
    creatorId: text('creator_id').notNull(),
    updaterId: text('updater_id').notNull(),
    revision: integer('revision').notNull().default(1),
    remark: text('remark')
  },
  (table) => [
    index('product_description_templates_language_status_index').on(table.language, table.status),
    index('product_description_templates_category_index').on(table.category)
  ]
);

export const productMutationJobs = sqliteTable(
  'product_mutation_jobs',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id').notNull(),
    productId: text('product_id').notNull(),
    operation: text('operation', { enum: ['updateProduct'] }).notNull(),
    status: text('status', {
      enum: ['submitted', 'auditing', 'verified', 'recovery-required', 'failed']
    }).notNull(),
    categoryId: integer('category_id').notNull(),
    language: text('language', { enum: ['zh_CN', 'en_US'] }).notNull(),
    payloadFingerprint: text('payload_fingerprint').notNull(),
    fieldExpectationsJson: text('field_expectations_json').notNull(),
    traceId: text('trace_id'),
    reasonCode: text('reason_code'),
    message: text('message'),
    submittedTimeUtc: integer('submitted_time_utc').notNull(),
    lastCheckedTimeUtc: integer('last_checked_time_utc'),
    completedTimeUtc: integer('completed_time_utc'),
    createTimeUtc: integer('create_time_utc').notNull(),
    updateTimeUtc: integer('update_time_utc').notNull(),
    creatorId: text('creator_id').notNull(),
    updaterId: text('updater_id').notNull(),
    revision: integer('revision').notNull().default(1),
    remark: text('remark')
  },
  (table) => [
    uniqueIndex('product_mutation_jobs_request_id_unique').on(table.requestId),
    index('product_mutation_jobs_product_time_index').on(table.productId, table.submittedTimeUtc),
    index('product_mutation_jobs_status_time_index').on(table.status, table.updateTimeUtc)
  ]
);

export const schema = {
  schemaMigrations,
  appMetadata,
  users,
  sessions,
  auditEvents,
  requestEvents,
  productDescriptionTemplates,
  productMutationJobs
};
export const CURRENT_SCHEMA_VERSION = 5;
