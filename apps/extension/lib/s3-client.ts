import { browser } from 'wxt/browser';
import { decodeBase64, encodeBase64, GatewayException } from '@one-vegetable/core/runtime';
import {
  s3PermissionOrigins,
  S3_MAX_OBJECT_BYTES,
  type S3StorageControl,
  type S3RequestOptions
} from '@one-vegetable/core/s3-storage';
import { validS3Output, type S3MessageMap, type S3Operation } from './s3-protocol';
import { requestVideoUpload } from './video-upload-client';

export async function requestS3<T extends S3Operation>(
  operation: T,
  payload: S3MessageMap[T]['input'],
  options?: S3RequestOptions
): Promise<S3MessageMap[T]['output']> {
  const requestId = options?.requestId ?? crypto.randomUUID();
  const response: unknown = await browser.runtime.sendMessage({
    kind: 's3-storage-request',
    requestId,
    operation,
    ...(options?.galleryContext ? { galleryContext: options.galleryContext } : {}),
    ...(options?.storageContext ? { storageContext: options.storageContext } : {}),
    payload
  });
  if (
    typeof response !== 'object' ||
    response === null ||
    !('requestId' in response) ||
    response.requestId !== requestId ||
    !('ok' in response)
  )
    throw new GatewayException(
      { code: 'S3_RESPONSE_INVALID', message: 'S3_RESPONSE_INVALID', retryable: false },
      requestId
    );
  if (response.ok !== true) {
    const error = 'error' in response ? response.error : null;
    throw new GatewayException(
      {
        code:
          typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
            ? error.code
            : 'S3_STORAGE_FAILED',
        message: 'S3_STORAGE_FAILED',
        retryable: false
      },
      requestId
    );
  }
  if (!('data' in response) || !validS3Output(operation, response.data))
    throw new GatewayException(
      { code: 'S3_RESPONSE_INVALID', message: 'S3_RESPONSE_INVALID', retryable: false },
      requestId
    );
  return response.data as S3MessageMap[T]['output'];
}

export const extensionS3Storage: S3StorageControl = {
  videoUpload: requestVideoUpload,
  s3StorageConfiguration: () => requestS3('summary', {}),
  async updateS3StorageConfiguration(configuration, revision, remark = null) {
    // Request immediately in the original Save gesture, before any runtime round trip.
    if (!(await browser.permissions.request({ origins: s3PermissionOrigins(configuration) })))
      throw new GatewayException({
        code: 'S3_PERMISSION_REQUIRED',
        message: 'S3_PERMISSION_REQUIRED',
        retryable: false
      });
    return requestS3('save', { configuration, revision, remark });
  },
  async clearS3StorageConfiguration(revision) {
    await requestS3('clear', { revision });
  },
  testS3StorageConnection: () => requestS3('test', {}),
  listS3Objects: (input = {}, options) => requestS3('list', input, options),
  async getS3Object(key, options) {
    const result = await requestS3('get', { key }, options);
    const bytes = decodeBase64(result.contentBase64);
    if (
      result.key !== key ||
      bytes.byteLength !== result.byteLength ||
      bytes.byteLength > S3_MAX_OBJECT_BYTES
    )
      throw new GatewayException({
        code: 'S3_RESPONSE_INVALID',
        message: 'S3_RESPONSE_INVALID',
        retryable: false
      });
    return { key: result.key, bytes, contentType: result.contentType, etag: result.etag };
  },
  async putS3Object({ key, bytes, contentType, createOnly, directory }, options) {
    if (bytes.byteLength > S3_MAX_OBJECT_BYTES)
      throw new GatewayException({
        code: 'S3_OBJECT_TOO_LARGE',
        message: 'S3_OBJECT_TOO_LARGE',
        retryable: false
      });
    return requestS3(
      'put',
      {
        key,
        contentBase64: encodeBase64(bytes),
        contentType,
        ...(createOnly === undefined ? {} : { createOnly }),
        ...(directory === undefined ? {} : { directory })
      },
      options
    );
  }
};
