import { describe, expect, it } from 'vitest';
import { AlibabaIopTokenClient, signIopRequest } from '../src/alibaba-iop';
import signature from '../../../mock/data/alibaba-auth/iop-signature.json';
import tokens from '../../../mock/data/alibaba-auth/iop-token-responses.json';
import { parseAlibabaOpenApiCredentialBundle } from '../src/alibaba-credential-bundle';
import credential from '../../../mock/data/node-gateway-credentials.json';

describe('browser-safe IOP signing and token transport', () => {
  it('matches the published GOP signature vector', async () => {
    expect(
      await signIopRequest(signature.path as '/auth/token/create', signature.parameters, signature.secret)
    ).toBe(signature.signature);
  });
  it('uses only the IOP endpoint, one attempt, no session and no cookies', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = new AlibabaIopTokenClient({
      send(input, init) {
        calls.push({
          url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
          init
        });
        return Promise.resolve(Response.json(tokens.success));
      }
    });
    const result = await client.request('/auth/token/refresh', {
      appKey: 'own-app',
      appSecret: 'own-secret',
      value: 'own-refresh',
      requestId: crypto.randomUUID()
    });
    expect(result.accessToken).toBe(tokens.success.access_token);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://openapi-api.alibaba.com/rest/auth/token/refresh');
    expect(calls[0]?.init.credentials).toBe('omit');
    expect(calls[0]?.init.body instanceof URLSearchParams ? calls[0].init.body.toString() : '').not.toContain(
      'session='
    );
  });
  it('does not leak provider bodies or retry ambiguous responses', async () => {
    let count = 0;
    const client = new AlibabaIopTokenClient({
      send() {
        count++;
        return Promise.resolve(new Response('secret-value'));
      }
    });
    await expect(
      client.request('/auth/token/create', {
        appKey: 'own-app',
        appSecret: 'own-secret',
        value: 'secret-code',
        requestId: crypto.randomUUID()
      })
    ).rejects.toThrow('IOP_TOKEN_RESULT_UNKNOWN');
    expect(count).toBe(1);
  });
  it('preserves explicit protocol and rejects an unknown protocol', () => {
    const bundle = credential.oauthBundle;
    expect(parseAlibabaOpenApiCredentialBundle({ ...bundle, protocol: 'iop' }).protocol).toBe('iop');
    expect(() => parseAlibabaOpenApiCredentialBundle({ ...bundle, protocol: 'guessed' })).toThrow();
  });
  it.each([{}, { access_token: 'ambiguous-token' }, { code: 0 }])(
    'keeps ambiguous responses unknown',
    async (body) => {
      const client = new AlibabaIopTokenClient({ send: () => Promise.resolve(Response.json(body)) });
      await expect(
        client.request('/auth/token/refresh', {
          appKey: 'own',
          appSecret: 'own',
          value: 'own',
          requestId: crypto.randomUUID()
        })
      ).rejects.toThrow('IOP_TOKEN_RESULT_UNKNOWN');
    }
  );
});
