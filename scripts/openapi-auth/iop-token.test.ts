import { describe, expect, it, vi } from 'vitest';
import fixture from '../../mock/data/alibaba-auth/iop-signature.json';
import responses from '../../mock/data/alibaba-auth/iop-token-responses.json';
import { createIopToken, signIopParameters } from './iop-token';

describe('IOP token signature', () => {
  it('matches the official path-prefixed HMAC-SHA256 example, excluding an existing sign', () => {
    expect(signIopParameters('/auth/token/create', fixture.parameters, fixture.secret)).toBe(
      fixture.signature
    );
    expect(
      signIopParameters('/auth/token/create', { sign: 'ignored', ...fixture.parameters }, fixture.secret)
    ).toBe(fixture.signature);
    expect(signIopParameters('/auth/token/refresh', fixture.parameters, fixture.secret)).not.toBe(
      fixture.signature
    );
  });
});

describe('IOP token exchange', () => {
  const input = { appKey: 'fixture-app', appSecret: 'fixture-secret', code: 'fixture-code' };
  it('uses the documented endpoint and signature, parses lifetimes and sends no access token', async () => {
    const send = vi.fn((_url: RequestInfo | URL, _init: RequestInit) =>
      Promise.resolve(Response.json(responses.success))
    );
    expect(await createIopToken(input, { transport: { send }, clock: () => 1_700_000_000_000 })).toEqual({
      accessToken: responses.success.access_token,
      refreshToken: responses.success.refresh_token,
      expiresInSeconds: 3600,
      refreshExpiresInSeconds: 7200
    });
    expect(send).toHaveBeenCalledOnce();
    const call = send.mock.calls[0];
    if (!call) throw new Error('Missing token request');
    const [url, init] = call;
    expect(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).toBe(
      'https://openapi-api.alibaba.com/rest/auth/token/create'
    );
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(URLSearchParams);
    const parameters = init.body as URLSearchParams;
    expect(parameters.get('timestamp')).toBe('1700000000000');
    expect(parameters.get('sign_method')).toBe('sha256');
    expect(parameters.has('access_token')).toBe(false);
    expect(parameters.get('sign')).toBe(
      signIopParameters('/auth/token/create', Object.fromEntries(parameters), input.appSecret)
    );
  });
  it.each([responses.invalidAppKey, responses.missingSuccess])(
    'rejects HTTP 200 without explicit success, without retry',
    async (body) => {
      const send = vi.fn(() => Promise.resolve(Response.json(body)));
      await expect(createIopToken(input, { transport: { send } })).rejects.toMatchObject({
        code: 'ALIBABA_TOKEN_REFRESH_FAILED'
      });
      expect(send).toHaveBeenCalledOnce();
    }
  );
});
