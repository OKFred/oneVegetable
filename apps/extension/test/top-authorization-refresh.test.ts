import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetworkManager } from '@one-vegetable/core/network';
import { AlibabaIopTokenClient } from '@one-vegetable/core/alibaba-iop';
import type { GatewayCredentialSettings } from '@one-vegetable/core';
import {
  AUTHORIZATION_REFRESH_INTENTS_KEY,
  refreshAuthorizationProfile,
  TOP_TOKEN_ORIGIN
} from '../lib/authorization-refresh';

const profile: GatewayCredentialSettings = {
  configurationId: 'fixture-top-configuration',
  appKey: 'fixture-top-key',
  appSecret: 'fixture-top-secret',
  accessToken: 'fixture-top-access',
  refreshToken: 'fixture-top-refresh',
  endpoint: 'https://eco.taobao.com/router/rest',
  signMethod: 'hmac'
};
function fixture() {
  const values: Record<string, unknown> = {};
  const storage = {
    get: (key: string) => Promise.resolve(Object.hasOwn(values, key) ? { [key]: values[key] } : {}),
    set: (items: Record<string, unknown>) => {
      Object.assign(values, items);
      return Promise.resolve();
    }
  };
  const send = vi.fn<(url: RequestInfo | URL, init: RequestInit) => Promise<Response>>();
  const network = new NetworkManager({
    transport: { send },
    policies: {
      alibaba: {
        allowedOrigins: [TOP_TOKEN_ORIGIN],
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store'
      }
    }
  });
  const permission = vi.fn().mockResolvedValue(true);
  const commit = vi.fn<(next: GatewayCredentialSettings) => Promise<void>>().mockResolvedValue(undefined);
  const refresh = (value = profile) =>
    refreshAuthorizationProfile(value, storage, permission, commit, undefined, () => 1_000, network);
  return { values, send, permission, commit, refresh };
}
afterEach(() => vi.restoreAllMocks());
describe('TOP encrypted-profile token renewal', () => {
  it('sends the documented form once, after explicit permission and a persisted secret-free send intent', async () => {
    const test = fixture();
    const iop = vi.spyOn(AlibabaIopTokenClient.prototype, 'request');
    test.send.mockImplementation((url, init) => {
      expect(url).toMatchObject({ href: `${TOP_TOKEN_ORIGIN}/token` });
      expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
      expect(Object.fromEntries(new URLSearchParams(init.body as URLSearchParams))).toEqual({
        refresh_token: profile.refreshToken,
        grant_type: 'refresh_token',
        client_id: profile.appKey,
        client_secret: profile.appSecret,
        sp: 'icbu'
      });
      const intent = JSON.stringify(test.values);
      expect(intent).toContain('sending');
      for (const secret of [profile.appKey, profile.appSecret, profile.accessToken, profile.refreshToken])
        expect(intent).not.toContain(secret);
      return Promise.resolve(
        Response.json({
          access_token: 'fixture-top-next-access',
          refresh_token: 'fixture-top-next-refresh',
          expires_in: 3600,
          refresh_expires_in: 7200,
          error_code: 0
        })
      );
    });
    await test.refresh();
    expect(test.permission).toHaveBeenCalledWith([`${TOP_TOKEN_ORIGIN}/*`]);
    expect(test.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        configurationId: profile.configurationId,
        accessToken: 'fixture-top-next-access',
        refreshToken: 'fixture-top-next-refresh',
        accessTokenCapturedTimeUtc: 1_000,
        accessTokenExpiresTimeUtc: 3_601_000,
        refreshTokenExpiresTimeUtc: 7_201_000
      })
    );
    expect(test.values[AUTHORIZATION_REFRESH_INTENTS_KEY]).toEqual({});
    expect(test.send).toHaveBeenCalledOnce();
    expect(iop).not.toHaveBeenCalled();
  });
  it.each(['network', 'persistence', 'malformed', 'server'])(
    'blocks every second call after an unknown %s result',
    async (failure) => {
      const test = fixture();
      const iop = vi.spyOn(AlibabaIopTokenClient.prototype, 'request');
      if (failure === 'network') test.send.mockRejectedValue(new Error(profile.appSecret));
      else if (failure === 'malformed') test.send.mockResolvedValue(new Response(profile.refreshToken));
      else if (failure === 'server')
        test.send.mockResolvedValue(Response.json({ error: profile.refreshToken }, { status: 503 }));
      else {
        test.send.mockResolvedValue(Response.json({ access_token: 'fixture-rotated-token' }));
        test.commit.mockRejectedValue(new Error(profile.appSecret));
      }
      for (let attempt = 0; attempt < 2; attempt++)
        await expect(test.refresh()).rejects.toMatchObject({
          gatewayError: {
            code: 'AUTH_REFRESH_RESULT_UNKNOWN',
            message: 'AUTH_REFRESH_RESULT_UNKNOWN',
            retryable: false
          }
        });
      expect(test.send).toHaveBeenCalledOnce();
      expect(iop).not.toHaveBeenCalled();
      expect(JSON.stringify(test.values)).not.toContain(profile.appSecret);
    }
  );
  it('redacts rejected provider payloads and provides accurate missing-token/permission guidance', async () => {
    const test = fixture();
    test.send.mockResolvedValue(
      Response.json(
        { error: 'invalid_grant', error_description: profile.appSecret, refresh_token: profile.refreshToken },
        { status: 400 }
      )
    );
    await expect(test.refresh()).rejects.toMatchObject({
      gatewayError: {
        code: 'TOP_TOKEN_REJECTED',
        message: 'TOP_TOKEN_REJECTED',
        retryable: false
      }
    });
    expect(test.commit).not.toHaveBeenCalled();
    expect(test.values[AUTHORIZATION_REFRESH_INTENTS_KEY]).toEqual({});
    test.send.mockClear();
    await expect(test.refresh({ ...profile, refreshToken: null })).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_REFRESH_TOKEN_MISSING' }
    });
    test.permission.mockResolvedValue(false);
    await expect(test.refresh()).rejects.toMatchObject({
      gatewayError: { code: 'AUTH_PERMISSION_REQUIRED' }
    });
    expect(test.send).not.toHaveBeenCalled();
  });
});
