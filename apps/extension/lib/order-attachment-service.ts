import { AlibabaClient, GatewayException, isRequestId, type GatewaySettings } from '@one-vegetable/core';
import { isAccountVerifiedIopMethod } from '@one-vegetable/core/alibaba-iop-business';
import { galleryGatewayId, opaqueGalleryId } from '@one-vegetable/core/gallery-transfer-context';
import type { GalleryTransferContext } from '@one-vegetable/core/gallery-transfer-task';
import {
  ORDER_ATTACHMENT_METHOD,
  OrderAttachmentError,
  OrderAttachmentService,
  orderAttachmentFail,
  orderAttachmentSelection,
  parseOrderAttachmentRequest
} from '@one-vegetable/core/order-attachments';
import { uploadOrderAttachmentPlatform } from '@one-vegetable/core/order-attachment-platform';
import { ExtensionOrderAttachmentRepository } from './order-attachment-repository';

export interface ExtensionOrderAttachmentOptions {
  /** Local vault/settings only, including for get: must not refresh or perform network requests. */
  loadSettings(
    selection: ReturnType<typeof orderAttachmentSelection>,
    expected: GalleryTransferContext
  ): Promise<GatewaySettings>;
  contextId(): Promise<string | null>;
  /** Can further disable an accepted method (e.g. emergency pause); cannot bypass registry acceptance. */
  methodEnabled?(): boolean;
}
export async function handleOrderAttachment(
  value: unknown,
  trusted: boolean,
  options: ExtensionOrderAttachmentOptions
): Promise<unknown> {
  let requestId: string = crypto.randomUUID();
  try {
    if (!trusted) orderAttachmentFail('ORDER_ATTACHMENT_UNTRUSTED_SENDER');
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('requestId' in value) ||
      !isRequestId(value.requestId)
    )
      orderAttachmentFail('REQUEST_CONTRACT_INVALID');
    requestId = value.requestId;
    const { kind: _kind, ...raw } = value as Record<string, unknown>;
    const request = parseOrderAttachmentRequest(raw);
    const ownerId = 'extension:local-admin';
    const repository = new ExtensionOrderAttachmentRepository();
    const stored = request.action === 'get' ? await repository.get(request.jobId, ownerId) : null;
    const expected = request.action === 'upload' ? request.context : stored?.context;
    const fileName = request.action === 'upload' ? request.file.fileName : stored?.receipt.fileName;
    if (!expected || fileName === undefined) orderAttachmentFail('ORDER_ATTACHMENT_NOT_FOUND');
    const enabled =
      isAccountVerifiedIopMethod(ORDER_ATTACHMENT_METHOD) && (options.methodEnabled?.() ?? true);
    if (request.action === 'upload' && !enabled) orderAttachmentFail('ORDER_ATTACHMENT_UPLOAD_DISABLED');
    const settings = await options.loadSettings(orderAttachmentSelection(fileName), expected);
    if (settings.protocol !== 'iop') orderAttachmentFail('ALIBABA_IOP_AUTHORIZATION_REQUIRED');
    const actual = {
      identity: await opaqueGalleryId(ownerId),
      gateway: await galleryGatewayId(settings),
      storage: await options.contextId()
    };
    const client =
      request.action === 'upload' ? AlibabaClient.create(settings, { maxAttempts: 1, requestId }) : null;
    const service = new OrderAttachmentService(repository, {
      ownerId,
      context: actual,
      protocol: 'iop',
      enabled,
      send: (file) =>
        client
          ? uploadOrderAttachmentPlatform(client, file)
          : Promise.reject(new Error('ORDER_ATTACHMENT_READ_ONLY'))
    });
    const data = request.action === 'upload' ? await service.upload(request) : await service.get(request);
    return { requestId, ok: true, data };
  } catch (error) {
    const code =
      error instanceof OrderAttachmentError
        ? error.code
        : error instanceof GatewayException &&
            ['GALLERY_CONTEXT_CHANGED', 'ALIBABA_IOP_AUTHORIZATION_REQUIRED'].includes(
              error.gatewayError.code
            )
          ? error.gatewayError.code
          : 'ORDER_ATTACHMENT_FAILED';
    return { requestId, ok: false, error: { code, message: code, retryable: false } };
  }
}
