import { AwsV4Signer } from 'aws4fetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/video/upload.json';
import type { NetworkTransport } from '../src/network';
import { S3ObjectStorageClient } from '../src/s3-storage';

const maximum = 50 * 1024 * 1024;
const key = 'onevegetable/video-staging/offline/source.mp4';
beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('LIVE_NETWORK_FORBIDDEN');
  });
});
afterEach(() => vi.unstubAllGlobals());

function metadata(total = '7203235', body = new Uint8Array([0])) {
  return new Response(body, {
    status: 206,
    headers: { 'Content-Range': `bytes 0-0/${total}`, ETag: '"fixture-etag"' }
  });
}
function client(reply: Response) {
  const send = vi.fn<NetworkTransport['send']>().mockResolvedValue(reply);
  return { send, storage: new S3ObjectStorageClient(fixture.configuration, { send }) };
}

describe('video metadata signed one-byte GET', () => {
  it.each(['https://oss-s3.this-time.com', 'https://oss-s3.app.fred.wiki'])(
    'signs the actual GET method and original origin at %s',
    async (endpoint) => {
      const configuration = { ...fixture.configuration, endpoint };
      const send = vi.fn<NetworkTransport['send']>().mockResolvedValue(metadata());
      const storage = new S3ObjectStorageClient(configuration, { send });
      await expect(storage.headVideoObject(key, crypto.randomUUID())).resolves.toEqual({
        size: 7203235,
        etag: 'fixture-etag'
      });
      const call = send.mock.calls[0];
      if (!call) throw new Error('MISSING_OFFLINE_CALL');
      const [input, init] = call;
      const url = input instanceof Request ? input.url : input.toString();
      const headers = new Headers(init.headers);
      const datetime = headers.get('x-amz-date');
      if (!datetime) throw new Error('MISSING_SIGNING_DATE');
      const signing = {
        url,
        headers: { Range: 'bytes=0-0' },
        datetime,
        accessKeyId: configuration.accessKeyId,
        secretAccessKey: configuration.secretAccessKey,
        service: 's3',
        region: configuration.region
      };
      expect(init.method).toBe('GET');
      expect(headers.get('range')).toBe('bytes=0-0');
      expect(headers.get('x-amz-content-sha256')).toBe('UNSIGNED-PAYLOAD');
      expect(headers.get('authorization')).toBe(
        await new AwsV4Signer({ ...signing, method: 'GET' }).authHeader()
      );
      expect(headers.get('authorization')).not.toBe(
        await new AwsV4Signer({ ...signing, method: 'HEAD' }).authHeader()
      );
      expect(new URL(url).origin).toBe(endpoint);
      expect(init.body).toBeUndefined();
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('manual');
      expect(init.cache).toBe('no-store');
      expect(send).toHaveBeenCalledTimes(1);
    }
  );

  it.each([1, maximum])('accepts bounded total %i, not the one-byte Content-Length', async (size) => {
    const response = metadata(String(size));
    response.headers.set('Content-Length', '1');
    const f = client(response);
    await expect(f.storage.headVideoObject(key, crypto.randomUUID())).resolves.toMatchObject({ size });
    expect(f.send).toHaveBeenCalledOnce();
  });

  it.each([
    '',
    'bytes 0-0/0',
    'bytes 0-0/01',
    `bytes 0-0/${maximum + 1}`,
    'bytes 0-0/9007199254740992',
    'bytes 0-0/*',
    'bytes 1-1/3',
    'bytes 0-1/3',
    'bytes */3',
    'bytes 0-0/1.5',
    'bytes 0-0/1e3',
    'bytes 0-0/3, bytes 0-0/3'
  ])('rejects invalid Content-Range %s without fallback', async (range) => {
    const response = metadata();
    response.headers.set('Content-Range', range);
    const f = client(response);
    await expect(f.storage.headVideoObject(key, crypto.randomUUID())).rejects.toThrow(
      'S3_RANGE_RESPONSE_INVALID'
    );
    expect(f.send).toHaveBeenCalledOnce();
  });

  it.each([0, 2])('rejects a %i-byte body', async (size) => {
    const f = client(metadata('3', new Uint8Array(size)));
    await expect(f.storage.headVideoObject(key, crypto.randomUUID())).rejects.toThrow(
      'S3_RANGE_RESPONSE_INVALID'
    );
    expect(f.send).toHaveBeenCalledOnce();
  });

  it('does not accept a 200 response even with a valid range header and one byte', async () => {
    const f = client(new Response(new Uint8Array([0]), { headers: { 'Content-Range': 'bytes 0-0/3' } }));
    await expect(f.storage.headVideoObject(key, crypto.randomUUID())).rejects.toThrow(
      'S3_RANGE_RESPONSE_INVALID'
    );
    expect(f.send).toHaveBeenCalledOnce();
  });

  it('returns null only for a 404; a 403 fails with safe status and no fallback', async () => {
    const absent = client(new Response(null, { status: 404 }));
    await expect(absent.storage.headVideoObject(key, crypto.randomUUID())).resolves.toBeNull();
    expect(absent.send).toHaveBeenCalledOnce();
    const denied = client(new Response('<html>PRIVATE provider content</html>', { status: 403 }));
    await expect(denied.storage.headVideoObject(key, crypto.randomUUID())).rejects.toMatchObject({
      gatewayError: { code: 'S3_REQUEST_FAILED', subCode: 'HTTP_403:UnknownProviderError', retryable: false }
    });
    expect(denied.send).toHaveBeenCalledOnce();
  });

  it.each(['declared', 'streamed'])('caps %s metadata/error bodies at 64 KiB', async (mode) => {
    const response = new Response(new Uint8Array(65_537), {
      status: 200,
      headers: mode === 'declared' ? { 'Content-Length': '65537' } : {}
    });
    const f = client(response);
    await expect(f.storage.headVideoObject(key, crypto.randomUUID())).rejects.toMatchObject({
      gatewayError: { code: 'NETWORK_RESPONSE_TOO_LARGE' }
    });
    expect(f.send).toHaveBeenCalledOnce();
  });
});
