import { browser } from 'wxt/browser';
import type { GalleryRequestOptions } from '@one-vegetable/core/gallery-transfer-context';
import { decodeBase64, encodeBase64, GatewayException } from '@one-vegetable/core/runtime';
import { s3PermissionOrigins, type S3StorageControl } from '@one-vegetable/core/s3-storage';
import { validS3Output, type S3MessageMap, type S3Operation } from './s3-protocol';

export async function requestS3<T extends S3Operation>(
  operation: T,
  payload: S3MessageMap[T]['input'],
  options?: GalleryRequestOptions
): Promise<S3MessageMap[T]['output']> {
  const requestId = options?.requestId ?? crypto.randomUUID();
  const response: unknown = await browser.runtime.sendMessage({
    kind: 's3-storage-request',
    requestId,
    operation,
    ...(options?.galleryContext ? { galleryContext: options.galleryContext } : {}),
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
    if (bytes.byteLength !== result.byteLength || bytes.byteLength > 5 * 1024 * 1024)
      throw new GatewayException({
        code: 'S3_RESPONSE_INVALID',
        message: 'S3_RESPONSE_INVALID',
        retryable: false
      });
    return { key: result.key, bytes, contentType: result.contentType, etag: result.etag };
  },
  putS3Object: ({ key, bytes, contentType }, options) =>
    requestS3('put', { key, contentBase64: encodeBase64(bytes), contentType }, options)
};
