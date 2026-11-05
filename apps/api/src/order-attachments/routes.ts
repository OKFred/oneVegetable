import { AlibabaClient, GatewayException, isRequestId } from '@one-vegetable/core';
import { isAccountVerifiedIopMethod } from '@one-vegetable/core/alibaba-iop-business';
import {
  galleryGatewayId,
  galleryStorageId,
  opaqueGalleryId
} from '@one-vegetable/core/gallery-transfer-context';
import {
  ORDER_ATTACHMENT_METHOD,
  OrderAttachmentError,
  OrderAttachmentService,
  orderAttachmentFail,
  orderAttachmentSelection,
  parseOrderAttachmentRequest,
  type OrderAttachmentRepository
} from '@one-vegetable/core/order-attachments';
import { uploadOrderAttachmentPlatform } from '@one-vegetable/core/order-attachment-platform';
import { bodyLimit } from 'hono/body-limit';
import type { Hono } from 'hono';
import { authenticateMutation } from '../auth/routes';
import { AuthError, type AuthService } from '../auth/service';
import { authorizeAdmin, type OperationFeatureFlags } from '../abac';
import { GatewayConfigurationError, type AsyncAlibabaCredentialProvider } from '../gateway/credentials';
import type { S3StorageConfigurationService } from '../storage/s3-configuration';
import { markRequestOperation } from '../observability/request-context';

export interface OrderAttachmentRouteOptions {
  repository: OrderAttachmentRepository;
  credentials: AsyncAlibabaCredentialProvider;
  auth: AuthService;
  storage?: S3StorageConfigurationService;
  flags: OperationFeatureFlags;
  allowedOrigins?: readonly string[];
}
export function registerOrderAttachmentRoutes(api: Hono, options: OrderAttachmentRouteOptions): void {
  for (const action of ['upload', 'get'] as const)
    api.post(
      `/order-attachments/${action}`,
      bodyLimit({
        maxSize: 10 * 1024 * 1024,
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
            raw = await context.req.json();
          } catch {
            throw new AuthError('INVALID_JSON', 'INVALID_JSON', 400);
          }
          if (
            !raw ||
            typeof raw !== 'object' ||
            Array.isArray(raw) ||
            !('requestId' in raw) ||
            !isRequestId(raw.requestId)
          )
            throw new AuthError('INVALID_REQUEST_ID', 'INVALID_REQUEST_ID', 400);
          requestId = raw.requestId;
          if ('action' in raw) orderAttachmentFail('REQUEST_CONTRACT_INVALID');
          const request = parseOrderAttachmentRequest({ ...raw, action });
          const session = await authenticateMutation(context, {
            authService: options.auth,
            ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {})
          });
          const decision = authorizeAdmin(session.principal, action === 'get' ? 'admin.read' : 'admin.write');
          if (!decision.allowed) throw new AuthError(decision.reasonCode, decision.reasonCode, 403);
          const ownerId = session.principal.actorId;
          markRequestOperation(context.req.raw, `order-attachment.${action}`);
          const stored =
            request.action === 'get' ? await options.repository.get(request.jobId, ownerId) : null;
          const expected = request.action === 'upload' ? request.context : stored?.context;
          const fileName = request.action === 'upload' ? request.file.fileName : stored?.receipt.fileName;
          if (!expected || fileName === undefined) orderAttachmentFail('ORDER_ATTACHMENT_NOT_FOUND');
          const selection = orderAttachmentSelection(fileName);
          const flag = 'method:' + ORDER_ATTACHMENT_METHOD;
          const enabled =
            isAccountVerifiedIopMethod(ORDER_ATTACHMENT_METHOD) && options.flags.isEnabled(flag);
          if (request.action === 'upload' && !enabled)
            orderAttachmentFail('ORDER_ATTACHMENT_UPLOAD_DISABLED');
          // Metadata-only get: never refresh a token, construct an upload client, or call the provider.
          let protocol: 'top' | 'iop';
          let gateway: string;
          let send: ConstructorParameters<typeof OrderAttachmentService>[1]['send'] = () =>
            orderAttachmentFail('ORDER_ATTACHMENT_READ_ONLY');
          if (request.action === 'get') {
            if (options.credentials.selectProtocol) {
              protocol = await options.credentials.selectProtocol(selection.operation, selection.payload, {
                galleryContext: expected
              });
              gateway = expected.gateway;
            } else {
              const snapshot = await options.credentials.credentialSnapshot?.();
              if (!snapshot) orderAttachmentFail('GALLERY_CONTEXT_UNAVAILABLE');
              protocol = snapshot.protocol ?? 'top';
              gateway = await galleryGatewayId(snapshot);
            }
          } else {
            if (!options.credentials.resolveForOperation) orderAttachmentFail('GALLERY_CONTEXT_UNAVAILABLE');
            const credentials = await options.credentials.resolveForOperation(
              selection.operation,
              selection.payload,
              { galleryContext: expected, requestId }
            );
            protocol = credentials.protocol ?? 'top';
            gateway = await galleryGatewayId(credentials);
            const client = AlibabaClient.create(credentials, { maxAttempts: 1, requestId });
            send = (file) => uploadOrderAttachmentPlatform(client, file);
          }
          if (protocol !== 'iop') orderAttachmentFail('ALIBABA_IOP_AUTHORIZATION_REQUIRED');
          const configuration = options.storage
            ? await options.storage.requireConfiguration().catch((error: unknown) => {
                if (error instanceof GatewayConfigurationError && error.code === 'S3_STORAGE_NOT_CONFIGURED')
                  return null;
                throw error;
              })
            : null;
          const service = new OrderAttachmentService(options.repository, {
            ownerId,
            protocol,
            enabled,
            send,
            context: {
              identity: await opaqueGalleryId(ownerId),
              gateway,
              storage: configuration ? await galleryStorageId(configuration) : null
            }
          });
          const data =
            request.action === 'upload' ? await service.upload(request) : await service.get(request);
          if (request.action === 'upload')
            await options.auth.audit({
              requestId,
              actorId: ownerId,
              action: 'order-attachment.upload',
              resourceKind: 'order-attachment-job',
              resourceId: data.jobId,
              outcome: 'success',
              reasonCode: data.status
            });
          context.header('X-Request-ID', requestId);
          context.header('Cache-Control', 'no-store');
          return context.json({ requestId, ok: true, data });
        } catch (error) {
          const code =
            error instanceof OrderAttachmentError ||
            error instanceof AuthError ||
            error instanceof GatewayConfigurationError
              ? error.code
              : error instanceof GatewayException &&
                  [
                    'GALLERY_CONTEXT_CHANGED',
                    'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
                    'ALIBABA_AUTHORIZATION_BINDING_CHANGED'
                  ].includes(error.gatewayError.code)
                ? error.gatewayError.code
                : 'ORDER_ATTACHMENT_FAILED';
          const status =
            error instanceof AuthError
              ? error.status
              : code === 'ORDER_ATTACHMENT_NOT_FOUND'
                ? 404
                : ['ORDER_ATTACHMENT_UPLOAD_DISABLED', 'ALIBABA_IOP_AUTHORIZATION_REQUIRED'].includes(code)
                  ? 403
                  : [
                        'GALLERY_CONTEXT_CHANGED',
                        'ORDER_ATTACHMENT_REQUEST_CONFLICT',
                        'ORDER_ATTACHMENT_UPLOAD_PENDING'
                      ].includes(code)
                    ? 409
                    : 400;
          context.header('X-Request-ID', requestId);
          context.header('Cache-Control', 'no-store');
          return context.json(
            { requestId, ok: false, error: { code, message: code, retryable: false } },
            status as 400
          );
        }
      }
    );
}
