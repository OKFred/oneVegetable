import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/extension-s3.json';
import { parseS3StorageConfiguration } from '@one-vegetable/core/s3-storage';
import { validS3Output } from '../lib/s3-protocol';

const mocks = vi.hoisted(() => ({ send: vi.fn(), permission: vi.fn() }));
vi.mock('wxt/browser', () => ({
  browser: { runtime: { sendMessage: mocks.send }, permissions: { request: mocks.permission } }
}));
import { extensionS3Storage, requestS3 } from '../lib/s3-client';
const configuration = parseS3StorageConfiguration(fixture.configuration);
beforeEach(() => {
  vi.clearAllMocks();
});
describe('extension S3 client', () => {
  it('requests only the exact host during save and sends no credentials if denied', async () => {
    mocks.permission.mockResolvedValue(false);
    await expect(extensionS3Storage.updateS3StorageConfiguration(configuration, null)).rejects.toMatchObject({
      gatewayError: { code: 'S3_PERMISSION_REQUIRED' }
    });
    expect(mocks.permission).toHaveBeenCalledWith({ origins: ['https://storage.example.com/*'] });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('rejects mismatched requestIds and malformed successful responses', async () => {
    mocks.send.mockResolvedValue({ requestId: crypto.randomUUID(), ok: true, data: {} });
    await expect(requestS3('summary', {})).rejects.toMatchObject({
      gatewayError: { code: 'S3_RESPONSE_INVALID' }
    });
    mocks.send.mockImplementation((message: { requestId: string }) =>
      Promise.resolve({ requestId: message.requestId, ok: true, data: { items: [{}] } })
    );
    await expect(requestS3('list', {})).rejects.toMatchObject({
      gatewayError: { code: 'S3_RESPONSE_INVALID' }
    });
  });
  it('keeps requestId on errors, never retries writes, and checks binary length', async () => {
    mocks.send.mockImplementation((message: { requestId: string }) =>
      Promise.resolve({ requestId: message.requestId, ok: false, error: { code: 'S3_STORAGE_FAILED' } })
    );
    await expect(
      extensionS3Storage.putS3Object({
        key: 'image.png',
        bytes: new Uint8Array(fixture.bytes),
        contentType: 'image/png'
      })
    ).rejects.toMatchObject({
      gatewayError: { code: 'S3_STORAGE_FAILED', retryable: false },
      requestId: expect.any(String) as unknown
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    mocks.send.mockImplementation((message: { requestId: string }) =>
      Promise.resolve({
        requestId: message.requestId,
        ok: true,
        data: {
          key: 'image.png',
          contentBase64: 'AQIDBA==',
          byteLength: 9,
          contentType: 'image/png',
          etag: null
        }
      })
    );
    await expect(extensionS3Storage.getS3Object('image.png')).rejects.toMatchObject({
      gatewayError: { code: 'S3_RESPONSE_INVALID' }
    });
  });
  it('validates nullable fields, limits and arrays without unsafe narrowing', () => {
    expect(validS3Output('clear', null)).toBe(true);
    expect(validS3Output('clear', {})).toBe(false);
    expect(validS3Output('test', { connected: true, visibleObjectCount: -1 })).toBe(false);
    expect(validS3Output('list', { items: [], nextContinuationToken: null })).toBe(true);
    expect(
      validS3Output('get', {
        key: 'image.png',
        contentBase64: 'AQIDBA==',
        byteLength: 6 * 1024 * 1024,
        contentType: 'image/png',
        etag: null
      })
    ).toBe(false);
  });
});
