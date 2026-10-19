import { describe, expect, it, vi } from 'vitest';
import type { NetworkTransport } from '@one-vegetable/core/network';
import { parseAlibabaTokenResponse } from '@one-vegetable/core/credential-bundle';
import { TopAuthorizationTokenClient } from '../lib/top-authorization-token-client';
import credential from '../../../mock/data/node-gateway-credentials.json';
import tokens from '../../../mock/data/alibaba-auth/iop-token-responses.json';

function setup() {
  const send = vi.fn<NetworkTransport['send']>();
  const client = new TopAuthorizationTokenClient({ send });
  const input = {
    appKey: credential.oauthBundle.application.appKey,
    appSecret: credential.oauthBundle.application.appSecret,
    value: tokens.success.refresh_token,
    requestId: crypto.randomUUID(),
    redirectUri: credential.oauthBundle.application.callbackUrl
  };
  return { send, client, input };
}

describe('standalone TOP token client through NetworkManager', () => {
  it.each(['/auth/token/create', '/auth/token/refresh'] as const)(
    'sends exactly one protocol-specific form for %s with native transport safeguards',
    async (path) => {
      const test = setup();
      test.send.mockResolvedValue(Response.json(tokens.success));

      await expect(test.client.request(path, test.input)).resolves.toEqual(
        parseAlibabaTokenResponse(tokens.success)
      );

      expect(test.send).toHaveBeenCalledOnce();
      const call = test.send.mock.calls[0];
      const url = call?.[0];
      const init = call?.[1] ?? {};
      expect(url).toBeInstanceOf(URL);
      const href = url instanceof URL ? url.href : '';
      expect(href).toBe('https://oauth.alibaba.com/token');
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'omit',
        redirect: 'manual',
        cache: 'no-store'
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const headers = new Headers(init.headers);
      expect(headers.get('X-Request-ID')).toBe(test.input.requestId);
      expect(headers.get('Content-Type')).toBe('application/x-www-form-urlencoded;charset=utf-8');
      expect(headers.has('Cookie')).toBe(false);
      expect(headers.has('Authorization')).toBe(false);
      expect(Object.fromEntries(new URLSearchParams(init.body as URLSearchParams))).toEqual({
        client_id: test.input.appKey,
        client_secret: test.input.appSecret,
        sp: 'icbu',
        grant_type: path === '/auth/token/create' ? 'authorization_code' : 'refresh_token',
        [path === '/auth/token/create' ? 'code' : 'refresh_token']: test.input.value,
        ...(path === '/auth/token/create' ? { redirect_uri: test.input.redirectUri } : {})
      });
      expect(new URL(href).search).toBe('');
    }
  );

  it('rejects missing create callback and invalid requestId before sending', async () => {
    const test = setup();
    const { redirectUri: _callback, ...input } = test.input;
    await expect(test.client.request('/auth/token/create', input)).rejects.toMatchObject({
      requestId: input.requestId,
      gatewayError: { code: 'AUTH_INPUT_INVALID', retryable: false }
    });
    await expect(
      test.client.request('/auth/token/refresh', { ...input, requestId: 'not-a-uuid\n' })
    ).rejects.toMatchObject({ gatewayError: { code: 'INVALID_REQUEST_ID' } });
    expect(test.send).not.toHaveBeenCalled();
  });

  it.each(['error', 'error_response'] as const)(
    'redacts a definitive %s rejection and never retries it',
    async (key) => {
      const test = setup();
      test.send.mockResolvedValue(
        Response.json(
          key === 'error'
            ? { error: test.input.appSecret, error_description: test.input.value }
            : { error_response: { msg: test.input.appSecret, sub_msg: test.input.value } },
          { status: 400 }
        )
      );
      const error: unknown = await test.client
        .request('/auth/token/refresh', test.input)
        .catch((e: unknown) => e);
      expect(error).toMatchObject({
        requestId: test.input.requestId,
        gatewayError: { code: 'TOP_TOKEN_REJECTED', message: 'TOP_TOKEN_REJECTED', retryable: false }
      });
      expect(JSON.stringify(error)).not.toContain(test.input.appSecret);
      expect(JSON.stringify(error)).not.toContain(test.input.value);
      expect(test.send).toHaveBeenCalledOnce();
    }
  );

  it.each(['malformed', 'array', 'missing-token', 'http-error', 'server-error'] as const)(
    'keeps an unexplained %s response unknown without replaying the token mutation',
    async (kind) => {
      const test = setup();
      const response =
        kind === 'malformed'
          ? new Response(test.input.appSecret)
          : kind === 'array'
            ? Response.json([])
            : kind === 'missing-token'
              ? Response.json({ message: test.input.value })
              : kind === 'http-error'
                ? Response.json(tokens.success, { status: 403 })
                : Response.json({ error: test.input.appSecret }, { status: 503 });
      test.send.mockResolvedValue(response);

      await expect(test.client.request('/auth/token/refresh', test.input)).rejects.toMatchObject({
        requestId: test.input.requestId,
        gatewayError: {
          code: 'TOP_TOKEN_RESULT_UNKNOWN',
          message: 'TOP_TOKEN_RESULT_UNKNOWN',
          retryable: false
        }
      });
      expect(test.send).toHaveBeenCalledOnce();
    }
  );

  it.each(['network', 'timeout'] as const)('does not retry a transport %s failure', async (kind) => {
    const test = setup();
    test.send.mockRejectedValue(
      kind === 'timeout'
        ? new DOMException('Request timed out', 'TimeoutError')
        : new TypeError('connection lost')
    );
    await expect(test.client.request('/auth/token/refresh', test.input)).rejects.toMatchObject({
      requestId: test.input.requestId,
      gatewayError: { code: kind === 'timeout' ? 'REQUEST_TIMEOUT' : 'GATEWAY_ERROR' }
    });
    expect(test.send).toHaveBeenCalledOnce();
  });

  it('refuses redirects rather than forwarding a secret to a second origin', async () => {
    const test = setup();
    test.send.mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: 'https://example.com/token' } })
    );
    await expect(test.client.request('/auth/token/refresh', test.input)).rejects.toMatchObject({
      gatewayError: { code: 'NETWORK_REDIRECT_DENIED', retryable: false }
    });
    expect(test.send).toHaveBeenCalledOnce();
  });
});
