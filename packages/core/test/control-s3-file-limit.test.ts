import { describe, expect, it, vi } from 'vitest';
import { BffControlClient } from '../src/control-client';
import type { NetworkTransport } from '../src/network';

const limit = 5_000_000;
const options = { storageContext: 'a'.repeat(64) };
function control(size = limit) {
  const contentBase64 = Buffer.alloc(size, 42).toString('base64');
  const send = vi.fn<NetworkTransport['send']>((input, init) => {
    const path = (
      typeof input === 'string' ? new URL(input) : input instanceof URL ? input : new URL(input.url)
    ).pathname;
    if (typeof init.body !== 'string') throw new Error('Expected JSON');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject(options);
    expect(init.credentials).toBe('include');
    expect(init.redirect).toBe('manual');
    expect(init.cache).toBe('no-store');
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('fixture-csrf');
    if (path.endsWith('/put')) expect(body.createOnly).toBe(true);
    const data = path.endsWith('/get')
      ? {
          key: body.key,
          contentBase64,
          byteLength: size,
          contentType: 'application/octet-stream',
          etag: null
        }
      : { key: body.key, etag: null };
    return Promise.resolve(Response.json({ requestId: body.requestId, ok: true, data }));
  });
  return {
    send,
    client: new BffControlClient({
      baseUrl: 'https://workbench.example.test',
      csrfToken: () => 'fixture-csrf',
      transport: { send }
    })
  };
}
describe('isolated BFF file-manager size budget', () => {
  it('round-trips an exact 5 MB file', async () => {
    const { client, send } = control();
    const bytes = new Uint8Array(limit).fill(42);
    await expect(
      client.putS3Object(
        { key: 'fixture.bin', bytes, contentType: 'application/octet-stream', createOnly: true },
        options
      )
    ).resolves.toEqual({ key: 'fixture.bin', etag: null });
    const result = await client.getS3Object('fixture.bin', options);
    expect(Buffer.from(result.bytes).equals(Buffer.from(bytes))).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it.each([undefined, { storageContext: options.storageContext }])(
    'enforces 5 MB with and without a context: %s',
    async (scope) => {
      const { client, send } = control();
      await expect(
        client.putS3Object(
          {
            key: 'fixture.bin',
            bytes: new Uint8Array(limit + 1),
            contentType: 'application/octet-stream'
          },
          scope
        )
      ).rejects.toMatchObject({ gatewayError: { code: 'S3_OBJECT_TOO_LARGE' } });
      expect(send).not.toHaveBeenCalled();
    }
  );
  it('rejects 5 MB + 1 before sending a write', async () => {
    const { client, send } = control();
    await expect(
      client.putS3Object(
        { key: 'fixture.bin', bytes: new Uint8Array(limit + 1), contentType: 'application/octet-stream' },
        options
      )
    ).rejects.toMatchObject({ gatewayError: { code: 'S3_OBJECT_TOO_LARGE' } });
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects an oversized read without retrying', async () => {
    const { client, send } = control(limit + 1);
    await expect(client.getS3Object('fixture.bin', options)).rejects.toMatchObject({
      gatewayError: { code: 'S3_OBJECT_TOO_LARGE' }
    });
    expect(send).toHaveBeenCalledOnce();
  });
});
