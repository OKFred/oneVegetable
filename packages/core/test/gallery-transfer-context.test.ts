import { describe, expect, it } from 'vitest';
import {
  galleryGatewayId,
  galleryStorageId,
  assertGalleryContextId,
  requireGalleryContext
} from '../src/gallery-transfer-context';
import fixture from '../../../mock/data/extension-s3.json';
import { parseS3StorageConfiguration } from '../src/s3-storage';

describe('opaque gallery execution context', () => {
  it('keeps normal bundle token refresh stable but rejects a new account bundle', async () => {
    const credentials = {
      endpoint: 'https://eco.taobao.com/router/rest',
      appKey: 'test',
      appSecret: 'secret',
      accessToken: 'first',
      signMethod: 'hmac' as const,
      galleryAccountGeneration: 'bundle-1'
    };
    const first = await galleryGatewayId(credentials);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(await galleryGatewayId({ ...credentials, accessToken: 'refreshed' })).toBe(first);
    expect(await galleryGatewayId({ ...credentials, galleryAccountGeneration: 'bundle-2' })).not.toBe(first);
    expect(await galleryGatewayId({ ...credentials, appSecret: 'new-secret' })).not.toBe(first);
  });
  it('pins endpoint, bucket, prefix and credentials without returning them', async () => {
    const config = parseS3StorageConfiguration(fixture.configuration);
    const id = await galleryStorageId(config);
    expect(id).toMatch(/^[a-f0-9]{64}$/u);
    expect(id).not.toContain(config.accessKeyId);
    expect(await galleryStorageId({ ...config, rootPrefix: 'other' })).not.toBe(id);
    expect(() => {
      assertGalleryContextId(id, 'changed');
    }).toThrow('GALLERY_CONTEXT_CHANGED');
    expect(() => {
      assertGalleryContextId(undefined, id);
    }).not.toThrow();
  });
  it('rejects extra fields and invalid context input', () => {
    expect(() =>
      requireGalleryContext({ identity: 'a', gateway: 'b', storage: null, token: 'secret' })
    ).toThrow();
    expect(() => requireGalleryContext(null)).toThrow();
  });
});
