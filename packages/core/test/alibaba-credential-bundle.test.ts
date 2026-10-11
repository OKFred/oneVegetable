import { describe, expect, it } from 'vitest';
import tokenFixture from '../../../mock/data/system-api-authorization.json';

import {
  credentialExpiryFromSeconds,
  createAlibabaOpenApiCredentialBundle,
  isAlibabaOpenApiCredentialBundle,
  parseAlibabaOpenApiCredentialBundle,
  parseAlibabaTokenResponse
} from '../src/alibaba-credential-bundle';

describe('Alibaba credential bundle contract', () => {
  it('reads System API lifetime names without enabling an IOP endpoint or inventing unknown expiry', () => {
    expect(parseAlibabaTokenResponse(tokenFixture.token)).toMatchObject({
      expiresInSeconds: 3600,
      refreshExpiresInSeconds: 7200
    });
    expect(
      parseAlibabaTokenResponse({ ...tokenFixture.token, refresh_expires_in: 0, re_expires_in: 7200 })
        .refreshExpiresInSeconds
    ).toBe(0);
    expect(parseAlibabaTokenResponse({ access_token: tokenFixture.token.access_token })).toMatchObject({
      expiresInSeconds: null,
      refreshExpiresInSeconds: null
    });
  });
  it('reads documented ICBU refresh duration and preserves zero without guessing a lifetime', () => {
    expect(
      parseAlibabaTokenResponse({ access_token: 'test', re_expires_in: '86400', expires_in: 0 })
    ).toMatchObject({ expiresInSeconds: 0, refreshExpiresInSeconds: 86400 });
    expect(
      parseAlibabaTokenResponse({ access_token: 'test', re_expires_in: 0, refresh_token_timeout: 7200 })
        .refreshExpiresInSeconds
    ).toBe(0);
    for (const duration of [null, '', ' ', -1, 'invalid', 0.5, Infinity, Number.MAX_VALUE]) {
      expect(
        parseAlibabaTokenResponse({ access_token: 'test', expires_in: duration }).expiresInSeconds
      ).toBeNull();
    }
    expect(credentialExpiryFromSeconds(1_000, 0)).toBe('1970-01-01T00:00:01.000Z');
    expect(credentialExpiryFromSeconds(Date.now(), Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(credentialExpiryFromSeconds(Date.now(), null)).toBeNull();
  });
  it('accepts the versioned browser authorization bundle', () => {
    const bundle = fixture();
    expect(parseAlibabaOpenApiCredentialBundle(bundle)).toEqual(bundle);
    expect(isAlibabaOpenApiCredentialBundle(bundle)).toBe(true);
  });

  it('rejects unsafe callback URLs and incomplete secrets', () => {
    expect(
      isAlibabaOpenApiCredentialBundle({
        ...fixture(),
        application: { ...fixture().application, callbackUrl: 'http://localhost/callback' }
      })
    ).toBe(false);
    expect(
      isAlibabaOpenApiCredentialBundle({
        ...fixture(),
        oauth: { ...fixture().oauth, accessToken: '' }
      })
    ).toBe(false);
  });

  it('normalizes Alibaba token response aliases', () => {
    expect(
      parseAlibabaTokenResponse({
        access_token: 'next-access',
        refresh_token: 'next-refresh',
        expires_in: '3600',
        refresh_token_timeout: 7200
      })
    ).toEqual({
      accessToken: 'next-access',
      refreshToken: 'next-refresh',
      expiresInSeconds: 3600,
      refreshExpiresInSeconds: 7200
    });
  });

  it('builds the shared bundle without persisting the authorization code', () => {
    const result = createAlibabaOpenApiCredentialBundle({
      capturedAtTimeUtc: Date.parse('2026-08-30T00:00:00.000Z'),
      application: {
        appName: 'oneVegetable',
        appKey: 'app-key',
        appSecret: 'app-secret',
        callbackUrl: 'https://example.com/callback',
        status: 'Online',
        permissions: [{ name: 'product', status: 'authorized' }]
      },
      token: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresInSeconds: 60,
        refreshExpiresInSeconds: null
      },
      receivedCallbackUrl: 'https://example.com/callback?code=transient&state=matched'
    });

    expect(result.oauth.expiresAtUtc).toBe('2026-08-30T00:01:00.000Z');
    expect(result.callback).toEqual({
      receivedAtUtc: '2026-08-30T00:00:00.000Z',
      stateMatched: true,
      callbackOrigin: 'https://example.com',
      callbackPath: '/callback'
    });
    expect(JSON.stringify(result)).not.toContain('transient');
  });
});

function fixture() {
  return {
    schemaVersion: 1 as const,
    capturedAtUtc: '2026-08-30T00:00:00.000Z',
    application: {
      appName: 'oneVegetable',
      appKey: 'app-key',
      appSecret: 'app-secret',
      callbackUrl: 'https://example.com/callback',
      status: 'Online',
      permissions: [{ name: 'product', status: 'authorized' }]
    },
    oauth: {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAtUtc: '2026-08-30T01:00:00.000Z',
      refreshExpiresAtUtc: '2026-09-30T00:00:00.000Z'
    },
    callback: {
      receivedAtUtc: '2026-08-30T00:00:00.000Z',
      stateMatched: true as const,
      callbackOrigin: 'https://example.com',
      callbackPath: '/callback'
    }
  };
}
