import { describe, expect, it } from 'vitest';

import {
  createAlibabaOpenApiCredentialBundle,
  isAlibabaOpenApiCredentialBundle,
  parseAlibabaOpenApiCredentialBundle,
  parseAlibabaTokenResponse
} from '../src/alibaba-credential-bundle';

describe('Alibaba credential bundle contract', () => {
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
