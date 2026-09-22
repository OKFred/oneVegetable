import { AlibabaClient, GatewayException, isRequestId, type GatewaySettings } from '@one-vegetable/core';
import {
  galleryGatewayId,
  opaqueGalleryId,
  assertGalleryContextId
} from '@one-vegetable/core/gallery-transfer-context';
import {
  validateCapabilityRequest,
  validateCapabilityResponse
} from '@one-vegetable/core/capability-validation-worker';
import { VideoUploadService } from '@one-vegetable/core/video-upload-service';
import { VideoUploadError, videoUploadFail } from '@one-vegetable/core/video-upload';
import {
  createVideoUploadPlatform,
  isVideoUploadRuntimeEnabled
} from '@one-vegetable/core/video-upload-platform';
import { ExtensionVideoUploadRepository } from './video-upload-repository';
import type { ExtensionS3Service } from './s3-service';

export async function handleVideoUpload(
  value: unknown,
  trusted: boolean,
  s3: Pick<ExtensionS3Service, 'contextId' | 'videoClient'>,
  loadSettings: () => Promise<GatewaySettings>
): Promise<unknown> {
  let requestId: string = crypto.randomUUID();
  try {
    if (!trusted) videoUploadFail('VIDEO_UNTRUSTED_SENDER');
    if (
      !value ||
      typeof value !== 'object' ||
      !('requestId' in value) ||
      !isRequestId(value.requestId) ||
      !('context' in value) ||
      !('command' in value)
    )
      videoUploadFail('INVALID_REQUEST_ID');
    requestId = value.requestId;
    const ownerId = 'extension:local-admin';
    const service = new VideoUploadService(new ExtensionVideoUploadRepository(), async (expected, id) => {
      const settings = await loadSettings();
      const actual = {
        identity: await opaqueGalleryId(ownerId),
        gateway: await galleryGatewayId(settings),
        storage: await s3.contextId()
      };
      for (const field of ['identity', 'gateway', 'storage'] as const)
        assertGalleryContextId(expected[field], actual[field]);
      return {
        context: actual,
        storage: expected.storage === null ? null : await s3.videoClient(expected.storage),
        platform: createVideoUploadPlatform(
          AlibabaClient.create(settings, { maxAttempts: 1, requestId: id }),
          validateCapabilityRequest,
          validateCapabilityResponse
        ),
        enabled: isVideoUploadRuntimeEnabled({ runtime: 'extension', environment: 'extension' })
      };
    });
    const data = await service.execute(ownerId, {
      requestId,
      context: value.context,
      command: value.command
    });
    return { requestId, ok: true, data };
  } catch (error) {
    const code =
      error instanceof VideoUploadError
        ? error.code
        : error instanceof GatewayException
          ? error.gatewayError.code
          : 'VIDEO_UPLOAD_FAILED';
    return { requestId, ok: false, error: { code, message: code, retryable: false } };
  }
}
