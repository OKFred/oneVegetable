import {
  SOCIAL_MEDIA_ASSET_TTL_MILLISECONDS,
  SOCIAL_MEDIA_JOB_RETENTION_MILLISECONDS,
  validateSocialImagePayload
} from '@one-vegetable/core';

import type { EncodedFilePayload, SocialPlatform } from '@one-vegetable/core';
import type { SocialMediaStore, SocialMediaStoredObject } from './media-store';
import type { SocialMediaAssetRecord, SocialPublishingRepository } from './publishing-repository';

const CLEANUP_INTERVAL_MILLISECONDS = 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export class SocialMediaAssetError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'SocialMediaAssetError';
  }
}

export class SocialMediaAssetService {
  #lastCleanupTimeUtc = 0;

  constructor(
    private readonly repository: SocialPublishingRepository,
    private readonly store: SocialMediaStore,
    private readonly clock: () => number = Date.now
  ) {}

  async stage(payload: EncodedFilePayload, platform: SocialPlatform): Promise<SocialMediaAssetRecord> {
    await this.cleanupIfDue();
    let image;
    try {
      image = validateSocialImagePayload(payload, platform);
    } catch (error: unknown) {
      throw new SocialMediaAssetError(
        'SOCIAL_IMAGE_INVALID',
        error instanceof Error ? error.message : '图片无效',
        400
      );
    }
    const now = this.clock();
    const id = crypto.randomUUID();
    const storageKey = id;
    const initialToken = randomToken();
    const record: SocialMediaAssetRecord = {
      id,
      opaqueTokenHash: await sha256Text(initialToken),
      storageKey,
      fileName: payload.fileName.trim(),
      contentType: image.contentType,
      byteLength: image.bytes.byteLength,
      contentSha256: await sha256Bytes(image.bytes),
      width: image.width,
      height: image.height,
      expiresTimeUtc: now + SOCIAL_MEDIA_ASSET_TTL_MILLISECONDS,
      createTimeUtc: now
    };
    await this.store.put(storageKey, image.bytes, image.contentType);
    try {
      await this.repository.createAsset(record);
    } catch (error: unknown) {
      await this.store.delete(storageKey);
      throw error;
    }
    return record;
  }

  async issuePublicUrl(input: { assetId: string; publicOrigin: string; apiPrefix: string }): Promise<string> {
    const asset = await this.repository.findAsset(input.assetId);
    if (!asset || asset.expiresTimeUtc <= this.clock()) {
      throw new SocialMediaAssetError('SOCIAL_ASSET_EXPIRED', '待发布图片已过期，请重新准备', 410);
    }
    const token = randomToken();
    if (!(await this.repository.rotateAssetToken(asset.id, await sha256Text(token)))) {
      throw new SocialMediaAssetError('SOCIAL_ASSET_NOT_FOUND', '待发布图片不存在', 404);
    }
    return `${input.publicOrigin}${input.apiPrefix}/social-media/${token}`;
  }

  async readByOpaqueToken(token: string): Promise<SocialMediaStoredObject | null> {
    await this.cleanupIfDue();
    if (!TOKEN_PATTERN.test(token)) return null;
    const asset = await this.repository.findAssetByTokenHash(await sha256Text(token));
    if (!asset || asset.expiresTimeUtc <= this.clock()) return null;
    const object = await this.store.get(asset.storageKey);
    if (object?.bytes.byteLength !== asset.byteLength || object.contentType !== asset.contentType) {
      return null;
    }
    return object;
  }

  async cleanupIfDue(): Promise<void> {
    const now = this.clock();
    if (now - this.#lastCleanupTimeUtc < CLEANUP_INTERVAL_MILLISECONDS) return;
    this.#lastCleanupTimeUtc = now;
    const storageKeys = await this.repository.cleanup(now, now - SOCIAL_MEDIA_JOB_RETENTION_MILLISECONDS);
    await Promise.allSettled(storageKeys.map((key) => this.store.delete(key)));
  }
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

async function sha256Text(value: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(value));
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
