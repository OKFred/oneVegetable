import { describe, expect, it, vi } from 'vitest';

import { S3ObjectStorageClient, type S3StorageConfiguration } from '../src/s3-storage';
import type { NetworkTransport } from '../src/network';

const configuration: S3StorageConfiguration = {
  endpoint: 'https://account.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'one-vegetable-gallery',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
  sessionToken: null,
  pathStyle: true,
  rootPrefix: 'imports/gallery'
};

describe('S3ObjectStorageClient', () => {
  it('signs and parses a bounded object listing through NetworkManager', async () => {
    const send = vi
      .fn()
      .mockResolvedValue(
        new Response(
          '<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated>' +
            '<Contents><Key>imports/gallery/coats/front.jpg</Key><LastModified>2026-09-08T01:02:03.000Z</LastModified>' +
            '<ETag>"abc123"</ETag><Size>1024</Size></Contents>' +
            '<NextContinuationToken>next-page</NextContinuationToken></ListBucketResult>',
          { status: 200, headers: { 'content-type': 'application/xml' } }
        )
      );
    const transport: NetworkTransport = { send };
    const client = new S3ObjectStorageClient(configuration, transport);

    const page = await client.listObjects({ prefix: 'coats', maximum: 10 });

    expect(page).toEqual({
      items: [
        {
          key: 'coats/front.jpg',
          size: 1024,
          etag: 'abc123',
          lastModifiedTimeUtc: Date.parse('2026-09-08T01:02:03.000Z')
        }
      ],
      nextContinuationToken: 'next-page'
    });
    const [url, init] = send.mock.calls[0] as [RequestInfo | URL, RequestInit];
    const requestUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    expect(requestUrl).toContain('/one-vegetable-gallery?');
    expect(requestUrl).toContain('prefix=imports%2Fgallery%2Fcoats');
    expect(new Headers(init.headers).get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /u);
  });

  it('rejects unsafe endpoints and object paths before transport', async () => {
    expect(() => new S3ObjectStorageClient({ ...configuration, endpoint: 'http://localhost:9000' })).toThrow(
      /HTTPS/u
    );
    const send = vi.fn();
    const client = new S3ObjectStorageClient(configuration, { send });

    await expect(client.getObject('../secret')).rejects.toThrow(/路径/u);
    expect(send).not.toHaveBeenCalled();
  });
});
