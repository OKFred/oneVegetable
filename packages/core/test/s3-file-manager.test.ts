import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/s3-file-manager.json';
import r2 from '../../../mock/data/s3-r2-file-manager.json';
import { S3ObjectStorageClient, validS3FileKey, type S3StorageConfiguration } from '../src/s3-storage';
import type { NetworkTransport } from '../src/network';

const config: S3StorageConfiguration = {
  endpoint: 'https://s3.example.test',
  bucket: 'test-files',
  region: 'us-east-1',
  accessKeyId: 'fixture-key',
  secretAccessKey: 'fixture-secret',
  sessionToken: null,
  pathStyle: true,
  rootPrefix: 'root'
};
function url(input: RequestInfo | URL | undefined) {
  if (!input) throw new Error('Missing captured request');
  return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
}
describe('S3 file manager directory and create-only operations', () => {
  it.each(['auto', 'us-east-1'])(
    'uses R2 directory pagination with the configured %s signing region',
    async (region) => {
      const send = vi.fn<NetworkTransport['send']>().mockResolvedValue(new Response(fixture.directory));
      const client = new S3ObjectStorageClient({ ...r2.configuration, region }, { send });
      await expect(
        client.listObjects({ prefix: 'assets/', delimiter: '/', continuationToken: 'r2-opaque-cursor' })
      ).resolves.toMatchObject({
        items: [{ key: 'assets/hello.txt' }],
        prefixes: ['assets/images/'],
        nextContinuationToken: 'second-page'
      });
      const captured = send.mock.calls[0];
      if (!captured) throw new Error('Missing R2 request');
      const target = url(captured[0]);
      expect(target.origin).toBe(r2.configuration.endpoint);
      expect(target.pathname).toBe('/file-manager-test');
      expect(target.searchParams.get('continuation-token')).toBe('r2-opaque-cursor');
      expect(target.searchParams.get('delimiter')).toBe('/');
      const headers = new Headers(captured[1].headers);
      expect(headers.get('authorization')).toContain('/' + region + '/s3/aws4_request');
      expect(headers.has('x-amz-acl')).toBe(false);
      expect(headers.has('x-amz-expected-bucket-owner')).toBe(false);
    }
  );
  it('uses R2 conditional folder creation and byte readback without an SDK or public URL', async () => {
    const send = vi
      .fn<NetworkTransport['send']>()
      .mockResolvedValueOnce(new Response('', { headers: { etag: '"folder"' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array()))
      .mockResolvedValueOnce(new Response(fixture.collision, { status: 412 }));
    const client = new S3ObjectStorageClient(r2.configuration, { send });
    const input = {
      key: 'assets/new/',
      bytes: new Uint8Array(),
      contentType: 'application/x-directory',
      directory: true,
      createOnly: true
    };
    await client.putObject(input);
    expect((await client.getObject(input.key)).bytes).toHaveLength(0);
    await expect(client.putObject(input)).rejects.toMatchObject({
      gatewayError: { subCode: 'HTTP_412:PreconditionFailed', retryable: false }
    });
    expect(send).toHaveBeenCalledTimes(3);
    for (const [target, init] of send.mock.calls) {
      expect(url(target).origin).toBe(r2.configuration.endpoint);
      expect(url(target).pathname).toBe('/file-manager-test/root/assets/new/');
      expect(url(target).search).toBe('');
      if (init.method === 'PUT') expect(new Headers(init.headers).get('if-none-match')).toBe('*');
    }
  });
  it('signs delimiter and opaque page token, preserves folder boundaries and skips the current marker', async () => {
    const send = vi.fn<NetworkTransport['send']>().mockResolvedValue(new Response(fixture.directory));
    const result = await new S3ObjectStorageClient(config, { send }).listObjects({
      prefix: 'assets/',
      delimiter: '/',
      maximum: 100,
      continuationToken: 'first-page'
    });
    expect(result).toEqual({
      items: [
        {
          key: 'assets/hello.txt',
          size: 5,
          etag: 'one',
          lastModifiedTimeUtc: Date.parse('2026-11-05T00:00:00Z')
        }
      ],
      prefixes: ['assets/images/'],
      nextContinuationToken: 'second-page'
    });
    const request = url(send.mock.calls[0]?.[0]);
    expect(request.searchParams.get('prefix')).toBe('root/assets/');
    expect(request.searchParams.get('delimiter')).toBe('/');
    expect(request.searchParams.get('continuation-token')).toBe('first-page');
    expect(send).toHaveBeenCalledOnce();
  });
  it.each([
    'wrongScope',
    'deepFile',
    'missingToken',
    'missingStatus',
    'duplicate',
    'malformed',
    'unsafeXml'
  ] as const)('does not interpret %s as an empty directory', async (kind) => {
    const send = vi.fn<NetworkTransport['send']>().mockResolvedValue(new Response(fixture[kind]));
    await expect(
      new S3ObjectStorageClient(config, { send }).listObjects({ prefix: 'assets/', delimiter: '/' })
    ).rejects.toThrow();
    expect(send).toHaveBeenCalledOnce();
  });
  it('rejects repeated continuation tokens without fetching further pages', async () => {
    const send = vi.fn<NetworkTransport['send']>().mockResolvedValue(new Response(fixture.directory));
    await expect(
      new S3ObjectStorageClient(config, { send }).listObjects({
        prefix: 'assets/',
        delimiter: '/',
        continuationToken: 'second-page'
      })
    ).rejects.toThrow('S3_RESPONSE_INVALID');
    expect(send).toHaveBeenCalledOnce();
  });
  it('preserves a trailing slash when creating and reading back an empty folder', async () => {
    const send = vi
      .fn<NetworkTransport['send']>()
      .mockImplementation(() =>
        Promise.resolve(new Response(new Uint8Array(), { headers: { etag: '"created"' } }))
      );
    const client = new S3ObjectStorageClient(config, { send });
    await client.putObject({
      key: 'assets/new/',
      bytes: new Uint8Array(),
      contentType: 'application/x-directory',
      directory: true,
      createOnly: true
    });
    const read = await client.getObject('assets/new/');
    expect(read.bytes).toHaveLength(0);
    for (const [input] of send.mock.calls) expect(url(input).pathname).toBe('/test-files/root/assets/new/');
    const first = send.mock.calls[0];
    if (!first) throw new Error('Missing PUT');
    expect(new Headers(first[1].headers).get('If-None-Match')).toBe('*');
  });
  it('reports a collision and never retries or overwrites', async () => {
    const send = vi
      .fn<NetworkTransport['send']>()
      .mockResolvedValue(new Response(fixture.collision, { status: 412 }));
    await expect(
      new S3ObjectStorageClient(config, { send }).putObject({
        key: 'assets/existing.txt',
        bytes: new TextEncoder().encode('new'),
        contentType: 'text/plain',
        createOnly: true
      })
    ).rejects.toMatchObject({
      gatewayError: { code: 'S3_REQUEST_FAILED', subCode: 'HTTP_412:PreconditionFailed', retryable: false }
    });
    expect(send).toHaveBeenCalledOnce();
  });
  it('does not retry an unknown PUT result', async () => {
    const send = vi.fn<NetworkTransport['send']>().mockRejectedValue(new Error('Connection interrupted'));
    await expect(
      new S3ObjectStorageClient(config, { send }).putObject({
        key: 'assets/new.txt',
        bytes: new Uint8Array([1]),
        contentType: 'application/octet-stream',
        createOnly: true
      })
    ).rejects.toThrow();
    expect(send).toHaveBeenCalledOnce();
  });
  it.each(['../escape', 'a/../b', '/root', 'a//b', 'a\\b', ' a', 'a ', 'a/\u0000b', 'a/.'])(
    'rejects ambiguous create paths: %j',
    async (key) => {
      const send = vi.fn<NetworkTransport['send']>();
      expect(validS3FileKey(key)).toBe(false);
      await expect(
        new S3ObjectStorageClient(config, { send }).putObject({
          key,
          bytes: new Uint8Array(),
          contentType: 'text/plain',
          createOnly: true
        })
      ).rejects.toThrow('S3_FILE_PATH_INVALID');
      expect(send).not.toHaveBeenCalled();
    }
  );
  it('checks directory semantics, UTF-8 key length and content type before dispatch', async () => {
    const send = vi.fn<NetworkTransport['send']>(),
      client = new S3ObjectStorageClient(config, { send });
    for (const input of [
      { key: 'a/', directory: true, createOnly: false, bytes: new Uint8Array() },
      { key: 'a/', directory: true, createOnly: true, bytes: new Uint8Array([1]) },
      { key: 'a/', directory: false, createOnly: true, bytes: new Uint8Array() },
      { key: 'a'.repeat(1021), createOnly: true, bytes: new Uint8Array() }
    ])
      await expect(client.putObject({ ...input, contentType: 'text/plain' })).rejects.toThrow();
    await expect(
      client.putObject({
        key: 'a',
        bytes: new Uint8Array(),
        createOnly: true,
        contentType: 'text/plain\r\nPrivate: value'
      })
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
