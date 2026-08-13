import { describe, expect, it, vi } from 'vitest';

import { BffControlClient } from '../src/control-client';

import type { NetworkTransport } from '../src/network';

describe('BffControlClient', () => {
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
});

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
