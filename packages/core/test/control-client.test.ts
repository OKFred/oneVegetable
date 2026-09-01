import { describe, expect, it, vi } from 'vitest';

import { BffControlClient } from '../src/control-client';
import { GatewayException } from '../src/errors';

import type { NetworkTransport } from '../src/network';

describe('BffControlClient', () => {
  it('reads the public backend mode without turning it into a mock fallback', async () => {
    const send = vi.fn<NetworkTransport['send']>((input, init) => {
      const url =
        input instanceof URL ? input : typeof input === 'string' ? new URL(input) : new URL(input.url);
      expect(url.pathname).toBe('/api/v1/meta/get');
      if (typeof init.body !== 'string') throw new Error('expected JSON body');
      const body = JSON.parse(init.body) as { requestId: string };
      return Promise.resolve(
        Response.json({
          requestId: body.requestId,
          ok: true,
          data: {
            runtime: 'node',
            database: 'sqlite',
            environment: 'local-node',
            gatewayMode: 'real',
            apiPrefix: '/api/v1',
            version: '2.0.1'
          }
        })
      );
    });
    const client = new BffControlClient({
      baseUrl: 'https://staging.example.com',
      transport: { send }
    });

    await expect(client.backendMeta()).resolves.toMatchObject({ gatewayMode: 'real' });
  });

  it('reads local administrator bootstrap availability through a POST body', async () => {
    const send = vi.fn<NetworkTransport['send']>((input, init) => {
      const url =
        input instanceof URL ? input : typeof input === 'string' ? new URL(input) : new URL(input.url);
      expect(url.pathname).toBe('/api/v1/auth/bootstrap/status/get');
      if (typeof init.body !== 'string') throw new Error('expected JSON body');
      const body = JSON.parse(init.body) as { requestId: string };
      return Promise.resolve(
        Response.json({
          requestId: body.requestId,
          ok: true,
          data: {
            initialized: true,
            bootstrapTokenConfigured: true,
            bootstrapAvailable: false
          }
        })
      );
    });
    const client = new BffControlClient({
      baseUrl: 'https://staging.example.com',
      transport: { send }
    });

    await expect(client.bootstrapStatus()).resolves.toEqual({
      initialized: true,
      bootstrapTokenConfigured: true,
      bootstrapAvailable: false
    });
  });

  it('uses JSON POST bodies and keeps the login CSRF token for later mutations', async () => {
    const send = vi.fn<NetworkTransport['send']>((input, init) => {
      const url =
        input instanceof URL ? input : typeof input === 'string' ? new URL(input) : new URL(input.url);
      if (typeof init.body !== 'string') throw new Error('expected JSON body');
      const body = JSON.parse(init.body) as { requestId: string; username?: string };
      expect(new Headers(init.headers).get('X-Request-ID')).toBe(body.requestId);
      if (url.pathname.endsWith('/auth/login')) {
        expect(body).toMatchObject({ username: 'admin' });
        return Promise.resolve(
          Response.json({
            requestId: body.requestId,
            ok: true,
            data: {
              user: userFixture(),
              session: {
                principal: { actorId: 'user-1', username: 'admin', role: 'admin', source: 'bff' },
                csrfToken: 'csrf-from-login',
                absoluteExpiresTimeUtc: 10_000,
                idleExpiresTimeUtc: 5_000
              }
            }
          })
        );
      }
      expect(url.pathname).toBe('/api/v1/admin/users/list');
      expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('csrf-from-login');
      return Promise.resolve(
        Response.json({
          requestId: body.requestId,
          ok: true,
          data: { items: [userFixture()], total: 1 }
        })
      );
    });
    const client = new BffControlClient({
      baseUrl: 'https://staging.example.com',
      transport: { send }
    });

    await expect(client.login('admin', 'correct-password-value')).resolves.toMatchObject({
      principal: { role: 'admin' },
      user: { username: 'admin' }
    });
    await expect(client.listUsers()).resolves.toMatchObject({ total: 1 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not accept a control response with a mismatched requestId', async () => {
    const client = new BffControlClient({
      baseUrl: 'https://staging.example.com',
      transport: {
        send: () => Promise.resolve(Response.json({ requestId: crypto.randomUUID(), ok: true, data: {} }))
      }
    });
    await expect(client.session()).rejects.toThrow('requestId');
  });

  it('preserves the control requestId on authentication errors', async () => {
    const client = new BffControlClient({
      baseUrl: 'https://staging.example.com',
      transport: {
        send: (_input, init) => {
          if (typeof init.body !== 'string') throw new Error('expected JSON body');
          const body = JSON.parse(init.body) as { requestId: string };
          return Promise.resolve(
            Response.json({
              requestId: body.requestId,
              ok: false,
              error: { code: 'AUTH_INVALID', message: '账号或密码错误', retryable: false }
            })
          );
        }
      }
    });

    try {
      await client.login('admin', 'wrong-password-value');
      throw new Error('expected the login request to fail');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(GatewayException);
      if (!(error instanceof GatewayException)) throw error;
      expect(error.requestId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(error.gatewayError.code).toBe('AUTH_INVALID');
    }
  });

  it('uses the request diagnostics routes and carries filters in the JSON body', async () => {
    const requestIdFilter = '3d7c8523-93cc-48b7-a615-a23d2976c516';
    const send = vi.fn<NetworkTransport['send']>((input, init) => {
      const url =
        input instanceof URL ? input : typeof input === 'string' ? new URL(input) : new URL(input.url);
      if (typeof init.body !== 'string') throw new Error('expected JSON body');
      const body = JSON.parse(init.body) as Record<string, unknown>;
      if (url.pathname.endsWith('/request-events/list')) {
        expect(body).toMatchObject({ requestIdFilter, page: 1, pageSize: 50 });
        return Promise.resolve(
          Response.json({ requestId: body.requestId, ok: true, data: { items: [], total: 0 } })
        );
      }
      expect(url.pathname).toBe('/api/v1/admin/request-events/purge');
      return Promise.resolve(
        Response.json({
          requestId: body.requestId,
          ok: true,
          data: { deletedCount: 2, retentionDays: 30, cutoffTimeUtc: 1 }
        })
      );
    });
    const client = new BffControlClient({
      baseUrl: 'https://staging.example.com',
      transport: { send },
      csrfToken: () => 'csrf-token'
    });

    await expect(client.listRequestEvents({ requestIdFilter })).resolves.toEqual({ items: [], total: 0 });
    await expect(client.purgeRequestEvents()).resolves.toMatchObject({ deletedCount: 2 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('uses typed POST bodies and CSRF for the Alibaba credential acquisition flow', async () => {
    const jobId = '11111111-1111-4111-8111-111111111111';
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const send = vi.fn<NetworkTransport['send']>((input, init) => {
      const url =
        input instanceof URL ? input : typeof input === 'string' ? new URL(input) : new URL(input.url);
      if (typeof init.body !== 'string') throw new Error('expected JSON body');
      const body = JSON.parse(init.body) as Record<string, unknown>;
      expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('csrf-token');
      calls.push({ path: url.pathname, body });
      const data = url.pathname.endsWith('/start')
        ? { status: 'running', jobId, expiresAtUtc: 10_000 }
        : url.pathname.endsWith('/continue')
          ? {
              status: 'callback-confirmation-required',
              jobId,
              currentUrl: 'https://old.example.com/callback',
              requestedUrl: 'https://new.example.com/callback'
            }
          : url.pathname.endsWith('/status')
            ? { status: 'running', jobId, expiresAtUtc: 10_000 }
            : {
                status: 'failed',
                error: {
                  code: 'ACQUISITION_CANCELLED',
                  message: 'cancelled',
                  retryable: false
                }
              };
      return Promise.resolve(Response.json({ requestId: body.requestId, ok: true, data }));
    });
    const client = new BffControlClient({
      baseUrl: 'https://self-hosted.example.com',
      transport: { send },
      csrfToken: () => 'csrf-token'
    });

    await client.startAlibabaCredentialAcquisition({
      account: 'website-account@example.com',
      password: 'website-password',
      callbackUrl: null
    });
    await client.continueAlibabaCredentialAcquisition(jobId, {
      type: 'select-application',
      applicationId: 'application-center:1'
    });
    await client.alibabaCredentialAcquisitionStatus(jobId);
    await client.cancelAlibabaCredentialAcquisition(jobId);

    expect(calls.map((call) => call.path)).toEqual([
      '/api/v1/admin/alibaba-credential-acquisition/start',
      '/api/v1/admin/alibaba-credential-acquisition/continue',
      '/api/v1/admin/alibaba-credential-acquisition/status',
      '/api/v1/admin/alibaba-credential-acquisition/cancel'
    ]);
    expect(calls[0]?.body).toMatchObject({
      account: 'website-account@example.com',
      password: 'website-password',
      callbackUrl: null
    });
    expect(calls[1]?.body).toMatchObject({
      jobId,
      command: { type: 'select-application', applicationId: 'application-center:1' }
    });
    expect(calls[2]?.body).toMatchObject({ jobId });
    expect(calls[3]?.body).toMatchObject({ jobId });
  });

  it('uses typed Meta and social publishing routes without exposing credentials in responses', async () => {
    const calls: { path: string; body: Record<string, unknown>; csrf: string | null }[] = [];
    const send = vi.fn<NetworkTransport['send']>((input, init) => {
      const url =
        input instanceof URL ? input : typeof input === 'string' ? new URL(input) : new URL(input.url);
      if (typeof init.body !== 'string') throw new Error('expected JSON body');
      const body = JSON.parse(init.body) as Record<string, unknown>;
      calls.push({
        path: url.pathname,
        body,
        csrf: new Headers(init.headers).get('X-CSRF-Token')
      });
      const data = url.pathname.endsWith('/destinations/list')
        ? { items: [] }
        : url.pathname.endsWith('/prepare')
          ? socialJobFixture('prepared')
          : socialJobFixture('published');
      return Promise.resolve(Response.json({ requestId: body.requestId, ok: true, data }));
    });
    const client = new BffControlClient({
      baseUrl: 'https://self-hosted.example.com',
      transport: { send },
      csrfToken: () => 'csrf-token'
    });

    await client.listSocialDestinations();
    const prepared = await client.prepareSocialPost({
      destinationId: '22222222-2222-4222-8222-222222222222',
      caption: 'A safe product image',
      idempotencyKey: '66666666-6666-4666-8666-666666666666',
      file: {
        fileName: 'product.jpg',
        contentBase64: '/9j/2Q==',
        contentType: 'image/jpeg',
        byteLength: 4
      }
    });
    await client.publishSocialPost(prepared.id);

    expect(calls.map((call) => call.path)).toEqual([
      '/api/v1/social/destinations/list',
      '/api/v1/social-posts/prepare',
      '/api/v1/social-posts/publish'
    ]);
    expect(calls.every((call) => call.csrf === 'csrf-token')).toBe(true);
    expect(calls[1]?.body).toMatchObject({
      destinationId: '22222222-2222-4222-8222-222222222222',
      idempotencyKey: '66666666-6666-4666-8666-666666666666'
    });
  });

  it('attaches the scoped extension device token and extension id to social requests', async () => {
    const send = vi.fn<NetworkTransport['send']>((_input, init) => {
      if (typeof init.body !== 'string') throw new Error('expected JSON body');
      const body = JSON.parse(init.body) as { requestId: string };
      const headers = new Headers(init.headers);
      expect(headers.get('Authorization')).toBe(`Bearer ovd_${'a'.repeat(43)}`);
      expect(headers.get('X-One-Vegetable-Extension-ID')).toBe('aepfdoldflokikbbcpnfifkacpfakmjc');
      expect(headers.get('X-CSRF-Token')).toBeNull();
      return Promise.resolve(Response.json({ requestId: body.requestId, ok: true, data: { items: [] } }));
    });
    const client = new BffControlClient({
      baseUrl: 'https://self-hosted.example.com',
      transport: { send },
      bearerToken: () => `ovd_${'a'.repeat(43)}`,
      extensionId: 'aepfdoldflokikbbcpnfifkacpfakmjc'
    });

    await expect(client.listSocialDestinations()).resolves.toEqual([]);
    expect(send).toHaveBeenCalledOnce();
  });
});

function socialJobFixture(status: 'prepared' | 'published') {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    requestId: '55555555-5555-4555-8555-555555555555',
    idempotencyKey: '66666666-6666-4666-8666-666666666666',
    destinationId: '22222222-2222-4222-8222-222222222222',
    platform: 'facebook',
    status,
    captionLength: 20,
    fileName: 'product.jpg',
    contentType: 'image/jpeg',
    byteLength: 4,
    contentSha256: 'fixture-sha256',
    platformContainerId: null,
    platformPostId: status === 'published' ? 'facebook-post-1' : null,
    platformRequestId: null,
    platformTraceId: null,
    reasonCode: null,
    message: null,
    nextAdvanceTimeUtc: null,
    expiresTimeUtc: 10_000,
    createTimeUtc: 1,
    updateTimeUtc: 1,
    creatorId: 'admin-1',
    updaterId: 'admin-1',
    revision: status === 'published' ? 2 : 1,
    remark: null
  };
}

function userFixture() {
  return {
    id: 'user-1',
    username: 'admin',
    role: 'admin',
    status: 'active',
    lockedUntilUtc: null,
    createTimeUtc: 1,
    updateTimeUtc: 1,
    creatorId: 'system:bootstrap',
    updaterId: 'system:bootstrap',
    revision: 1,
    remark: null
  } as const;
}
