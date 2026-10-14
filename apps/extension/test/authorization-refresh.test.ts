import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlibabaIopTokenClient } from '@one-vegetable/core/alibaba-iop';
import type { GatewayCredentialSettings } from '@one-vegetable/core';
import {
  AUTHORIZATION_REFRESH_INTENTS_KEY,
  refreshAuthorizationProfile as refreshIopAuthorization
} from '../lib/authorization-refresh';

const profile: GatewayCredentialSettings = {
  protocol: 'iop',
  configurationId: 'fixture-iop-configuration',
  appKey: 'fixture-key',
  appSecret: 'fixture-secret',
  accessToken: 'fixture-access',
  refreshToken: 'fixture-refresh',
  endpoint: 'https://openapi-api.alibaba.com/rest',
  signMethod: 'hmac-sha256'
};
function storage() {
  const values: Record<string, unknown> = {};
  return {
    values,
    get: (key: string) => Promise.resolve(Object.hasOwn(values, key) ? { [key]: values[key] } : {}),
    set: (items: Record<string, unknown>) => {
      Object.assign(values, items);
      return Promise.resolve();
    }
  };
}
afterEach(() => vi.restoreAllMocks());
describe('extension selected-profile refresh', () => {
  it('keeps stable identity on refresh and persists only an opaque send intent before dispatch', async () => {
    const store = storage();
    const commit = vi.fn().mockResolvedValue(undefined);
    const request = vi.spyOn(AlibabaIopTokenClient.prototype, 'request').mockImplementation(() => {
      const intent = JSON.stringify(store.values);
      expect(intent).toContain('sending');
      expect(intent).not.toContain(profile.refreshToken);
      expect(intent).not.toContain(profile.appSecret);
      return Promise.resolve({
        accessToken: 'rotated-access',
        refreshToken: 'rotated-refresh',
        expiresInSeconds: 3600,
        refreshExpiresInSeconds: null
      });
    });
    await refreshIopAuthorization(
      profile,
      store,
      () => Promise.resolve(true),
      commit,
      undefined,
      () => 1_000
    );
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({
        configurationId: profile.configurationId,
        accessToken: 'rotated-access',
        refreshToken: 'rotated-refresh',
        accessTokenExpiresTimeUtc: 3_601_000
      })
    );
    expect(store.values[AUTHORIZATION_REFRESH_INTENTS_KEY]).toEqual({});
    expect(request).toHaveBeenCalledOnce();
  });
  it.each(['network', 'persistence'])(
    'blocks a second refresh after unknown %s results, including worker restart',
    async (failure) => {
      const store = storage();
      const request = vi.spyOn(AlibabaIopTokenClient.prototype, 'request');
      if (failure === 'network')
        request.mockRejectedValue(new Error('fixture secret-bearing provider failure'));
      else
        request.mockResolvedValue({
          accessToken: 'rotated-access',
          refreshToken: 'rotated-refresh',
          expiresInSeconds: 3600,
          refreshExpiresInSeconds: null
        });
      const commit = vi.fn().mockRejectedValue(new Error('fixture secret-bearing storage failure'));
      for (let attempt = 0; attempt < 2; attempt++) {
        // New client instances stand in for lost worker memory; only the persisted intent is authoritative.
        await expect(
          refreshIopAuthorization(profile, store, () => Promise.resolve(true), commit)
        ).rejects.toMatchObject({
          gatewayError: {
            code: 'AUTH_REFRESH_RESULT_UNKNOWN',
            message: 'AUTH_REFRESH_RESULT_UNKNOWN',
            retryable: false
          }
        });
      }
      expect(request).toHaveBeenCalledOnce();
      expect(JSON.stringify(store.values)).not.toContain('rotated');
      expect(JSON.stringify(store.values)).not.toContain(profile.refreshToken);
    }
  );
  it('never dispatches a missing refresh token, expired IOP, or IOP without the host permission', async () => {
    const request = vi.spyOn(AlibabaIopTokenClient.prototype, 'request');
    const commit = vi.fn();
    await expect(
      refreshIopAuthorization(
        { ...profile, protocol: 'top', refreshToken: null },
        storage(),
        () => Promise.resolve(true),
        commit
      )
    ).rejects.toMatchObject({ gatewayError: { code: 'ALIBABA_REFRESH_TOKEN_MISSING' } });
    await expect(
      refreshIopAuthorization(
        { ...profile, refreshTokenExpiresTimeUtc: 0 },
        storage(),
        () => Promise.resolve(true),
        commit
      )
    ).rejects.toMatchObject({ gatewayError: { code: 'AUTH_REFRESH_EXPIRED' } });
    await expect(
      refreshIopAuthorization(profile, storage(), () => Promise.resolve(false), commit)
    ).rejects.toMatchObject({ gatewayError: { code: 'AUTH_PERMISSION_REQUIRED' } });
    expect(request).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});
