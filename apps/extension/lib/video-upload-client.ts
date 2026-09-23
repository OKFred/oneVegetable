import { browser } from 'wxt/browser';
import { GatewayException } from '@one-vegetable/core/errors';
import {
  validateVideoUploadResult,
  type VideoUploadControl,
  type VideoUploadResult
} from '@one-vegetable/core/video-upload';

export const requestVideoUpload: VideoUploadControl['videoUpload'] = async (command, context, id) => {
  const requestId = id ?? crypto.randomUUID();
  const response: unknown = await browser.runtime.sendMessage({
    kind: 'video-upload-request',
    requestId,
    context,
    command
  });
  if (
    !response ||
    typeof response !== 'object' ||
    !('requestId' in response) ||
    response.requestId !== requestId ||
    !('ok' in response)
  )
    throw new GatewayException(
      { code: 'VIDEO_UPLOAD_RESPONSE_INVALID', message: 'VIDEO_UPLOAD_RESPONSE_INVALID', retryable: false },
      requestId
    );
  if (response.ok !== true) {
    const error = 'error' in response ? response.error : null;
    const code =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'VIDEO_UPLOAD_FAILED';
    const subCode =
      code === 'S3_REQUEST_FAILED' &&
      error &&
      typeof error === 'object' &&
      'subCode' in error &&
      typeof error.subCode === 'string' &&
      /^HTTP_\d{3}:[A-Za-z]{1,50}$/u.test(error.subCode)
        ? error.subCode
        : undefined;
    throw new GatewayException(
      { code, message: code, retryable: false, ...(subCode ? { subCode } : {}) },
      requestId
    );
  }
  if (!('data' in response) || !validateVideoUploadResult(response.data))
    throw new GatewayException(
      { code: 'VIDEO_UPLOAD_RESPONSE_INVALID', message: 'VIDEO_UPLOAD_RESPONSE_INVALID', retryable: false },
      requestId
    );
  return response.data as VideoUploadResult;
};
