import { request } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { parseAlibabaOpenApiCredentialBundle } from '../../packages/core/src/alibaba-credential-bundle';
import fixture from '../../mock/data/node-gateway-credentials.json';
import { startReconnectServer } from './reconnect-server';

async function harness(fail = false) {
  const exchange = vi.fn(() =>
    fail
      ? Promise.reject(new Error('sensitive provider body'))
      : Promise.resolve({
          accessToken: fixture.manual.accessToken,
          refreshToken: null,
          expiresInSeconds: 3600,
          refreshExpiresInSeconds: null
        })
  );
  const save = vi.fn(() => Promise.resolve());
  const server = await startReconnectServer({
    bundle: parseAlibabaOpenApiCredentialBundle(fixture.oauthBundle),
    timeoutMilliseconds: 30_000,
    exchange,
    save
  });
  const api = await request.newContext({ baseURL: server.origin });
  const page = await api.get('/');
  const html = await page.text();
  const state = /name="state" value="([^"]+)"/.exec(html)?.[1];
  if (!state) throw new Error('missing state');
  const form = { state, callback: `https://example.com/callback?code=one-time&state=${state}` };
  return {
    exchange,
    save,
    server,
    api,
    html,
    page,
    form,
    close: async () => {
      server.close();
      await api.dispose();
      await server.closed;
    }
  };
}
describe('local manual reauthorization', () => {
  it('exposes no secrets and rejects cross-origin, wrong callback and wrong state before exchange', async () => {
    const h = await harness();
    try {
      expect(h.html).not.toContain(fixture.manual.appSecret);
      expect(h.page.headers()['referrer-policy']).toBe('same-origin');
      expect(
        (
          await h.api.post('/complete', { form: h.form, headers: { Origin: 'https://evil.example' } })
        ).status()
      ).toBe(403);
      for (const callback of [
        'https://example.com/wrong?code=x&state=' + h.form.state,
        'https://example.com/callback?code=x&state=wrong'
      ]) {
        expect(
          (
            await h.api.post('/complete', {
              form: { ...h.form, callback },
              headers: { Origin: h.server.origin }
            })
          ).status()
        ).toBe(400);
      }
      expect(h.exchange).not.toHaveBeenCalled();
      expect(h.save).not.toHaveBeenCalled();
      expect(
        (await h.api.post('/complete', { form: h.form, headers: { Origin: h.server.origin } })).status()
      ).toBe(200);
      expect(h.exchange).toHaveBeenCalledOnce();
      expect(h.save).toHaveBeenCalledOnce();
      expect(JSON.stringify(h.save.mock.calls)).not.toContain('one-time');
    } finally {
      await h.close();
    }
  });
  it('does not retry or overwrite the old bundle after an ambiguous token exchange', async () => {
    const h = await harness(true);
    try {
      const first = await h.api.post('/complete', { form: h.form, headers: { Origin: h.server.origin } });
      expect(first.status()).toBe(400);
      expect(await first.text()).not.toContain('sensitive');
      expect(
        (await h.api.post('/complete', { form: h.form, headers: { Origin: h.server.origin } })).status()
      ).toBe(409);
      expect(h.exchange).toHaveBeenCalledOnce();
      expect(h.save).not.toHaveBeenCalled();
    } finally {
      await h.close();
    }
  });
});
