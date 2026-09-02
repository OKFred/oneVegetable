import type { SocialPublishJob } from '@one-vegetable/core';
import type { SqlExecutor } from '../db/sql-executor';

export interface SocialMediaAssetRecord {
  id: string;
  opaqueTokenHash: string;
  storageKey: string;
  fileName: string;
  contentType: 'image/jpeg' | 'image/png';
  byteLength: number;
  contentSha256: string;
  width: number | null;
  height: number | null;
  expiresTimeUtc: number;
  createTimeUtc: number;
}

export interface SocialPublishJobRecord extends SocialPublishJob {
  requestFingerprint: string;
  encryptedCaption: string;
  captionInitializationVector: string;
  assetId: string;
  publishAttemptedTimeUtc: number | null;
  finalPublishAttemptedTimeUtc: number | null;
}

export interface SocialPublishingRepository {
  createAsset(input: SocialMediaAssetRecord): Promise<void>;
  findAsset(id: string): Promise<SocialMediaAssetRecord | null>;
  findAssetByTokenHash(hash: string): Promise<SocialMediaAssetRecord | null>;
  rotateAssetToken(id: string, tokenHash: string): Promise<boolean>;
  createJob(input: SocialPublishJobRecord): Promise<void>;
  findJob(id: string): Promise<SocialPublishJobRecord | null>;
  findJobByIdempotencyKey(idempotencyKey: string): Promise<SocialPublishJobRecord | null>;
  listJobs(actorId: string, limit: number): Promise<SocialPublishJob[]>;
  updateJob(input: {
    id: string;
    expectedRevision: number;
    status: SocialPublishJob['status'];
    platformContainerId: string | null;
    platformPostId: string | null;
    platformRequestId: string | null;
    platformTraceId: string | null;
    publishAttemptedTimeUtc: number | null;
    finalPublishAttemptedTimeUtc: number | null;
    nextAdvanceTimeUtc: number | null;
    reasonCode: string | null;
    message: string | null;
    actorId: string;
    now: number;
  }): Promise<SocialPublishJobRecord | null>;
  cleanup(now: number, retentionCutoff: number): Promise<string[]>;
}

export class SqlSocialPublishingRepository implements SocialPublishingRepository {
  constructor(private readonly executor: SqlExecutor) {}

  async createAsset(input: SocialMediaAssetRecord): Promise<void> {
    await this.executor.execute(
      `INSERT INTO social_media_assets (
        id, opaque_token_hash, storage_key, file_name, content_type, byte_length,
        content_sha256, width, height, expires_time_utc, create_time_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.opaqueTokenHash,
        input.storageKey,
        input.fileName,
        input.contentType,
        input.byteLength,
        input.contentSha256,
        input.width,
        input.height,
        input.expiresTimeUtc,
        input.createTimeUtc
      ]
    );
  }

  async findAsset(id: string): Promise<SocialMediaAssetRecord | null> {
    const rows = await this.executor.query('SELECT * FROM social_media_assets WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? toAsset(rows[0]) : null;
  }

  async findAssetByTokenHash(hash: string): Promise<SocialMediaAssetRecord | null> {
    const rows = await this.executor.query(
      'SELECT * FROM social_media_assets WHERE opaque_token_hash = ? LIMIT 1',
      [hash]
    );
    return rows[0] ? toAsset(rows[0]) : null;
  }

  async rotateAssetToken(id: string, tokenHash: string): Promise<boolean> {
    const result = await this.executor.execute(
      'UPDATE social_media_assets SET opaque_token_hash = ? WHERE id = ?',
      [tokenHash, id]
    );
    return result.changes === 1;
  }

  async createJob(input: SocialPublishJobRecord): Promise<void> {
    await this.executor.execute(
      `INSERT INTO social_publish_jobs (
        id, request_id, idempotency_key, request_fingerprint, destination_id, platform, status,
        encrypted_caption, caption_initialization_vector, caption_length, asset_id, file_name,
        content_type, byte_length, content_sha256, platform_container_id, platform_post_id,
        platform_request_id, platform_trace_id, publish_attempted_time_utc,
        final_publish_attempted_time_utc, next_advance_time_utc, reason_code, message,
        expires_time_utc, create_time_utc, update_time_utc, creator_id, updater_id, revision, remark
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.requestId,
        input.idempotencyKey,
        input.requestFingerprint,
        input.destinationId,
        input.platform,
        input.status,
        input.encryptedCaption,
        input.captionInitializationVector,
        input.captionLength,
        input.assetId,
        input.fileName,
        input.contentType,
        input.byteLength,
        input.contentSha256,
        input.platformContainerId,
        input.platformPostId,
        input.platformRequestId,
        input.platformTraceId,
        input.publishAttemptedTimeUtc,
        input.finalPublishAttemptedTimeUtc,
        input.nextAdvanceTimeUtc,
        input.reasonCode,
        input.message,
        input.expiresTimeUtc,
        input.createTimeUtc,
        input.updateTimeUtc,
        input.creatorId,
        input.updaterId,
        input.revision,
        input.remark
      ]
    );
  }

  async findJob(id: string): Promise<SocialPublishJobRecord | null> {
    const rows = await this.executor.query('SELECT * FROM social_publish_jobs WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? toJob(rows[0]) : null;
  }

  async findJobByIdempotencyKey(idempotencyKey: string): Promise<SocialPublishJobRecord | null> {
    const rows = await this.executor.query(
      'SELECT * FROM social_publish_jobs WHERE idempotency_key = ? LIMIT 1',
      [idempotencyKey]
    );
    return rows[0] ? toJob(rows[0]) : null;
  }

  async listJobs(actorId: string, limit: number): Promise<SocialPublishJob[]> {
    const rows = await this.executor.query(
      `SELECT * FROM social_publish_jobs
       WHERE creator_id = ?
       ORDER BY create_time_utc DESC
       LIMIT ?`,
      [actorId, limit]
    );
    return rows.map((row) => publicJob(toJob(row)));
  }

  async updateJob(input: {
    id: string;
    expectedRevision: number;
    status: SocialPublishJob['status'];
    platformContainerId: string | null;
    platformPostId: string | null;
    platformRequestId: string | null;
    platformTraceId: string | null;
    publishAttemptedTimeUtc: number | null;
    finalPublishAttemptedTimeUtc: number | null;
    nextAdvanceTimeUtc: number | null;
    reasonCode: string | null;
    message: string | null;
    actorId: string;
    now: number;
  }): Promise<SocialPublishJobRecord | null> {
    const result = await this.executor.execute(
      `UPDATE social_publish_jobs SET
        status = ?, platform_container_id = ?, platform_post_id = ?, platform_request_id = ?,
        platform_trace_id = ?, publish_attempted_time_utc = ?, final_publish_attempted_time_utc = ?,
        next_advance_time_utc = ?, reason_code = ?, message = ?, update_time_utc = ?, updater_id = ?,
        revision = revision + 1
       WHERE id = ? AND revision = ?`,
      [
        input.status,
        input.platformContainerId,
        input.platformPostId,
        input.platformRequestId,
        input.platformTraceId,
        input.publishAttemptedTimeUtc,
        input.finalPublishAttemptedTimeUtc,
        input.nextAdvanceTimeUtc,
        input.reasonCode,
        input.message,
        input.now,
        input.actorId,
        input.id,
        input.expectedRevision
      ]
    );
    return result.changes === 1 ? this.findJob(input.id) : null;
  }

  async cleanup(now: number, retentionCutoff: number): Promise<string[]> {
    await this.executor.execute(
      `UPDATE social_publish_jobs
       SET status = 'expired', update_time_utc = ?, revision = revision + 1
       WHERE expires_time_utc <= ? AND status IN ('prepared', 'processing')`,
      [now, now]
    );
    await this.executor.execute('DELETE FROM social_publish_jobs WHERE create_time_utc < ?', [
      retentionCutoff
    ]);
    const rows = await this.executor.query(
      'SELECT storage_key FROM social_media_assets WHERE expires_time_utc <= ?',
      [now]
    );
    await this.executor.execute(
      `DELETE FROM social_media_assets
       WHERE expires_time_utc <= ?
       AND NOT EXISTS (SELECT 1 FROM social_publish_jobs j WHERE j.asset_id = social_media_assets.id)`,
      [now]
    );
    return rows.map((row) => requiredString(row, 'storage_key'));
  }
}

export function publicJob(record: SocialPublishJobRecord): SocialPublishJob {
  const {
    requestFingerprint: _requestFingerprint,
    encryptedCaption: _encryptedCaption,
    captionInitializationVector: _captionInitializationVector,
    assetId: _assetId,
    publishAttemptedTimeUtc: _publishAttemptedTimeUtc,
    finalPublishAttemptedTimeUtc: _finalPublishAttemptedTimeUtc,
    ...job
  } = record;
  return job;
}

function toAsset(row: Record<string, unknown>): SocialMediaAssetRecord {
  return {
    id: requiredString(row, 'id'),
    opaqueTokenHash: requiredString(row, 'opaque_token_hash'),
    storageKey: requiredString(row, 'storage_key'),
    fileName: requiredString(row, 'file_name'),
    contentType: requiredEnum(row, 'content_type', ['image/jpeg', 'image/png']),
    byteLength: requiredNumber(row, 'byte_length'),
    contentSha256: requiredString(row, 'content_sha256'),
    width: nullableNumber(row, 'width'),
    height: nullableNumber(row, 'height'),
    expiresTimeUtc: requiredNumber(row, 'expires_time_utc'),
    createTimeUtc: requiredNumber(row, 'create_time_utc')
  };
}

function toJob(row: Record<string, unknown>): SocialPublishJobRecord {
  return {
    id: requiredString(row, 'id'),
    requestId: requiredString(row, 'request_id'),
    idempotencyKey: requiredString(row, 'idempotency_key'),
    requestFingerprint: requiredString(row, 'request_fingerprint'),
    destinationId: requiredString(row, 'destination_id'),
    platform: requiredEnum(row, 'platform', ['facebook', 'instagram']),
    status: requiredEnum(row, 'status', [
      'prepared',
      'processing',
      'published',
      'failed',
      'unknown',
      'cancelled',
      'expired'
    ]),
    encryptedCaption: requiredString(row, 'encrypted_caption'),
    captionInitializationVector: requiredString(row, 'caption_initialization_vector'),
    captionLength: requiredNumber(row, 'caption_length'),
    assetId: requiredString(row, 'asset_id'),
    fileName: requiredString(row, 'file_name'),
    contentType: requiredEnum(row, 'content_type', ['image/jpeg', 'image/png']),
    byteLength: requiredNumber(row, 'byte_length'),
    contentSha256: requiredString(row, 'content_sha256'),
    platformContainerId: nullableString(row, 'platform_container_id'),
    platformPostId: nullableString(row, 'platform_post_id'),
    platformRequestId: nullableString(row, 'platform_request_id'),
    platformTraceId: nullableString(row, 'platform_trace_id'),
    publishAttemptedTimeUtc: nullableNumber(row, 'publish_attempted_time_utc'),
    finalPublishAttemptedTimeUtc: nullableNumber(row, 'final_publish_attempted_time_utc'),
    nextAdvanceTimeUtc: nullableNumber(row, 'next_advance_time_utc'),
    reasonCode: nullableString(row, 'reason_code'),
    message: nullableString(row, 'message'),
    expiresTimeUtc: requiredNumber(row, 'expires_time_utc'),
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
  if (typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`数据库字段 ${key} 无效`);
  }
  return value;
}

function nullableNumber(row: Record<string, unknown>, key: string): number | null {
  return row[key] === null ? null : requiredNumber(row, key);
}

function requiredEnum<const Value extends string>(
  row: Record<string, unknown>,
  key: string,
  values: readonly Value[]
): Value {
  const value = requiredString(row, key);
  if (!values.includes(value as Value)) throw new Error(`数据库字段 ${key} 无效`);
  return value as Value;
}
