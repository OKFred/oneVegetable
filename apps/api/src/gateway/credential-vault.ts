import {
  ALIBABA_GATEWAY,
  credentialExpiryFromSeconds,
  NetworkManager,
  normalizeRemark,
  parseAlibabaOpenApiCredentialBundle,
  parseAlibabaTokenResponse
} from '@one-vegetable/core';

import { EntityVersionConflictError } from '../db/repository';
import { GatewayConfigurationError, readEndpoint, readSignMethod } from './credentials';

import type {
  AlibabaOpenApiCredentialBundle,
  GatewayCredentials,
  NetworkTransport,
  SignMethod,
  UnixEpochMilliseconds
} from '@one-vegetable/core';
import type { SqlExecutor } from '../db/sql-executor';
import type { AlibabaCredentialStatus } from './credentials';

const CREDENTIAL_ID = 'primary';
const ALGORITHM = 'AES-256-GCM';
const SCHEMA_VERSION = 1;
const KEY_VERSION = 1;
const REFRESH_WINDOW_MS = 5 * 60_000;
const REFRESH_LEASE_MS = 60_000;
const TOKEN_ENDPOINT = 'https://oauth.alibaba.com/token';

export interface GatewayCredentialRecord {
  id: 'primary';
  encryptedBundle: string;
  initializationVector: string;
  algorithm: 'AES-256-GCM';
  schemaVersion: 1;
  keyVersion: number;
  accessTokenExpiresTimeUtc: UnixEpochMilliseconds | null;
  refreshTokenExpiresTimeUtc: UnixEpochMilliseconds | null;
  refreshLeaseId: string | null;
  refreshLeaseUntilUtc: UnixEpochMilliseconds | null;
  lastRefreshTimeUtc: UnixEpochMilliseconds | null;
  lastRefreshErrorCode: string | null;
  createTimeUtc: UnixEpochMilliseconds;
  updateTimeUtc: UnixEpochMilliseconds;
  creatorId: string;
  updaterId: string;
  revision: number;
  remark: string | null;
}

export interface GatewayCredentialSummary {
  configured: boolean;
  revision: number | null;
  accessTokenExpiresTimeUtc: UnixEpochMilliseconds | null;
  refreshTokenExpiresTimeUtc: UnixEpochMilliseconds | null;
  lastRefreshTimeUtc: UnixEpochMilliseconds | null;
  lastRefreshErrorCode: string | null;
  updateTimeUtc: UnixEpochMilliseconds | null;
  updaterId: string | null;
  remark: string | null;
}

export interface GatewayCredentialRepository {
  find(): Promise<GatewayCredentialRecord | null>;
  save(input: {
    encryptedBundle: string;
    initializationVector: string;
    accessTokenExpiresTimeUtc: number | null;
    refreshTokenExpiresTimeUtc: number | null;
    actorId: string;
    expectedRevision: number | null;
    remark: string | null;
    now: number;
  }): Promise<GatewayCredentialRecord>;
  delete(expectedRevision: number): Promise<boolean>;
  acquireRefreshLease(leaseId: string, now: number): Promise<boolean>;
  completeRefresh(input: {
    leaseId: string;
    expectedRevision: number;
    encryptedBundle: string;
    initializationVector: string;
    accessTokenExpiresTimeUtc: number | null;
    refreshTokenExpiresTimeUtc: number | null;
    now: number;
  }): Promise<GatewayCredentialRecord>;
  failRefresh(leaseId: string, errorCode: string, now: number): Promise<void>;
}

export class SqlGatewayCredentialRepository implements GatewayCredentialRepository {
  constructor(private readonly executor: SqlExecutor) {}

  async find(): Promise<GatewayCredentialRecord | null> {
    const rows = await this.executor.query('SELECT * FROM alibaba_gateway_credentials WHERE id = ? LIMIT 1', [
      CREDENTIAL_ID
    ]);
    return rows[0] ? toCredentialRecord(rows[0]) : null;
  }

  async save(input: {
    encryptedBundle: string;
    initializationVector: string;
    accessTokenExpiresTimeUtc: number | null;
    refreshTokenExpiresTimeUtc: number | null;
    actorId: string;
    expectedRevision: number | null;
    remark: string | null;
    now: number;
  }): Promise<GatewayCredentialRecord> {
    const revision = input.expectedRevision === null ? 1 : input.expectedRevision + 1;
    const result = await this.executor.execute(
      `INSERT INTO alibaba_gateway_credentials (
        id, encrypted_bundle, initialization_vector, algorithm, schema_version, key_version,
        access_token_expires_time_utc, refresh_token_expires_time_utc,
        refresh_lease_id, refresh_lease_until_utc, last_refresh_time_utc, last_refresh_error_code,
        create_time_utc, update_time_utc, creator_id, updater_id, revision, remark
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        encrypted_bundle = excluded.encrypted_bundle,
        initialization_vector = excluded.initialization_vector,
        algorithm = excluded.algorithm,
        schema_version = excluded.schema_version,
        key_version = excluded.key_version,
        access_token_expires_time_utc = excluded.access_token_expires_time_utc,
        refresh_token_expires_time_utc = excluded.refresh_token_expires_time_utc,
        refresh_lease_id = NULL,
        refresh_lease_until_utc = NULL,
        last_refresh_error_code = NULL,
        update_time_utc = excluded.update_time_utc,
        updater_id = excluded.updater_id,
        revision = excluded.revision,
        remark = excluded.remark
      WHERE alibaba_gateway_credentials.revision = ?`,
      [
        CREDENTIAL_ID,
        input.encryptedBundle,
        input.initializationVector,
        ALGORITHM,
        SCHEMA_VERSION,
        KEY_VERSION,
        input.accessTokenExpiresTimeUtc,
        input.refreshTokenExpiresTimeUtc,
        input.now,
        input.now,
        input.actorId,
        input.actorId,
        revision,
        input.remark,
        input.expectedRevision
      ]
    );
    if (result.changes !== 1) throw new EntityVersionConflictError();
    const stored = await this.find();
    if (!stored) throw new Error('Alibaba 凭据保存后无法读取');
    return stored;
  }

  async delete(expectedRevision: number): Promise<boolean> {
    const result = await this.executor.execute(
      'DELETE FROM alibaba_gateway_credentials WHERE id = ? AND revision = ?',
      [CREDENTIAL_ID, expectedRevision]
    );
    return result.changes === 1;
  }

  async acquireRefreshLease(leaseId: string, now: number): Promise<boolean> {
    const result = await this.executor.execute(
      `UPDATE alibaba_gateway_credentials
       SET refresh_lease_id = ?, refresh_lease_until_utc = ?
       WHERE id = ? AND (refresh_lease_until_utc IS NULL OR refresh_lease_until_utc < ?)`,
      [leaseId, now + REFRESH_LEASE_MS, CREDENTIAL_ID, now]
    );
    return result.changes === 1;
  }

  async completeRefresh(input: {
    leaseId: string;
    expectedRevision: number;
    encryptedBundle: string;
    initializationVector: string;
    accessTokenExpiresTimeUtc: number | null;
    refreshTokenExpiresTimeUtc: number | null;
    now: number;
  }): Promise<GatewayCredentialRecord> {
    const result = await this.executor.execute(
      `UPDATE alibaba_gateway_credentials SET
        encrypted_bundle = ?, initialization_vector = ?,
        access_token_expires_time_utc = ?, refresh_token_expires_time_utc = ?,
        refresh_lease_id = NULL, refresh_lease_until_utc = NULL,
        last_refresh_time_utc = ?, last_refresh_error_code = NULL,
        update_time_utc = ?, updater_id = 'system:maintenance', revision = revision + 1
       WHERE id = ? AND revision = ? AND refresh_lease_id = ?`,
      [
        input.encryptedBundle,
        input.initializationVector,
        input.accessTokenExpiresTimeUtc,
        input.refreshTokenExpiresTimeUtc,
        input.now,
        input.now,
        CREDENTIAL_ID,
        input.expectedRevision,
        input.leaseId
      ]
    );
    if (result.changes !== 1) throw new EntityVersionConflictError();
    const stored = await this.find();
    if (!stored) throw new Error('Alibaba 凭据刷新后无法读取');
    return stored;
  }

  async failRefresh(leaseId: string, errorCode: string, now: number): Promise<void> {
    await this.executor.execute(
      `UPDATE alibaba_gateway_credentials SET
        refresh_lease_id = NULL, refresh_lease_until_utc = NULL,
        last_refresh_error_code = ?, update_time_utc = ?
       WHERE id = ? AND refresh_lease_id = ?`,
      [errorCode.slice(0, 128), now, CREDENTIAL_ID, leaseId]
    );
  }
}

export class GatewayCredentialCipher {
  readonly #key: CryptoKey;

  private constructor(key: CryptoKey) {
    this.#key = key;
  }

  static async create(encodedKey: string | undefined): Promise<GatewayCredentialCipher> {
    const bytes = decodeBase64Url(encodedKey?.trim() ?? '');
    if (bytes.byteLength !== 32) {
      throw new GatewayConfigurationError(
        'ALIBABA_CREDENTIAL_ENCRYPTION_KEY_INVALID',
        '凭据加密密钥必须是 32 字节 Base64URL'
      );
    }
    return new GatewayCredentialCipher(
      await crypto.subtle.importKey('raw', toArrayBuffer(bytes), { name: 'AES-GCM' }, false, [
        'encrypt',
        'decrypt'
      ])
    );
  }

  async encrypt(bundle: AlibabaOpenApiCredentialBundle): Promise<{
    encryptedBundle: string;
    initializationVector: string;
  }> {
    const initializationVector = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(bundle));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(initializationVector),
        additionalData: toArrayBuffer(additionalData())
      },
      this.#key,
      plaintext
    );
    return {
      encryptedBundle: encodeBase64Url(new Uint8Array(ciphertext)),
      initializationVector: encodeBase64Url(initializationVector)
    };
  }

  async decrypt(record: GatewayCredentialRecord): Promise<AlibabaOpenApiCredentialBundle> {
    try {
      const plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: toArrayBuffer(decodeBase64Url(record.initializationVector)),
          additionalData: toArrayBuffer(additionalData(record.keyVersion))
        },
        this.#key,
        toArrayBuffer(decodeBase64Url(record.encryptedBundle))
      );
      return parseAlibabaOpenApiCredentialBundle(JSON.parse(new TextDecoder().decode(plaintext)) as unknown);
    } catch {
      throw new GatewayConfigurationError(
        'ALIBABA_CREDENTIAL_VAULT_UNREADABLE',
        'Alibaba 凭据保险库无法解密，请检查加密密钥或重新导入'
      );
    }
  }
}

export class GatewayCredentialService {
  constructor(
    private readonly repository: GatewayCredentialRepository,
    private readonly cipher: GatewayCredentialCipher,
    private readonly clock: () => number = Date.now
  ) {}

  async status(): Promise<GatewayCredentialSummary> {
    return summarize(await this.repository.find());
  }

  async import(input: {
    bundle: unknown;
    actorId: string;
    expectedRevision: number | null;
    remark: string | null;
  }): Promise<GatewayCredentialSummary> {
    const bundle = parseAlibabaOpenApiCredentialBundle(input.bundle);
    const encrypted = await this.cipher.encrypt(bundle);
    const record = await this.repository.save({
      ...encrypted,
      accessTokenExpiresTimeUtc: dateToEpoch(bundle.oauth.expiresAtUtc),
      refreshTokenExpiresTimeUtc: dateToEpoch(bundle.oauth.refreshExpiresAtUtc),
      actorId: input.actorId,
      expectedRevision: input.expectedRevision,
      remark: normalizeRemark(input.remark),
      now: this.clock()
    });
    return summarize(record);
  }

  async clear(expectedRevision: number): Promise<void> {
    if (!(await this.repository.delete(expectedRevision))) throw new EntityVersionConflictError();
  }
}

export class StoredAlibabaCredentialProvider {
  readonly #endpoint: URL;
  readonly #signMethod: SignMethod;
  readonly #network: NetworkManager;

  constructor(
    private readonly repository: GatewayCredentialRepository,
    private readonly cipher: GatewayCredentialCipher,
    options: {
      endpoint?: string;
      signMethod?: string;
      transport?: NetworkTransport;
      clock?: () => number;
    } = {}
  ) {
    this.#endpoint = readEndpoint(options.endpoint ?? ALIBABA_GATEWAY);
    this.#signMethod = readSignMethod(options.signMethod);
    this.clock = options.clock ?? Date.now;
    this.#network = new NetworkManager({
      ...(options.transport ? { transport: options.transport } : {}),
      policies: {
        alibaba: {
          allowedOrigins: [new URL(TOKEN_ENDPOINT).origin],
          timeoutMilliseconds: 30_000,
          maxRequestBytes: 16 * 1024,
          maxResponseBytes: 64 * 1024,
          defaultHeaders: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
          redirect: 'error'
        },
        bff: { allowedOrigins: [] },
        'external-photo': { allowedOrigins: [] }
      }
    });
  }

  private readonly clock: () => number;

  async status(): Promise<AlibabaCredentialStatus> {
    const record = await this.repository.find();
    return {
      source: 'd1-vault',
      configured: record !== null,
      hasAppKey: record !== null,
      hasAppSecret: record !== null,
      hasAccessToken: record !== null,
      endpointOrigin: this.#endpoint.origin,
      signMethod: this.#signMethod,
      accessTokenExpiresTimeUtc: record?.accessTokenExpiresTimeUtc ?? null,
      lastRefreshTimeUtc: record?.lastRefreshTimeUtc ?? null,
      lastRefreshErrorCode: record?.lastRefreshErrorCode ?? null
    };
  }

  async requireCredentials(
    requestId: string = crypto.randomUUID(),
    forceRefresh = false
  ): Promise<GatewayCredentials> {
    const record = await this.repository.find();
    if (!record) {
      throw new GatewayConfigurationError(
        'ALIBABA_CREDENTIALS_NOT_CONFIGURED',
        '请先在管理后台导入 Alibaba OpenAPI 授权包'
      );
    }
    let bundle = await this.cipher.decrypt(record);
    if (forceRefresh || shouldRefresh(record.accessTokenExpiresTimeUtc, this.clock())) {
      const refreshed = await this.refresh(record, bundle, requestId);
      bundle = refreshed.bundle;
    }
    return {
      appKey: bundle.application.appKey,
      appSecret: bundle.application.appSecret,
      accessToken: bundle.oauth.accessToken,
      endpoint: this.#endpoint.href,
      signMethod: this.#signMethod
    };
  }

  private async refresh(
    record: GatewayCredentialRecord,
    bundle: AlibabaOpenApiCredentialBundle,
    requestId: string
  ): Promise<{ record: GatewayCredentialRecord; bundle: AlibabaOpenApiCredentialBundle }> {
    if (!bundle.oauth.refreshToken) {
      throw new GatewayConfigurationError(
        'ALIBABA_REFRESH_TOKEN_MISSING',
        '授权包没有 Refresh Token，请重新完成浏览器授权'
      );
    }
    const now = this.clock();
    if (record.refreshTokenExpiresTimeUtc !== null && record.refreshTokenExpiresTimeUtc <= now) {
      throw new GatewayConfigurationError(
        'ALIBABA_REFRESH_TOKEN_EXPIRED',
        'Refresh Token 已过期，请重新完成浏览器授权'
      );
    }
    const leaseId = crypto.randomUUID();
    if (!(await this.repository.acquireRefreshLease(leaseId, now))) {
      const latest = await this.repository.find();
      if (latest && !shouldRefresh(latest.accessTokenExpiresTimeUtc, this.clock())) {
        return { record: latest, bundle: await this.cipher.decrypt(latest) };
      }
      throw new GatewayConfigurationError(
        'ALIBABA_CREDENTIAL_REFRESH_IN_PROGRESS',
        'Alibaba Token 正在由另一请求刷新，请稍后重试'
      );
    }
    try {
      const form = new URLSearchParams({
        refresh_token: bundle.oauth.refreshToken,
        grant_type: 'refresh_token',
        client_id: bundle.application.appKey,
        client_secret: bundle.application.appSecret,
        sp: 'icbu'
      });
      const response = await this.#network.request({
        service: 'alibaba',
        url: TOKEN_ENDPOINT,
        requestId,
        method: 'POST',
        body: form,
        responseType: 'json',
        maxAttempts: 1
      });
      if (!response.ok) {
        throw new GatewayConfigurationError(
          'ALIBABA_TOKEN_REFRESH_FAILED',
          `Alibaba Token 刷新失败（HTTP ${response.status}）`
        );
      }
      const token = parseAlibabaTokenResponse(response.data);
      const refreshedAt = this.clock();
      const refreshedBundle: AlibabaOpenApiCredentialBundle = {
        ...bundle,
        capturedAtUtc: new Date(refreshedAt).toISOString(),
        oauth: {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken ?? bundle.oauth.refreshToken,
          expiresAtUtc: credentialExpiryFromSeconds(refreshedAt, token.expiresInSeconds),
          refreshExpiresAtUtc:
            credentialExpiryFromSeconds(refreshedAt, token.refreshExpiresInSeconds) ??
            bundle.oauth.refreshExpiresAtUtc
        }
      };
      const encrypted = await this.cipher.encrypt(refreshedBundle);
      const updated = await this.repository.completeRefresh({
        leaseId,
        expectedRevision: record.revision,
        ...encrypted,
        accessTokenExpiresTimeUtc: dateToEpoch(refreshedBundle.oauth.expiresAtUtc),
        refreshTokenExpiresTimeUtc: dateToEpoch(refreshedBundle.oauth.refreshExpiresAtUtc),
        now: refreshedAt
      });
      return { record: updated, bundle: refreshedBundle };
    } catch (error: unknown) {
      const code = error instanceof GatewayConfigurationError ? error.code : 'ALIBABA_TOKEN_REFRESH_FAILED';
      await this.repository.failRefresh(leaseId, code, this.clock());
      throw error;
    }
  }
}

function shouldRefresh(expiresAt: number | null, now: number): boolean {
  return expiresAt !== null && expiresAt <= now + REFRESH_WINDOW_MS;
}

function summarize(record: GatewayCredentialRecord | null): GatewayCredentialSummary {
  return {
    configured: record !== null,
    revision: record?.revision ?? null,
    accessTokenExpiresTimeUtc: record?.accessTokenExpiresTimeUtc ?? null,
    refreshTokenExpiresTimeUtc: record?.refreshTokenExpiresTimeUtc ?? null,
    lastRefreshTimeUtc: record?.lastRefreshTimeUtc ?? null,
    lastRefreshErrorCode: record?.lastRefreshErrorCode ?? null,
    updateTimeUtc: record?.updateTimeUtc ?? null,
    updaterId: record?.updaterId ?? null,
    remark: record?.remark ?? null
  };
}

function additionalData(keyVersion = KEY_VERSION): Uint8Array {
  return new TextEncoder().encode(
    `one-vegetable:alibaba-credential:${SCHEMA_VERSION}:${CREDENTIAL_ID}:${keyVersion}`
  );
}

function dateToEpoch(value: string | null): number | null {
  return value === null ? null : Date.parse(value);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) return new Uint8Array();
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function toCredentialRecord(row: Record<string, unknown>): GatewayCredentialRecord {
  return {
    id: 'primary',
    encryptedBundle: requiredString(row, 'encrypted_bundle'),
    initializationVector: requiredString(row, 'initialization_vector'),
    algorithm: ALGORITHM,
    schemaVersion: SCHEMA_VERSION,
    keyVersion: requiredNumber(row, 'key_version'),
    accessTokenExpiresTimeUtc: nullableNumber(row, 'access_token_expires_time_utc'),
    refreshTokenExpiresTimeUtc: nullableNumber(row, 'refresh_token_expires_time_utc'),
    refreshLeaseId: nullableString(row, 'refresh_lease_id'),
    refreshLeaseUntilUtc: nullableNumber(row, 'refresh_lease_until_utc'),
    lastRefreshTimeUtc: nullableNumber(row, 'last_refresh_time_utc'),
    lastRefreshErrorCode: nullableString(row, 'last_refresh_error_code'),
    createTimeUtc: requiredNumber(row, 'create_time_utc'),
    updateTimeUtc: requiredNumber(row, 'update_time_utc'),
    creatorId: requiredString(row, 'creator_id'),
    updaterId: requiredString(row, 'updater_id'),
    revision: requiredNumber(row, 'revision'),
    remark: nullableString(row, 'remark')
  };
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

function nullableNumber(row: Record<string, unknown>, key: string): number | null {
  return row[key] === null ? null : requiredNumber(row, key);
}
