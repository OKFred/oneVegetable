import { normalizeRemark, type NetworkTransport } from '@one-vegetable/core';
import {
  S3ObjectStorageClient,
  parseS3StorageConfiguration,
  validateS3StorageConfiguration,
  type S3StorageConfiguration,
  type S3StorageConfigurationSummary
} from '@one-vegetable/core/s3-storage';

import { EntityVersionConflictError } from '../db/repository';
import { GatewayConfigurationError } from '../gateway/credentials';

import type { SqlExecutor } from '../db/sql-executor';

const CONFIGURATION_ID = 'primary';
const KEY_VERSION = 1;

export interface S3StorageConfigurationRecord {
  id: 'primary';
  encryptedConfiguration: string;
  initializationVector: string;
  keyVersion: number;
  createTimeUtc: number;
  updateTimeUtc: number;
  creatorId: string;
  updaterId: string;
  revision: number;
  remark: string | null;
}

export class S3StorageConfigurationCipher {
  readonly #key: CryptoKey;

  private constructor(key: CryptoKey) {
    this.#key = key;
  }

  static async create(encodedKey: string | undefined): Promise<S3StorageConfigurationCipher> {
    const bytes = decodeBase64Url(encodedKey?.trim() ?? '');
    if (bytes.byteLength !== 32) {
      throw new GatewayConfigurationError(
        'S3_CREDENTIAL_ENCRYPTION_KEY_INVALID',
        'S3 凭据加密密钥必须是 32 字节 Base64URL'
      );
    }
    const key = await crypto.subtle.importKey('raw', toArrayBuffer(bytes), { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt'
    ]);
    return new S3StorageConfigurationCipher(key);
  }

  async encrypt(configuration: S3StorageConfiguration): Promise<{
    encryptedConfiguration: string;
    initializationVector: string;
  }> {
    const initializationVector = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(initializationVector),
        additionalData: toArrayBuffer(additionalData(KEY_VERSION))
      },
      this.#key,
      new TextEncoder().encode(JSON.stringify(configuration))
    );
    return {
      encryptedConfiguration: encodeBase64Url(new Uint8Array(ciphertext)),
      initializationVector: encodeBase64Url(initializationVector)
    };
  }

  async decrypt(record: S3StorageConfigurationRecord): Promise<S3StorageConfiguration> {
    try {
      const plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: toArrayBuffer(decodeBase64Url(record.initializationVector)),
          additionalData: toArrayBuffer(additionalData(record.keyVersion))
        },
        this.#key,
        toArrayBuffer(decodeBase64Url(record.encryptedConfiguration))
      );
      const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
      return parseS3StorageConfiguration(parsed);
    } catch {
      throw new GatewayConfigurationError(
        'S3_CREDENTIAL_VAULT_UNREADABLE',
        'S3 配置无法解密，请检查加密密钥或重新保存'
      );
    }
  }
}

export class SqlS3StorageConfigurationRepository {
  constructor(private readonly executor: SqlExecutor) {}

  async find(): Promise<S3StorageConfigurationRecord | null> {
    const row = (
      await this.executor.query('SELECT * FROM s3_storage_configurations WHERE id = ? LIMIT 1', [
        CONFIGURATION_ID
      ])
    )[0];
    return row ? toRecord(row) : null;
  }

  async save(input: {
    encryptedConfiguration: string;
    initializationVector: string;
    actorId: string;
    expectedRevision: number | null;
    remark: string | null;
    now: number;
  }): Promise<S3StorageConfigurationRecord> {
    const revision = input.expectedRevision === null ? 1 : input.expectedRevision + 1;
    const result = await this.executor.execute(
      `INSERT INTO s3_storage_configurations (
        id, encrypted_configuration, initialization_vector, algorithm, schema_version, key_version,
        create_time_utc, update_time_utc, creator_id, updater_id, revision, remark
      ) VALUES (?, ?, ?, 'AES-256-GCM', 1, 1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        encrypted_configuration = excluded.encrypted_configuration,
        initialization_vector = excluded.initialization_vector,
        update_time_utc = excluded.update_time_utc,
        updater_id = excluded.updater_id,
        revision = excluded.revision,
        remark = excluded.remark
      WHERE s3_storage_configurations.revision = ?`,
      [
        CONFIGURATION_ID,
        input.encryptedConfiguration,
        input.initializationVector,
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
    if (!stored) throw new Error('S3 配置保存后无法读取');
    return stored;
  }

  async delete(expectedRevision: number): Promise<boolean> {
    const result = await this.executor.execute(
      'DELETE FROM s3_storage_configurations WHERE id = ? AND revision = ?',
      [CONFIGURATION_ID, expectedRevision]
    );
    return result.changes === 1;
  }
}

export class S3StorageConfigurationService {
  constructor(
    private readonly repository: SqlS3StorageConfigurationRepository,
    private readonly cipher: S3StorageConfigurationCipher,
    private readonly clock: () => number = Date.now,
    private readonly transport?: NetworkTransport,
    private readonly allowLocalHttp = false
  ) {}

  async summary(): Promise<S3StorageConfigurationSummary> {
    const record = await this.repository.find();
    if (!record) return emptySummary();
    return summarize(await this.cipher.decrypt(record), record);
  }

  async save(input: {
    configuration: S3StorageConfiguration;
    actorId: string;
    expectedRevision: number | null;
    remark: string | null;
  }): Promise<S3StorageConfigurationSummary> {
    const configuration = validateS3StorageConfiguration(input.configuration);
    this.assertRuntime(configuration);
    const encrypted = await this.cipher.encrypt(configuration);
    const record = await this.repository.save({
      ...encrypted,
      actorId: input.actorId,
      expectedRevision: input.expectedRevision,
      remark: normalizeRemark(input.remark),
      now: this.clock()
    });
    return summarize(configuration, record);
  }

  async requireConfiguration(): Promise<S3StorageConfiguration> {
    const record = await this.repository.find();
    if (!record) {
      throw new GatewayConfigurationError('S3_STORAGE_NOT_CONFIGURED', '请先在设置中配置 S3 存储');
    }
    const configuration = await this.cipher.decrypt(record);
    this.assertRuntime(configuration);
    return configuration;
  }

  async galleryStorageContextId(): Promise<string | null> {
    if (!(await this.repository.find())) return null;
    const { galleryStorageId } = await import('@one-vegetable/core/gallery-transfer-context');
    return galleryStorageId(await this.requireConfiguration());
  }

  async createClient(
    transport?: NetworkTransport,
    expectedContextId?: string | null
  ): Promise<S3ObjectStorageClient> {
    const configuration = await this.requireConfiguration();
    if (expectedContextId !== undefined) {
      const { assertGalleryContextId, galleryStorageId } =
        await import('@one-vegetable/core/gallery-transfer-context');
      assertGalleryContextId(expectedContextId, await galleryStorageId(configuration));
    }
    return new S3ObjectStorageClient(configuration, transport ?? this.transport);
  }

  async clear(expectedRevision: number): Promise<void> {
    if (!(await this.repository.delete(expectedRevision))) throw new EntityVersionConflictError();
  }
  private assertRuntime(configuration: S3StorageConfiguration): void {
    if (configuration.endpoint.startsWith('http:') && !this.allowLocalHttp)
      throw new GatewayConfigurationError('S3_LOCAL_HTTP_DISABLED', 'S3_LOCAL_HTTP_DISABLED');
  }
}

function summarize(
  configuration: S3StorageConfiguration,
  record: S3StorageConfigurationRecord
): S3StorageConfigurationSummary {
  return {
    configured: true,
    endpoint: configuration.endpoint,
    region: configuration.region,
    bucket: configuration.bucket,
    accessKeyIdSuffix: configuration.accessKeyId.slice(-4),
    hasSessionToken: configuration.sessionToken !== null,
    pathStyle: configuration.pathStyle,
    rootPrefix: configuration.rootPrefix,
    revision: record.revision,
    updateTimeUtc: record.updateTimeUtc,
    updaterId: record.updaterId,
    remark: record.remark
  };
}

function emptySummary(): S3StorageConfigurationSummary {
  return {
    configured: false,
    endpoint: null,
    region: null,
    bucket: null,
    accessKeyIdSuffix: null,
    hasSessionToken: false,
    pathStyle: null,
    rootPrefix: null,
    revision: null,
    updateTimeUtc: null,
    updaterId: null,
    remark: null
  };
}

function toRecord(row: Record<string, unknown>): S3StorageConfigurationRecord {
  return {
    id: 'primary',
    encryptedConfiguration: requiredString(row.encrypted_configuration),
    initializationVector: requiredString(row.initialization_vector),
    keyVersion: requiredNumber(row.key_version),
    createTimeUtc: requiredNumber(row.create_time_utc),
    updateTimeUtc: requiredNumber(row.update_time_utc),
    creatorId: requiredString(row.creator_id),
    updaterId: requiredString(row.updater_id),
    revision: requiredNumber(row.revision),
    remark: typeof row.remark === 'string' ? row.remark : null
  };
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('S3 配置记录字段无效');
  return value;
}

function requiredNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('S3 配置记录字段无效');
  return value;
}

function additionalData(keyVersion: number): Uint8Array {
  return new TextEncoder().encode(`one-vegetable:s3-storage:1:primary:${keyVersion}`);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) return new Uint8Array();
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  try {
    return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), (character) =>
      character.charCodeAt(0)
    );
  } catch {
    return new Uint8Array();
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
