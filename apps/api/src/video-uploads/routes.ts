import {
  AlibabaClient,
  GatewayException,
  isRequestId,
  validateCapabilityRequest,
  validateCapabilityResponse
} from '@one-vegetable/core';
import {
  galleryGatewayId,
  galleryStorageId,
  opaqueGalleryId,
  assertGalleryContextId
} from '@one-vegetable/core/gallery-transfer-context';
import { VideoUploadService, type VideoUploadRepository } from '@one-vegetable/core/video-upload-service';
import {
  VideoUploadError,
  validateVideoUploadRequest,
  type VideoUploadRequest
} from '@one-vegetable/core/video-upload';
import {
  createVideoUploadPlatform,
  isVideoUploadRuntimeEnabled
} from '@one-vegetable/core/video-upload-platform';
import { S3StorageError } from '@one-vegetable/core/s3-storage';
import { bodyLimit } from 'hono/body-limit';
import type { Hono } from 'hono';
import { authenticateMutation } from '../auth/routes';
import { AuthError, type AuthService } from '../auth/service';
import { authorizeAdmin, type OperationFeatureFlags } from '../abac';
import { GatewayConfigurationError, type AsyncAlibabaCredentialProvider } from '../gateway/credentials';
import type { S3StorageConfigurationService } from '../storage/s3-configuration';
import { markRequestOperation } from '../observability/request-context';

export function registerVideoUploadRoutes(
  api: Hono,
  options: {
    repository: VideoUploadRepository;
    credentials: AsyncAlibabaCredentialProvider;
    auth: AuthService;
    storage: S3StorageConfigurationService;
    flags: OperationFeatureFlags;
    runtime: 'node' | 'cloudflare';
    environment: string;
    allowedOrigins?: readonly string[];
  }
): void {
  api.post(
    '/video-uploads/call',
    bodyLimit({
      maxSize: 7 * 1024 * 1024,
      onError(context) {
        const requestId = crypto.randomUUID();
        context.header('X-Request-ID', requestId);
        context.header('Cache-Control', 'no-store');
        return context.json(
          {
            requestId,
            ok: false,
            error: { code: 'REQUEST_TOO_LARGE', message: 'REQUEST_TOO_LARGE', retryable: false }
          },
          413
        );
      }
    }),
    async (context) => {
      let requestId: string = crypto.randomUUID();
      try {
        if (!context.req.header('Content-Type')?.toLowerCase().startsWith('application/json'))
          throw new AuthError('INVALID_CONTENT_TYPE', 'INVALID_CONTENT_TYPE', 400);
        let raw: unknown;
        try {
          raw = await context.req.json<unknown>();
        } catch {
          throw new AuthError('INVALID_JSON', 'INVALID_JSON', 400);
        }
        if (!raw || typeof raw !== 'object' || !('requestId' in raw) || !isRequestId(raw.requestId))
          throw new AuthError('INVALID_REQUEST_ID', 'INVALID_REQUEST_ID', 400);
        requestId = raw.requestId;
        if (!validateVideoUploadRequest(raw))
          throw new AuthError('REQUEST_CONTRACT_INVALID', 'REQUEST_CONTRACT_INVALID', 400);
        const request = raw as VideoUploadRequest;
        const session = await authenticateMutation(context, {
          authService: options.auth,
          ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {})
        });
        const decision = authorizeAdmin(session.principal, 'admin.write');
        if (!decision.allowed) throw new AuthError(decision.reasonCode, decision.reasonCode, 403);
        const ownerId = session.principal.actorId;
        markRequestOperation(context.req.raw, `video-upload.${request.command.action}`);
        const service = new VideoUploadService(options.repository, async (expected, id) => {
          const credentials = await options.credentials.requireCredentials(id);
          // Read the real configuration even for an expected null context. Never let the caller
          // opt out of detecting an account/storage change. Client creation revalidates this context.
          const configuration = await options.storage.requireConfiguration().catch((error: unknown) => {
            if (error instanceof GatewayConfigurationError && error.code === 'S3_STORAGE_NOT_CONFIGURED')
              return null;
            throw error;
          });
          const actual = {
            identity: await opaqueGalleryId(ownerId),
            gateway: await galleryGatewayId(credentials),
            storage: configuration ? await galleryStorageId(configuration) : null
          };
          for (const field of ['identity', 'gateway', 'storage'] as const)
            assertGalleryContextId(expected[field], actual[field]);
          return {
            context: actual,
            storage: configuration ? await options.storage.createClient(undefined, actual.storage) : null,
            platform: createVideoUploadPlatform(
              AlibabaClient.create(credentials, { maxAttempts: 1, requestId: id }),
              validateCapabilityRequest,
              validateCapabilityResponse
            ),
            enabled: isVideoUploadRuntimeEnabled({
              runtime: options.runtime,
              environment: options.environment,
              localAcceptance: options.flags.isEnabled('method:alibaba.icbu.video.upload'),
              paused:
                options.flags.disabledReason?.('method:alibaba.icbu.video.upload') === 'REAL_MUTATIONS_PAUSED'
            })
          };
        });
        const result = await service.execute(ownerId, request);
        if (!['list', 'get', 'verify', 'reconcile'].includes(request.command.action))
          await options.auth.audit({
            requestId,
            actorId: ownerId,
            action: `video-upload.${request.command.action}`,
            resourceKind: 'video-upload-task',
            resourceId: result.tasks[0]?.id ?? null,
            outcome: 'success',
            reasonCode: result.tasks[0]?.status ?? 'COMPLETED'
          });
        context.header('X-Request-ID', requestId);
        context.header('Cache-Control', 'no-store');
        return context.json({ requestId, ok: true, data: result });
      } catch (error) {
        // Provider error text may echo signed URLs. Only stable project codes cross this boundary.
        const code =
          error instanceof VideoUploadError ||
          error instanceof AuthError ||
          error instanceof GatewayConfigurationError
            ? error.code
            : error instanceof GatewayException
              ? error.gatewayError.code
              : 'VIDEO_UPLOAD_FAILED';
        const status =
          error instanceof AuthError
            ? error.status
            : code === 'VIDEO_UPLOAD_DISABLED'
              ? 403
              : ['ENTITY_VERSION_CONFLICT', 'VIDEO_TASK_BUSY', 'GALLERY_CONTEXT_CHANGED'].includes(code)
                ? 409
                : 400;
        context.header('X-Request-ID', requestId);
        context.header('Cache-Control', 'no-store');
        return context.json(
          {
            requestId,
            ok: false,
            error:
              error instanceof S3StorageError ? error.gatewayError : { code, message: code, retryable: false }
          },
          status as 400
        );
      }
    }
  );
}
