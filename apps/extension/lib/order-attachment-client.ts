import { browser } from 'wxt/browser';
import { GatewayException } from '@one-vegetable/core/errors';
import type { OrderAttachmentControl } from '@one-vegetable/core/order-attachments';

export const extensionOrderAttachments: OrderAttachmentControl = {
  upload: (input) => call('upload', input, input.requestId),
  get: (input) => call('get', input, input.jobId)
};
async function call(action: 'upload' | 'get', input: { requestId: string }, jobId: string) {
  const { isOrderAttachmentReceipt } = await import('@one-vegetable/core/order-attachments');
  const response: unknown = await browser.runtime.sendMessage({
    kind: 'order-attachment-request',
    action,
    ...input
  });
  if (
    !response ||
    typeof response !== 'object' ||
    !('requestId' in response) ||
    response.requestId !== input.requestId ||
    !('ok' in response)
  )
    return invalid(input.requestId);
  if (response.ok !== true) {
    const error = 'error' in response ? response.error : null;
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^(?:ORDER_ATTACHMENT_[A-Z_]+|GALLERY_CONTEXT_[A-Z_]+|ALIBABA_IOP_AUTHORIZATION_REQUIRED|REQUEST_CONTRACT_INVALID)$/u.test(
        error.code
      )
        ? error.code
        : 'ORDER_ATTACHMENT_FAILED';
    throw new GatewayException({ code, message: code, retryable: false }, input.requestId);
  }
  if (!('data' in response) || !isOrderAttachmentReceipt(response.data) || response.data.jobId !== jobId)
    return invalid(input.requestId);
  return response.data;
}
function invalid(requestId: string): never {
  throw new GatewayException(
    {
      code: 'ORDER_ATTACHMENT_RESPONSE_INVALID',
      message: 'ORDER_ATTACHMENT_RESPONSE_INVALID',
      retryable: false
    },
    requestId
  );
}
