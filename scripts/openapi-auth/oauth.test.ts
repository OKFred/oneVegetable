import { describe, expect, it } from 'vitest';

import {
  buildAuthorizationUrl,
  extractApplicationKeyFromRequest,
  findApplicationCandidates,
  findLegacyApplicationCandidates
} from './browser';
import { expiryFromSeconds, parseTokenResponse, validateCallback } from './oauth';

describe('Alibaba OAuth callback', () => {
  it('sends the registered callback URL to the authorization endpoint', () => {
    const url = buildAuthorizationUrl(
      {
        appName: 'Test',
        appKey: '23075594',
        callbackUrl: new URL('https://i.alibaba.com/callback'),
        status: 'Online',
        permissions: [],
        source: 'application-center'
      },
      'expected-state'
    );

    expect(url.searchParams.get('client_id')).toBe('23075594');
    expect(url.searchParams.get('redirect_uri')).toBe('https://i.alibaba.com/callback');
    expect(url.searchParams.get('state')).toBe('expected-state');
  });

  it('accepts a matching state and returns the one-time code', () => {
    expect(validateCallback(new URL('https://i.alibaba.com/?code=one-time&state=expected'), 'expected')).toBe(
      'one-time'
    );
  });

  it('rejects state mismatch before token exchange', () => {
    expect(() =>
      validateCallback(new URL('https://i.alibaba.com/?code=one-time&state=wrong'), 'expected')
    ).toThrow('state 不匹配');
  });
});

describe('Alibaba token response', () => {
  it('normalizes snake case and string durations', () => {
    expect(
      parseTokenResponse({
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: '3600',
        refresh_token_timeout: 7200
      })
    ).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresInSeconds: 3600,
      refreshExpiresInSeconds: 7200
    });
    expect(expiryFromSeconds(new Date('2026-01-01T00:00:00.000Z'), 60)).toBe('2026-01-01T00:01:00.000Z');
  });

  it('does not accept a response without an access token', () => {
    expect(() => parseTokenResponse({ error: 'invalid_grant' })).toThrow('缺少 access token');
  });
});

describe('Alibaba application discovery', () => {
  it('extracts and deduplicates nested app records', () => {
    expect(
      findApplicationCandidates({
        data: [
          { appkey: 500_001, name: 'First' },
          { appKey: '500002', appName: 'Second' },
          { appkey: 500_001, name: 'First' }
        ]
      })
    ).toEqual([
      { appKey: '500001', appName: 'First' },
      { appKey: '500002', appName: 'Second' }
    ]);
  });

  it('reads the full app key from the App Secret request without exposing the secret', () => {
    expect(
      extractApplicationKeyFromRequest(
        'https://openapi.alibaba.com/handler/share/app/getAppSecret.json',
        'appkey=23075594'
      )
    ).toBe('23075594');
    expect(
      extractApplicationKeyFromRequest(
        'https://openapi.alibaba.com/handler/share/app/getAppSecret.json?app_key=23075595',
        null
      )
    ).toBe('23075595');
  });

  it('extracts legacy ICBU applications and their registered callbacks', () => {
    expect(
      findLegacyApplicationCandidates({
        isSuccess: true,
        data: [
          {
            appKey: '23075594',
            appName: 'Legacy app',
            callbackUrl: 'https://www.aliyun.com'
          }
        ]
      })
    ).toEqual([
      {
        appKey: '23075594',
        appName: 'Legacy app',
        callbackUrl: 'https://www.aliyun.com',
        source: 'legacy-crosstrade'
      }
    ]);
  });
});
