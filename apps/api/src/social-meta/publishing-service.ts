import { normalizeRemark, SOCIAL_MEDIA_JOB_RETENTION_MILLISECONDS } from '@one-vegetable/core';

import { MetaPublisherError } from './meta-publisher';
import { publicJob } from './publishing-repository';

import type { SocialPostPermalink, SocialPostPrepareRequest, SocialPublishJob } from '@one-vegetable/core';
import type { MetaPublisher } from './meta-publisher';
import type { SocialMediaAssetService } from './media-service';
import type { SocialPublishingRepository, SocialPublishJobRecord } from './publishing-repository';
import type { MetaSecretCipher } from './secret-cipher';
import type { MetaSocialService, MetaPublishingDestination } from './service';

const INSTAGRAM_ADVANCE_INTERVAL_MILLISECONDS = 60_000;

export class SocialPublishingServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable = false
  ) {
    super(message);
    this.name = 'SocialPublishingServiceError';
  }
}

export class SocialPublishingService {
  constructor(
    private readonly repository: SocialPublishingRepository,
    private readonly mediaAssets: SocialMediaAssetService,
    private readonly metaSocial: MetaSocialService,
    private readonly cipher: MetaSecretCipher,
    private readonly publisher: MetaPublisher,
    private readonly clock: () => number = Date.now
  ) {}

  async prepare(input: SocialPostPrepareRequest, actorId: string): Promise<SocialPublishJob> {
    const caption = normalizeCaption(input.caption);
    const fingerprint = await requestFingerprint(input, caption);
    const existing = await this.repository.findJobByIdempotencyKey(input.idempotencyKey);
    if (existing) return this.sameIdempotentJob(existing, fingerprint, actorId);
    const destination = await this.metaSocial.resolvePublishingDestination(input.destinationId);
    assertCaptionLength(caption, destination.destination.platform);

    const asset = await this.mediaAssets.stage(input.file, destination.destination.platform);
    const id = crypto.randomUUID();
    const encryptedCaption = await this.cipher.encrypt('publish-caption', id, caption);
    const now = this.clock();
    const record: SocialPublishJobRecord = {
      id,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint,
      destinationId: destination.destination.id,
      platform: destination.destination.platform,
      status: 'prepared',
      encryptedCaption: encryptedCaption.ciphertext,
      captionInitializationVector: encryptedCaption.initializationVector,
      captionLength: Array.from(caption).length,
      assetId: asset.id,
      fileName: asset.fileName,
      contentType: asset.contentType,
      byteLength: asset.byteLength,
      contentSha256: asset.contentSha256,
      platformContainerId: null,
      platformPostId: null,
      platformRequestId: null,
      platformTraceId: null,
      publishAttemptedTimeUtc: null,
      finalPublishAttemptedTimeUtc: null,
      nextAdvanceTimeUtc: null,
      reasonCode: null,
      message: null,
      expiresTimeUtc: Math.min(asset.expiresTimeUtc, now + SOCIAL_MEDIA_JOB_RETENTION_MILLISECONDS),
      createTimeUtc: now,
      updateTimeUtc: now,
      creatorId: actorId,
      updaterId: actorId,
      revision: 1,
      remark: normalizeRemark(null)
    };
    try {
      await this.repository.createJob(record);
      return publicJob(record);
    } catch (error: unknown) {
      const raced = await this.repository.findJobByIdempotencyKey(input.idempotencyKey);
      if (raced) return this.sameIdempotentJob(raced, fingerprint, actorId);
      throw error;
    }
  }

  async publish(input: { jobId: string; requestId: string; actorId: string }): Promise<SocialPublishJob> {
    const job = await this.requireOwnedJob(input.jobId, input.actorId);
    if (job.status !== 'prepared') return publicJob(job);
    if (job.expiresTimeUtc <= this.clock()) return this.expire(job, input.actorId);

    const destination = await this.metaSocial.resolvePublishingDestination(job.destinationId);
    const caption = await this.readCaption(job);
    const image = job.platform === 'facebook' ? await this.mediaAssets.readById(job.assetId) : null;
    const imageUrl =
      job.platform === 'instagram' ? await this.instagramImageUrl(job.assetId, destination) : null;
    const attemptedAt = this.clock();
    const started = await this.update(job, input.actorId, {
      status: 'processing',
      publishAttemptedTimeUtc: attemptedAt,
      nextAdvanceTimeUtc:
        job.platform === 'instagram' ? attemptedAt + INSTAGRAM_ADVANCE_INTERVAL_MILLISECONDS : null,
      reasonCode: null,
      message: null
    });
    try {
      if (job.platform === 'facebook') {
        const result = await this.publisher.publishFacebook({
          graphApiVersion: destination.graphApiVersion,
          pageId: destination.destination.pageExternalId,
          accessToken: destination.accessToken,
          image: {
            bytes: image?.bytes ?? new Uint8Array(),
            contentType: job.contentType,
            fileName: job.fileName
          },
          caption,
          requestId: input.requestId
        });
        return publicJob(
          await this.update(started, input.actorId, {
            status: 'published',
            platformPostId: result.id,
            platformRequestId: result.requestId,
            platformTraceId: result.traceId,
            nextAdvanceTimeUtc: null
          })
        );
      }
      const result = await this.publisher.createInstagramContainer({
        graphApiVersion: destination.graphApiVersion,
        instagramAccountId: destination.destination.externalId,
        accessToken: destination.accessToken,
        imageUrl: imageUrl ?? '',
        caption,
        requestId: input.requestId
      });
      return publicJob(
        await this.update(started, input.actorId, {
          status: 'processing',
          platformContainerId: result.id,
          platformRequestId: result.requestId,
          platformTraceId: result.traceId,
          nextAdvanceTimeUtc: this.clock() + INSTAGRAM_ADVANCE_INTERVAL_MILLISECONDS
        })
      );
    } catch (error: unknown) {
      return publicJob(await this.recordPublishFailure(started, destination, input.actorId, error));
    }
  }

  async advance(input: { jobId: string; requestId: string; actorId: string }): Promise<SocialPublishJob> {
    const job = await this.requireOwnedJob(input.jobId, input.actorId);
    if (job.platform !== 'instagram' || job.status !== 'processing') return publicJob(job);
    if (job.expiresTimeUtc <= this.clock()) return this.expire(job, input.actorId);
    if (job.nextAdvanceTimeUtc !== null && job.nextAdvanceTimeUtc > this.clock()) return publicJob(job);
    if (!job.platformContainerId) {
      return publicJob(
        await this.update(job, input.actorId, {
          status: 'unknown',
          reasonCode: 'META_CONTAINER_RESULT_UNKNOWN',
          message: '容器创建结果未知，为避免重复发布已停止自动重试',
          nextAdvanceTimeUtc: null
        })
      );
    }
    if (job.finalPublishAttemptedTimeUtc !== null) {
      return publicJob(
        await this.update(job, input.actorId, {
          status: 'unknown',
          reasonCode: 'META_FINAL_PUBLISH_RESULT_UNKNOWN',
          message: '最终发布结果未知，为避免重复发布已停止自动重试',
          nextAdvanceTimeUtc: null
        })
      );
    }
    const destination = await this.metaSocial.resolvePublishingDestination(job.destinationId);
    let status;
    try {
      status = await this.publisher.readInstagramContainerStatus({
        graphApiVersion: destination.graphApiVersion,
        containerId: job.platformContainerId,
        accessToken: destination.accessToken,
        requestId: input.requestId
      });
    } catch (error: unknown) {
      if (error instanceof MetaPublisherError && error.tokenInvalid) {
        await this.metaSocial.markConnectionReconnectRequired(destination.destination.connectionId);
        return publicJob(await this.recordPublishFailure(job, destination, input.actorId, error));
      }
      return publicJob(
        await this.update(job, input.actorId, {
          status: 'processing',
          reasonCode: 'META_CONTAINER_STATUS_UNAVAILABLE',
          message: '暂时无法读取 Instagram 素材处理状态',
          nextAdvanceTimeUtc: this.clock() + INSTAGRAM_ADVANCE_INTERVAL_MILLISECONDS
        })
      );
    }
    if (status.status === 'processing') {
      return publicJob(
        await this.update(job, input.actorId, {
          status: 'processing',
          platformRequestId: status.requestId,
          platformTraceId: status.traceId,
          nextAdvanceTimeUtc: this.clock() + INSTAGRAM_ADVANCE_INTERVAL_MILLISECONDS,
          reasonCode: null,
          message: null
        })
      );
    }
    if (status.status === 'failed') {
      return publicJob(
        await this.update(job, input.actorId, {
          status: 'failed',
          platformRequestId: status.requestId,
          platformTraceId: status.traceId,
          nextAdvanceTimeUtc: null,
          reasonCode: 'META_CONTAINER_PROCESSING_FAILED',
          message: 'Instagram 未能处理所选图片'
        })
      );
    }

    const attempted = await this.update(job, input.actorId, {
      status: 'processing',
      finalPublishAttemptedTimeUtc: this.clock(),
      platformRequestId: status.requestId,
      platformTraceId: status.traceId,
      nextAdvanceTimeUtc: null,
      reasonCode: null,
      message: null
    });
    try {
      const result = await this.publisher.publishInstagramContainer({
        graphApiVersion: destination.graphApiVersion,
        instagramAccountId: destination.destination.externalId,
        accessToken: destination.accessToken,
        containerId: job.platformContainerId,
        requestId: input.requestId
      });
      return publicJob(
        await this.update(attempted, input.actorId, {
          status: 'published',
          platformPostId: result.id,
          platformRequestId: result.requestId,
          platformTraceId: result.traceId,
          nextAdvanceTimeUtc: null
        })
      );
    } catch (error: unknown) {
      return publicJob(await this.recordPublishFailure(attempted, destination, input.actorId, error));
    }
  }

  async get(jobId: string, actorId: string): Promise<SocialPublishJob> {
    return publicJob(await this.requireOwnedJob(jobId, actorId));
  }

  async getPermalink(input: {
    jobId: string;
    requestId: string;
    actorId: string;
  }): Promise<SocialPostPermalink> {
    const job = await this.requireOwnedJob(input.jobId, input.actorId);
    if (job.status !== 'published' || !job.platformPostId) {
      throw new SocialPublishingServiceError(
        'SOCIAL_POST_NOT_PUBLISHED',
        '只有已经发布成功的内容才能获取平台链接',
        409
      );
    }
    const destination = await this.metaSocial.resolvePublishingDestination(job.destinationId);
    try {
      const result = await this.publisher.readPermalink({
        graphApiVersion: destination.graphApiVersion,
        platform: job.platform,
        postId: job.platformPostId,
        accessToken: destination.accessToken,
        requestId: input.requestId
      });
      return {
        platform: job.platform,
        platformPostId: job.platformPostId,
        url: result.url,
        platformRequestId: result.requestId,
        platformTraceId: result.traceId
      };
    } catch (error: unknown) {
      const resolved =
        error instanceof MetaPublisherError
          ? error
          : new MetaPublisherError('META_PERMALINK_FAILED', '无法获取 Meta 内容链接', false, null, null);
      if (resolved.tokenInvalid) {
        await this.metaSocial.markConnectionReconnectRequired(destination.destination.connectionId);
      }
      throw new SocialPublishingServiceError(
        resolved.code,
        resolved.message,
        resolved.tokenInvalid ? 401 : 502,
        !resolved.tokenInvalid
      );
    }
  }

  list(actorId: string, limit = 50): Promise<SocialPublishJob[]> {
    return this.repository.listJobs(actorId, Math.max(1, Math.min(100, limit)));
  }

  async cancel(jobId: string, actorId: string): Promise<SocialPublishJob> {
    const job = await this.requireOwnedJob(jobId, actorId);
    if (
      job.status !== 'prepared' &&
      !(job.status === 'processing' && job.finalPublishAttemptedTimeUtc === null)
    ) {
      return publicJob(job);
    }
    return publicJob(
      await this.update(job, actorId, {
        status: 'cancelled',
        nextAdvanceTimeUtc: null,
        reasonCode: 'CANCELLED_BY_USER',
        message: '已由用户取消'
      })
    );
  }

  private async recordPublishFailure(
    job: SocialPublishJobRecord,
    destination: MetaPublishingDestination,
    actorId: string,
    error: unknown
  ): Promise<SocialPublishJobRecord> {
    const resolved =
      error instanceof MetaPublisherError
        ? error
        : new MetaPublisherError('META_PUBLISH_FAILED', 'Meta 发布失败', true, null, null);
    if (resolved.tokenInvalid) {
      await this.metaSocial.markConnectionReconnectRequired(destination.destination.connectionId);
    }
    return this.update(job, actorId, {
      status: resolved.ambiguous ? 'unknown' : 'failed',
      platformRequestId: resolved.platformRequestId,
      platformTraceId: resolved.platformTraceId,
      nextAdvanceTimeUtc: null,
      reasonCode: resolved.code,
      message: resolved.message
    });
  }

  private async readCaption(job: SocialPublishJobRecord): Promise<string> {
    return this.cipher.decrypt('publish-caption', job.id, {
      ciphertext: job.encryptedCaption,
      initializationVector: job.captionInitializationVector,
      keyVersion: 1
    });
  }

  private instagramImageUrl(assetId: string, destination: MetaPublishingDestination): Promise<string> {
    const origin = new URL(destination.publicOrigin);
    if (origin.protocol !== 'https:') {
      throw new SocialPublishingServiceError(
        'SOCIAL_PUBLIC_ORIGIN_REQUIRED',
        'Instagram 真实发布需要可公开访问的 HTTPS 后端地址',
        409
      );
    }
    return this.mediaAssets.issuePublicUrl({
      assetId,
      publicOrigin: destination.publicOrigin,
      apiPrefix: destination.apiPrefix
    });
  }

  private async requireOwnedJob(id: string, actorId: string): Promise<SocialPublishJobRecord> {
    const job = await this.repository.findJob(id);
    if (job?.creatorId !== actorId) {
      throw new SocialPublishingServiceError('SOCIAL_PUBLISH_JOB_NOT_FOUND', '发布任务不存在', 404);
    }
    return job;
  }

  private sameIdempotentJob(
    existing: SocialPublishJobRecord,
    fingerprint: string,
    actorId: string
  ): SocialPublishJob {
    if (existing.creatorId !== actorId || existing.requestFingerprint !== fingerprint) {
      throw new SocialPublishingServiceError(
        'IDEMPOTENCY_KEY_CONFLICT',
        'idempotencyKey 已被不同的发布内容使用',
        409
      );
    }
    return publicJob(existing);
  }

  private async expire(job: SocialPublishJobRecord, actorId: string): Promise<SocialPublishJob> {
    return publicJob(
      await this.update(job, actorId, {
        status: 'expired',
        nextAdvanceTimeUtc: null,
        reasonCode: 'SOCIAL_PUBLISH_JOB_EXPIRED',
        message: '发布任务和临时图片已过期'
      })
    );
  }

  private async update(
    job: SocialPublishJobRecord,
    actorId: string,
    patch: Partial<
      Pick<
        SocialPublishJobRecord,
        | 'status'
        | 'platformContainerId'
        | 'platformPostId'
        | 'platformRequestId'
        | 'platformTraceId'
        | 'publishAttemptedTimeUtc'
        | 'finalPublishAttemptedTimeUtc'
        | 'nextAdvanceTimeUtc'
        | 'reasonCode'
        | 'message'
      >
    >
  ): Promise<SocialPublishJobRecord> {
    const updated = await this.repository.updateJob({
      id: job.id,
      expectedRevision: job.revision,
      status: patch.status ?? job.status,
      platformContainerId: patch.platformContainerId ?? job.platformContainerId,
      platformPostId: patch.platformPostId ?? job.platformPostId,
      platformRequestId: patch.platformRequestId ?? job.platformRequestId,
      platformTraceId: patch.platformTraceId ?? job.platformTraceId,
      publishAttemptedTimeUtc: patch.publishAttemptedTimeUtc ?? job.publishAttemptedTimeUtc,
      finalPublishAttemptedTimeUtc: patch.finalPublishAttemptedTimeUtc ?? job.finalPublishAttemptedTimeUtc,
      nextAdvanceTimeUtc:
        'nextAdvanceTimeUtc' in patch ? (patch.nextAdvanceTimeUtc ?? null) : job.nextAdvanceTimeUtc,
      reasonCode: 'reasonCode' in patch ? (patch.reasonCode ?? null) : job.reasonCode,
      message: 'message' in patch ? (patch.message ?? null) : job.message,
      actorId,
      now: this.clock()
    });
    if (!updated) {
      throw new SocialPublishingServiceError(
        'ENTITY_VERSION_CONFLICT',
        '发布任务已被其他请求更新，请刷新后重试',
        409
      );
    }
    return updated;
  }
}

function normalizeCaption(value: string): string {
  return value.replaceAll('\r\n', '\n').trim();
}

function assertCaptionLength(caption: string, platform: SocialPublishJob['platform']): void {
  const length = Array.from(caption).length;
  const maximum = platform === 'instagram' ? 2200 : 4000;
  if (length > maximum) {
    throw new SocialPublishingServiceError(
      'SOCIAL_CAPTION_TOO_LONG',
      `${platform === 'instagram' ? 'Instagram' : 'Facebook'} 文案不能超过 ${maximum} 个字符`,
      400
    );
  }
}

async function requestFingerprint(input: SocialPostPrepareRequest, caption: string): Promise<string> {
  const fileHash = await sha256(input.file.contentBase64);
  return sha256(
    JSON.stringify({
      destinationId: input.destinationId,
      caption,
      fileName: input.file.fileName.trim(),
      contentType: input.file.contentType,
      byteLength: input.file.byteLength,
      fileHash
    })
  );
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
