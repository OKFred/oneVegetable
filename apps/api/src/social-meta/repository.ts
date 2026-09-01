import type {
  MetaAppConfigurationSummary,
  SocialAccountConnection,
  SocialDestination
} from '@one-vegetable/core';
import type { SqlExecutor } from '../db/sql-executor';

const CONFIGURATION_ID = 'primary';
const ALGORITHM = 'AES-256-GCM';
const SCHEMA_VERSION = 1;
const KEY_VERSION = 1;

export interface MetaAppConfigurationRecord {
  id: 'primary';
  appId: string;
  encryptedAppSecret: string;
  initializationVector: string;
  keyVersion: number;
  graphApiVersion: string;
  publicOrigin: string;
  createTimeUtc: number;
  updateTimeUtc: number;
  creatorId: string;
  updaterId: string;
  revision: number;
  remark: string | null;
}

export interface MetaOAuthStateRecord {
  id: string;
  stateHash: string;
  actorId: string;
  callbackUrl: string;
  expiresTimeUtc: number;
  consumedTimeUtc: number | null;
  createTimeUtc: number;
}

export interface MetaOAuthGrantRecord {
  id: string;
  accountExternalId: string;
  accountName: string;
  encryptedUserToken: string;
  initializationVector: string;
  grantedScopes: string[];
  tokenExpiresTimeUtc: number | null;
  status: SocialAccountConnection['status'];
  createTimeUtc: number;
  updateTimeUtc: number;
  creatorId: string;
  updaterId: string;
  revision: number;
  remark: string | null;
}

export interface SocialDestinationRecord extends SocialDestination {
  encryptedAccessToken: string;
  initializationVector: string;
}

export interface MetaSocialRepository {
  findConfiguration(): Promise<MetaAppConfigurationRecord | null>;
  saveConfiguration(input: {
    appId: string;
    encryptedAppSecret: string;
    initializationVector: string;
    graphApiVersion: string;
    publicOrigin: string;
    actorId: string;
    expectedRevision: number | null;
    remark: string | null;
    now: number;
  }): Promise<MetaAppConfigurationRecord>;
  deleteConfiguration(expectedRevision: number): Promise<boolean>;
  countConnections(): Promise<number>;
  createOAuthState(input: MetaOAuthStateRecord): Promise<void>;
  consumeOAuthState(stateHash: string, now: number): Promise<MetaOAuthStateRecord | null>;
  findConnectionByExternalId(accountExternalId: string): Promise<MetaOAuthGrantRecord | null>;
  findConnection(id: string): Promise<MetaOAuthGrantRecord | null>;
  saveConnection(input: {
    id: string;
    accountExternalId: string;
    accountName: string;
    encryptedUserToken: string;
    initializationVector: string;
    grantedScopes: string[];
    tokenExpiresTimeUtc: number | null;
    actorId: string;
    now: number;
  }): Promise<MetaOAuthGrantRecord>;
  listConnections(now: number): Promise<SocialAccountConnection[]>;
  markConnectionReconnectRequired(id: string, now: number): Promise<void>;
  disconnectConnection(id: string, expectedRevision: number, actorId: string, now: number): Promise<boolean>;
  findDestinationByExternalId(
    platform: SocialDestination['platform'],
    externalId: string
  ): Promise<SocialDestinationRecord | null>;
  saveDestination(input: {
    id: string;
    connectionId: string;
    platform: SocialDestination['platform'];
    externalId: string;
    name: string;
    pageExternalId: string;
    pageName: string;
    encryptedAccessToken: string;
    initializationVector: string;
    tasks: string[];
    canPublish: boolean;
    unavailableReasonCode: string | null;
    now: number;
  }): Promise<SocialDestinationRecord>;
  removeConnectionDestinationsExcept(connectionId: string, destinationIds: readonly string[]): Promise<void>;
  listDestinations(): Promise<SocialDestination[]>;
  findDestination(id: string): Promise<SocialDestinationRecord | null>;
}

export class SqlMetaSocialRepository implements MetaSocialRepository {
  constructor(private readonly executor: SqlExecutor) {}

  async findConfiguration(): Promise<MetaAppConfigurationRecord | null> {
    const rows = await this.executor.query('SELECT * FROM meta_app_configurations WHERE id = ? LIMIT 1', [
      CONFIGURATION_ID
    ]);
    return rows[0] ? toConfiguration(rows[0]) : null;
  }

  async saveConfiguration(input: {
    appId: string;
    encryptedAppSecret: string;
    initializationVector: string;
    graphApiVersion: string;
    publicOrigin: string;
    actorId: string;
    expectedRevision: number | null;
    remark: string | null;
    now: number;
  }): Promise<MetaAppConfigurationRecord> {
    const revision = input.expectedRevision === null ? 1 : input.expectedRevision + 1;
    const result = await this.executor.execute(
      `INSERT INTO meta_app_configurations (
        id, app_id, encrypted_app_secret, initialization_vector, algorithm, schema_version,
        key_version, graph_api_version, public_origin, create_time_utc, update_time_utc,
        creator_id, updater_id, revision, remark
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        app_id = excluded.app_id,
        encrypted_app_secret = excluded.encrypted_app_secret,
        initialization_vector = excluded.initialization_vector,
        graph_api_version = excluded.graph_api_version,
        public_origin = excluded.public_origin,
        update_time_utc = excluded.update_time_utc,
        updater_id = excluded.updater_id,
        revision = excluded.revision,
        remark = excluded.remark
      WHERE meta_app_configurations.revision = ?`,
      [
        CONFIGURATION_ID,
        input.appId,
        input.encryptedAppSecret,
        input.initializationVector,
        ALGORITHM,
        SCHEMA_VERSION,
        KEY_VERSION,
        input.graphApiVersion,
        input.publicOrigin,
        input.now,
        input.now,
        input.actorId,
        input.actorId,
        revision,
        input.remark,
        input.expectedRevision
      ]
    );
    if (result.changes !== 1) throw new MetaEntityVersionConflictError();
    const stored = await this.findConfiguration();
    if (!stored) throw new Error('Meta 配置保存后无法读取');
    return stored;
  }

  async deleteConfiguration(expectedRevision: number): Promise<boolean> {
    const result = await this.executor.execute(
      'DELETE FROM meta_app_configurations WHERE id = ? AND revision = ?',
      [CONFIGURATION_ID, expectedRevision]
    );
    return result.changes === 1;
  }

  async countConnections(): Promise<number> {
    const row = (
      await this.executor.query(
        "SELECT COUNT(*) AS count FROM meta_oauth_grants WHERE status != 'disconnected'"
      )
    )[0];
    return optionalNumber(row?.count) ?? 0;
  }

  async createOAuthState(input: MetaOAuthStateRecord): Promise<void> {
    await this.executor.execute(
      `INSERT INTO meta_oauth_states (
        id, state_hash, actor_id, callback_url, expires_time_utc, consumed_time_utc, create_time_utc
      ) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      [input.id, input.stateHash, input.actorId, input.callbackUrl, input.expiresTimeUtc, input.createTimeUtc]
    );
  }

  async consumeOAuthState(stateHash: string, now: number): Promise<MetaOAuthStateRecord | null> {
    const rows = await this.executor.query(
      `SELECT * FROM meta_oauth_states
       WHERE state_hash = ? AND consumed_time_utc IS NULL AND expires_time_utc > ? LIMIT 1`,
      [stateHash, now]
    );
    const row = rows[0];
    if (!row) return null;
    const state = toOAuthState(row);
    const result = await this.executor.execute(
      `UPDATE meta_oauth_states SET consumed_time_utc = ?
       WHERE id = ? AND consumed_time_utc IS NULL AND expires_time_utc > ?`,
      [now, state.id, now]
    );
    return result.changes === 1 ? { ...state, consumedTimeUtc: now } : null;
  }

  async findConnectionByExternalId(accountExternalId: string): Promise<MetaOAuthGrantRecord | null> {
    const rows = await this.executor.query(
      'SELECT * FROM meta_oauth_grants WHERE account_external_id = ? LIMIT 1',
      [accountExternalId]
    );
    return rows[0] ? toOAuthGrant(rows[0]) : null;
  }

  async findConnection(id: string): Promise<MetaOAuthGrantRecord | null> {
    const rows = await this.executor.query('SELECT * FROM meta_oauth_grants WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? toOAuthGrant(rows[0]) : null;
  }

  async saveConnection(input: {
    id: string;
    accountExternalId: string;
    accountName: string;
    encryptedUserToken: string;
    initializationVector: string;
    grantedScopes: string[];
    tokenExpiresTimeUtc: number | null;
    actorId: string;
    now: number;
  }): Promise<MetaOAuthGrantRecord> {
    await this.executor.execute(
      `INSERT INTO meta_oauth_grants (
        id, account_external_id, account_name, encrypted_user_token, initialization_vector,
        granted_scopes_json, token_expires_time_utc, status, create_time_utc, update_time_utc,
        creator_id, updater_id, revision, remark
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'connected', ?, ?, ?, ?, 1, NULL)
      ON CONFLICT(account_external_id) DO UPDATE SET
        account_name = excluded.account_name,
        encrypted_user_token = excluded.encrypted_user_token,
        initialization_vector = excluded.initialization_vector,
        granted_scopes_json = excluded.granted_scopes_json,
        token_expires_time_utc = excluded.token_expires_time_utc,
        status = 'connected',
        update_time_utc = excluded.update_time_utc,
        updater_id = excluded.updater_id,
        revision = meta_oauth_grants.revision + 1`,
      [
        input.id,
        input.accountExternalId,
        input.accountName,
        input.encryptedUserToken,
        input.initializationVector,
        JSON.stringify(input.grantedScopes),
        input.tokenExpiresTimeUtc,
        input.now,
        input.now,
        input.actorId,
        input.actorId
      ]
    );
    const stored = await this.findConnectionByExternalId(input.accountExternalId);
    if (!stored) throw new Error('Meta 连接保存后无法读取');
    return stored;
  }

  async listConnections(now: number): Promise<SocialAccountConnection[]> {
    const rows = await this.executor.query(
      `SELECT g.*,
        (SELECT COUNT(*) FROM social_destinations d WHERE d.connection_id = g.id) AS destination_count
       FROM meta_oauth_grants g
       WHERE g.status != 'disconnected'
       ORDER BY g.update_time_utc DESC`
    );
    return rows.map((row) => {
      const grant = toOAuthGrant(row);
      return {
        id: grant.id,
        accountExternalId: grant.accountExternalId,
        accountName: grant.accountName,
        status:
          grant.tokenExpiresTimeUtc !== null && grant.tokenExpiresTimeUtc <= now
            ? 'reconnect-required'
            : grant.status,
        grantedScopes: grant.grantedScopes,
        tokenExpiresTimeUtc: grant.tokenExpiresTimeUtc,
        destinationCount: optionalNumber(row.destination_count) ?? 0,
        createTimeUtc: grant.createTimeUtc,
        updateTimeUtc: grant.updateTimeUtc,
        creatorId: grant.creatorId,
        updaterId: grant.updaterId,
        revision: grant.revision,
        remark: grant.remark
      };
    });
  }

  async markConnectionReconnectRequired(id: string, now: number): Promise<void> {
    await this.executor.execute(
      `UPDATE meta_oauth_grants
       SET status = 'reconnect-required', update_time_utc = ?, revision = revision + 1
       WHERE id = ? AND status = 'connected'`,
      [now, id]
    );
  }

  async disconnectConnection(
    id: string,
    expectedRevision: number,
    actorId: string,
    now: number
  ): Promise<boolean> {
    const result = await this.executor.execute(
      `UPDATE meta_oauth_grants SET
        status = 'disconnected', encrypted_user_token = '', initialization_vector = '',
        update_time_utc = ?, updater_id = ?, revision = revision + 1
       WHERE id = ? AND revision = ? AND status != 'disconnected'`,
      [now, actorId, id, expectedRevision]
    );
    if (result.changes !== 1) return false;
    await this.executor.execute('DELETE FROM social_destinations WHERE connection_id = ?', [id]);
    return true;
  }

  async findDestinationByExternalId(
    platform: SocialDestination['platform'],
    externalId: string
  ): Promise<SocialDestinationRecord | null> {
    const rows = await this.executor.query(
      'SELECT * FROM social_destinations WHERE platform = ? AND external_id = ? LIMIT 1',
      [platform, externalId]
    );
    return rows[0] ? toDestinationRecord(rows[0]) : null;
  }

  async saveDestination(input: {
    id: string;
    connectionId: string;
    platform: SocialDestination['platform'];
    externalId: string;
    name: string;
    pageExternalId: string;
    pageName: string;
    encryptedAccessToken: string;
    initializationVector: string;
    tasks: string[];
    canPublish: boolean;
    unavailableReasonCode: string | null;
    now: number;
  }): Promise<SocialDestinationRecord> {
    await this.executor.execute(
      `INSERT INTO social_destinations (
        id, connection_id, platform, external_id, name, page_external_id, page_name,
        encrypted_access_token, initialization_vector, tasks_json, can_publish,
        unavailable_reason_code, create_time_utc, update_time_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, external_id) DO UPDATE SET
        connection_id = excluded.connection_id,
        name = excluded.name,
        page_external_id = excluded.page_external_id,
        page_name = excluded.page_name,
        encrypted_access_token = excluded.encrypted_access_token,
        initialization_vector = excluded.initialization_vector,
        tasks_json = excluded.tasks_json,
        can_publish = excluded.can_publish,
        unavailable_reason_code = excluded.unavailable_reason_code,
        update_time_utc = excluded.update_time_utc`,
      [
        input.id,
        input.connectionId,
        input.platform,
        input.externalId,
        input.name,
        input.pageExternalId,
        input.pageName,
        input.encryptedAccessToken,
        input.initializationVector,
        JSON.stringify(input.tasks),
        input.canPublish ? 1 : 0,
        input.unavailableReasonCode,
        input.now,
        input.now
      ]
    );
    const stored = await this.findDestinationByExternalId(input.platform, input.externalId);
    if (!stored) throw new Error('Meta 发布目标保存后无法读取');
    return stored;
  }

  async removeConnectionDestinationsExcept(
    connectionId: string,
    destinationIds: readonly string[]
  ): Promise<void> {
    if (destinationIds.length === 0) {
      await this.executor.execute('DELETE FROM social_destinations WHERE connection_id = ?', [connectionId]);
      return;
    }
    const placeholders = destinationIds.map(() => '?').join(', ');
    await this.executor.execute(
      `DELETE FROM social_destinations WHERE connection_id = ? AND id NOT IN (${placeholders})`,
      [connectionId, ...destinationIds]
    );
  }

  async listDestinations(): Promise<SocialDestination[]> {
    const rows = await this.executor.query(
      `SELECT d.* FROM social_destinations d
       JOIN meta_oauth_grants g ON g.id = d.connection_id
       WHERE g.status = 'connected'
       ORDER BY d.platform, d.name`
    );
    return rows.map((row) => publicDestination(toDestinationRecord(row)));
  }

  async findDestination(id: string): Promise<SocialDestinationRecord | null> {
    const rows = await this.executor.query('SELECT * FROM social_destinations WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? toDestinationRecord(rows[0]) : null;
  }
}

export class MetaEntityVersionConflictError extends Error {
  constructor() {
    super('Meta 实体已被其他请求更新');
    this.name = 'MetaEntityVersionConflictError';
  }
}

export function summarizeMetaConfiguration(
  record: MetaAppConfigurationRecord | null,
  callbackUrl: string | null
): MetaAppConfigurationSummary {
  return {
    configured: record !== null,
    appIdSuffix: record ? record.appId.slice(-4) : null,
    graphApiVersion: record?.graphApiVersion ?? 'v26.0',
    publicOrigin: record?.publicOrigin ?? null,
    callbackUrl,
    revision: record?.revision ?? null,
    updateTimeUtc: record?.updateTimeUtc ?? null,
    updaterId: record?.updaterId ?? null,
    remark: record?.remark ?? null
  };
}

function toConfiguration(row: Record<string, unknown>): MetaAppConfigurationRecord {
  return {
    id: 'primary',
    appId: requiredString(row, 'app_id'),
    encryptedAppSecret: requiredString(row, 'encrypted_app_secret'),
    initializationVector: requiredString(row, 'initialization_vector'),
    keyVersion: requiredNumber(row, 'key_version'),
    graphApiVersion: requiredString(row, 'graph_api_version'),
    publicOrigin: requiredString(row, 'public_origin'),
    createTimeUtc: requiredNumber(row, 'create_time_utc'),
    updateTimeUtc: requiredNumber(row, 'update_time_utc'),
    creatorId: requiredString(row, 'creator_id'),
    updaterId: requiredString(row, 'updater_id'),
    revision: requiredNumber(row, 'revision'),
    remark: nullableString(row, 'remark')
  };
}

function toOAuthState(row: Record<string, unknown>): MetaOAuthStateRecord {
  return {
    id: requiredString(row, 'id'),
    stateHash: requiredString(row, 'state_hash'),
    actorId: requiredString(row, 'actor_id'),
    callbackUrl: requiredString(row, 'callback_url'),
    expiresTimeUtc: requiredNumber(row, 'expires_time_utc'),
    consumedTimeUtc: nullableNumber(row, 'consumed_time_utc'),
    createTimeUtc: requiredNumber(row, 'create_time_utc')
  };
}

function toOAuthGrant(row: Record<string, unknown>): MetaOAuthGrantRecord {
  return {
    id: requiredString(row, 'id'),
    accountExternalId: requiredString(row, 'account_external_id'),
    accountName: requiredString(row, 'account_name'),
    encryptedUserToken: requiredString(row, 'encrypted_user_token'),
    initializationVector: requiredString(row, 'initialization_vector'),
    grantedScopes: parseStringArray(requiredString(row, 'granted_scopes_json')),
    tokenExpiresTimeUtc: nullableNumber(row, 'token_expires_time_utc'),
    status: requiredEnum(row, 'status', ['connected', 'reconnect-required', 'disconnected']),
    createTimeUtc: requiredNumber(row, 'create_time_utc'),
    updateTimeUtc: requiredNumber(row, 'update_time_utc'),
    creatorId: requiredString(row, 'creator_id'),
    updaterId: requiredString(row, 'updater_id'),
    revision: requiredNumber(row, 'revision'),
    remark: nullableString(row, 'remark')
  };
}

function toDestinationRecord(row: Record<string, unknown>): SocialDestinationRecord {
  return {
    id: requiredString(row, 'id'),
    connectionId: requiredString(row, 'connection_id'),
    platform: requiredEnum(row, 'platform', ['facebook', 'instagram']),
    externalId: requiredString(row, 'external_id'),
    name: requiredString(row, 'name'),
    pageExternalId: requiredString(row, 'page_external_id'),
    pageName: requiredString(row, 'page_name'),
    encryptedAccessToken: requiredString(row, 'encrypted_access_token'),
    initializationVector: requiredString(row, 'initialization_vector'),
    tasks: parseStringArray(requiredString(row, 'tasks_json')),
    canPublish: requiredBoolean(row, 'can_publish'),
    unavailableReasonCode: nullableString(row, 'unavailable_reason_code'),
    createTimeUtc: requiredNumber(row, 'create_time_utc'),
    updateTimeUtc: requiredNumber(row, 'update_time_utc')
  };
}

function publicDestination(record: SocialDestinationRecord): SocialDestination {
  const {
    encryptedAccessToken: _encryptedAccessToken,
    initializationVector: _initializationVector,
    ...result
  } = record;
  return result;
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error('Meta JSON 数组字段无效');
  }
  return parsed;
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`数据库字段 ${key} 无效`);
  return value;
}

function nullableString(row: Record<string, unknown>, key: string): string | null {
  return row[key] === null ? null : requiredString(row, key);
}

function requiredNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`数据库字段 ${key} 无效`);
  }
  return value;
}

function optionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  return null;
}

function nullableNumber(row: Record<string, unknown>, key: string): number | null {
  return row[key] === null ? null : requiredNumber(row, key);
}

function requiredBoolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw new Error(`数据库字段 ${key} 无效`);
}

function requiredEnum<const T extends string>(
  row: Record<string, unknown>,
  key: string,
  values: readonly T[]
): T {
  const value = requiredString(row, key);
  if (!values.some((candidate) => candidate === value)) throw new Error(`数据库字段 ${key} 无效`);
  return value as T;
}
