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
    passwordLoginEnabled: integer('password_login_enabled', { mode: 'boolean' }).notNull().default(true),
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
    operation: text('operation', { enum: ['updateProduct', 'updateProductDisplay'] }).notNull(),
    status: text('status', {
      enum: [
        'submitted',
        'auditing',
        'verifying',
        'verified',
        'recovery-required',
        'recovering',
        'recovered',
        'failed'
      ]
    }).notNull(),
    categoryId: integer('category_id'),
    language: text('language', { enum: ['zh_CN', 'en_US'] }),
    payloadFingerprint: text('payload_fingerprint').notNull(),
    fieldExpectationsJson: text('field_expectations_json').notNull(),
    encryptedProductId: text('encrypted_product_id'),
    targetDisplay: text('target_display', { enum: ['online', 'offline'] }),
    originalDisplay: text('original_display', { enum: ['online', 'offline'] }),
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
    uniqueIndex('product_mutation_jobs_request_target_unique').on(
      table.requestId,
      table.productId,
      table.operation
    ),
    index('product_mutation_jobs_product_time_index').on(table.productId, table.submittedTimeUtc),
    index('product_mutation_jobs_status_time_index').on(table.status, table.updateTimeUtc)
  ]
);

export const alibabaGatewayCredentials = sqliteTable('alibaba_gateway_credentials', {
  id: text('id').primaryKey(),
  encryptedBundle: text('encrypted_bundle').notNull(),
  initializationVector: text('initialization_vector').notNull(),
  algorithm: text('algorithm').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  keyVersion: integer('key_version').notNull(),
  accessTokenExpiresTimeUtc: integer('access_token_expires_time_utc'),
  refreshTokenExpiresTimeUtc: integer('refresh_token_expires_time_utc'),
  refreshLeaseId: text('refresh_lease_id'),
  refreshLeaseUntilUtc: integer('refresh_lease_until_utc'),
  lastRefreshTimeUtc: integer('last_refresh_time_utc'),
  lastRefreshErrorCode: text('last_refresh_error_code'),
  createTimeUtc: integer('create_time_utc').notNull(),
  updateTimeUtc: integer('update_time_utc').notNull(),
  creatorId: text('creator_id').notNull(),
  updaterId: text('updater_id').notNull(),
  revision: integer('revision').notNull().default(1),
  remark: text('remark')
});

export const alibabaCredentialAcquisitionJobs = sqliteTable(
  'alibaba_credential_acquisition_jobs',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    browserSessionId: text('browser_session_id'),
    status: text('status', {
      enum: [
        'running',
        'selection-required',
        'callback-confirmation-required',
        'extension-required',
        'completed',
        'failed'
      ]
    }).notNull(),
    stateJson: text('state_json').notNull(),
    selectedApplicationId: text('selected_application_id'),
    requestedCallbackUrl: text('requested_callback_url'),
    activeSlot: integer('active_slot'),
    expiresTimeUtc: integer('expires_time_utc').notNull(),
    createTimeUtc: integer('create_time_utc').notNull(),
    updateTimeUtc: integer('update_time_utc').notNull()
  },
  (table) => [
    uniqueIndex('alibaba_credential_acquisition_jobs_active_unique').on(table.activeSlot),
    index('alibaba_credential_acquisition_jobs_actor_time_index').on(table.actorId, table.createTimeUtc),
    index('alibaba_credential_acquisition_jobs_expiry_index').on(table.activeSlot, table.expiresTimeUtc)
  ]
);

export const metaAppConfigurations = sqliteTable('meta_app_configurations', {
  id: text('id').primaryKey(),
  appId: text('app_id').notNull(),
  encryptedAppSecret: text('encrypted_app_secret').notNull(),
  initializationVector: text('initialization_vector').notNull(),
  algorithm: text('algorithm').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  keyVersion: integer('key_version').notNull(),
  graphApiVersion: text('graph_api_version').notNull(),
  publicOrigin: text('public_origin').notNull(),
  createTimeUtc: integer('create_time_utc').notNull(),
  updateTimeUtc: integer('update_time_utc').notNull(),
  creatorId: text('creator_id').notNull(),
  updaterId: text('updater_id').notNull(),
  revision: integer('revision').notNull().default(1),
  remark: text('remark')
});

export const metaOauthGrants = sqliteTable(
  'meta_oauth_grants',
  {
    id: text('id').primaryKey(),
    accountExternalId: text('account_external_id').notNull(),
    accountName: text('account_name').notNull(),
    encryptedUserToken: text('encrypted_user_token').notNull(),
    initializationVector: text('initialization_vector').notNull(),
    grantedScopesJson: text('granted_scopes_json').notNull(),
    tokenExpiresTimeUtc: integer('token_expires_time_utc'),
    status: text('status', {
      enum: ['connected', 'reconnect-required', 'disconnected']
    }).notNull(),
    createTimeUtc: integer('create_time_utc').notNull(),
    updateTimeUtc: integer('update_time_utc').notNull(),
    creatorId: text('creator_id').notNull(),
    updaterId: text('updater_id').notNull(),
    revision: integer('revision').notNull().default(1),
    remark: text('remark')
  },
  (table) => [
    uniqueIndex('meta_oauth_grants_account_unique').on(table.accountExternalId),
    index('meta_oauth_grants_status_index').on(table.status, table.updateTimeUtc)
  ]
);

export const socialDestinations = sqliteTable(
  'social_destinations',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => metaOauthGrants.id, { onDelete: 'cascade' }),
    platform: text('platform', { enum: ['facebook', 'instagram'] }).notNull(),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    pageExternalId: text('page_external_id').notNull(),
    pageName: text('page_name').notNull(),
    encryptedAccessToken: text('encrypted_access_token').notNull(),
    initializationVector: text('initialization_vector').notNull(),
    tasksJson: text('tasks_json').notNull(),
    canPublish: integer('can_publish', { mode: 'boolean' }).notNull(),
    unavailableReasonCode: text('unavailable_reason_code'),
    createTimeUtc: integer('create_time_utc').notNull(),
    updateTimeUtc: integer('update_time_utc').notNull()
  },
  (table) => [
    uniqueIndex('social_destinations_platform_external_unique').on(table.platform, table.externalId),
    index('social_destinations_connection_index').on(table.connectionId, table.platform)
  ]
);

export const metaOauthStates = sqliteTable(
  'meta_oauth_states',
  {
    id: text('id').primaryKey(),
    stateHash: text('state_hash').notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    callbackUrl: text('callback_url').notNull(),
    expiresTimeUtc: integer('expires_time_utc').notNull(),
    consumedTimeUtc: integer('consumed_time_utc'),
    createTimeUtc: integer('create_time_utc').notNull()
  },
  (table) => [
    uniqueIndex('meta_oauth_states_hash_unique').on(table.stateHash),
    index('meta_oauth_states_expiry_index').on(table.expiresTimeUtc, table.consumedTimeUtc)
  ]
);

export const socialMediaAssets = sqliteTable(
  'social_media_assets',
  {
    id: text('id').primaryKey(),
    opaqueTokenHash: text('opaque_token_hash').notNull(),
    storageKey: text('storage_key').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    byteLength: integer('byte_length').notNull(),
    contentSha256: text('content_sha256').notNull(),
    width: integer('width'),
    height: integer('height'),
    expiresTimeUtc: integer('expires_time_utc').notNull(),
    createTimeUtc: integer('create_time_utc').notNull()
  },
  (table) => [
    uniqueIndex('social_media_assets_token_hash_unique').on(table.opaqueTokenHash),
    uniqueIndex('social_media_assets_storage_key_unique').on(table.storageKey),
    index('social_media_assets_expiry_index').on(table.expiresTimeUtc)
  ]
);

export const socialPublishJobs = sqliteTable(
  'social_publish_jobs',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    destinationId: text('destination_id')
      .notNull()
      .references(() => socialDestinations.id),
    platform: text('platform', { enum: ['facebook', 'instagram'] }).notNull(),
    status: text('status', {
      enum: ['prepared', 'processing', 'published', 'failed', 'unknown', 'cancelled', 'expired']
    }).notNull(),
    encryptedCaption: text('encrypted_caption').notNull(),
    captionInitializationVector: text('caption_initialization_vector').notNull(),
    captionLength: integer('caption_length').notNull(),
    assetId: text('asset_id')
      .notNull()
      .references(() => socialMediaAssets.id),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    byteLength: integer('byte_length').notNull(),
    contentSha256: text('content_sha256').notNull(),
    platformContainerId: text('platform_container_id'),
    platformPostId: text('platform_post_id'),
    platformRequestId: text('platform_request_id'),
    platformTraceId: text('platform_trace_id'),
    publishAttemptedTimeUtc: integer('publish_attempted_time_utc'),
    finalPublishAttemptedTimeUtc: integer('final_publish_attempted_time_utc'),
    nextAdvanceTimeUtc: integer('next_advance_time_utc'),
    reasonCode: text('reason_code'),
    message: text('message'),
    expiresTimeUtc: integer('expires_time_utc').notNull(),
    createTimeUtc: integer('create_time_utc').notNull(),
    updateTimeUtc: integer('update_time_utc').notNull(),
    creatorId: text('creator_id').notNull(),
    updaterId: text('updater_id').notNull(),
    revision: integer('revision').notNull().default(1),
    remark: text('remark')
  },
  (table) => [
    uniqueIndex('social_publish_jobs_idempotency_unique').on(table.idempotencyKey),
    index('social_publish_jobs_status_time_index').on(table.status, table.updateTimeUtc),
    index('social_publish_jobs_actor_time_index').on(table.creatorId, table.createTimeUtc),
    index('social_publish_jobs_destination_time_index').on(table.destinationId, table.createTimeUtc)
  ]
);

export const extensionSocialPairings = sqliteTable(
  'extension_social_pairings',
  {
    id: text('id').primaryKey(),
    pairingCodeHash: text('pairing_code_hash').notNull(),
    extensionId: text('extension_id').notNull(),
    deviceName: text('device_name').notNull(),
    status: text('status', { enum: ['pending', 'approved', 'consumed', 'cancelled', 'expired'] }).notNull(),
    approvedBy: text('approved_by').references(() => users.id),
    deviceId: text('device_id'),
    expiresTimeUtc: integer('expires_time_utc').notNull(),
    createTimeUtc: integer('create_time_utc').notNull(),
    updateTimeUtc: integer('update_time_utc').notNull()
  },
  (table) => [
    uniqueIndex('extension_social_pairings_code_hash_unique').on(table.pairingCodeHash),
    index('extension_social_pairings_expiry_index').on(table.status, table.expiresTimeUtc)
  ]
);

export const extensionSocialDevices = sqliteTable(
  'extension_social_devices',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    extensionId: text('extension_id').notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: ['active', 'revoked', 'expired'] }).notNull(),
    expiresTimeUtc: integer('expires_time_utc').notNull(),
    lastUsedTimeUtc: integer('last_used_time_utc'),
    createTimeUtc: integer('create_time_utc').notNull(),
    updateTimeUtc: integer('update_time_utc').notNull(),
    creatorId: text('creator_id').notNull(),
    updaterId: text('updater_id').notNull(),
    revision: integer('revision').notNull().default(1),
    remark: text('remark')
  },
  (table) => [
    uniqueIndex('extension_social_devices_token_hash_unique').on(table.tokenHash),
    index('extension_social_devices_status_expiry_index').on(table.status, table.expiresTimeUtc),
    index('extension_social_devices_extension_index').on(table.extensionId, table.status)
  ]
);

export const webauthnCredentials = sqliteTable(
  'webauthn_credentials',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    publicKeyBase64Url: text('public_key_base64url').notNull(),
    counter: integer('counter').notNull().default(0),
    transportsJson: text('transports_json').notNull().default('[]'),
    deviceType: text('device_type', { enum: ['singleDevice', 'multiDevice'] }).notNull(),
    backedUp: integer('backed_up', { mode: 'boolean' }).notNull().default(false),
    rpId: text('rp_id').notNull(),
    name: text('name').notNull(),
    createTimeUtc: integer('create_time_utc').notNull(),
    updateTimeUtc: integer('update_time_utc').notNull(),
    creatorId: text('creator_id').notNull(),
    updaterId: text('updater_id').notNull(),
    revision: integer('revision').notNull().default(1),
    remark: text('remark')
  },
  (table) => [index('idx_webauthn_credentials_user_id').on(table.userId, table.createTimeUtc)]
);

export const webauthnChallenges = sqliteTable(
  'webauthn_challenges',
  {
    id: text('id').primaryKey(),
    challenge: text('challenge').notNull().unique(),
    kind: text('kind', {
      enum: ['bootstrap', 'login', 'register', 'recovery', 'enrollment']
    }).notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    username: text('username'),
    rpId: text('rp_id').notNull(),
    origin: text('origin').notNull(),
    contextJson: text('context_json').notNull().default('{}'),
    expiresTimeUtc: integer('expires_time_utc').notNull(),
    consumedTimeUtc: integer('consumed_time_utc'),
    createTimeUtc: integer('create_time_utc').notNull()
  },
  (table) => [index('idx_webauthn_challenges_expiry').on(table.expiresTimeUtc, table.consumedTimeUtc)]
);

export const authRecoveryCodes = sqliteTable(
  'auth_recovery_codes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull().unique(),
    consumedTimeUtc: integer('consumed_time_utc'),
    createTimeUtc: integer('create_time_utc').notNull()
  },
  (table) => [index('idx_auth_recovery_codes_user_id').on(table.userId, table.consumedTimeUtc)]
);

export const userEnrollmentTokens = sqliteTable(
  'user_enrollment_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresTimeUtc: integer('expires_time_utc').notNull(),
    consumedTimeUtc: integer('consumed_time_utc'),
    creatorId: text('creator_id').notNull(),
    createTimeUtc: integer('create_time_utc').notNull()
  },
  (table) => [index('idx_user_enrollment_tokens_expiry').on(table.expiresTimeUtc, table.consumedTimeUtc)]
);

export const schema = {
  schemaMigrations,
  appMetadata,
  users,
  sessions,
  auditEvents,
  requestEvents,
  productDescriptionTemplates,
  productMutationJobs,
  alibabaGatewayCredentials,
  alibabaCredentialAcquisitionJobs,
  metaAppConfigurations,
  metaOauthGrants,
  socialDestinations,
  metaOauthStates,
  socialMediaAssets,
  socialPublishJobs,
  extensionSocialPairings,
  extensionSocialDevices,
  webauthnCredentials,
  webauthnChallenges,
  authRecoveryCodes,
  userEnrollmentTokens
};
export const CURRENT_SCHEMA_VERSION = 10;
