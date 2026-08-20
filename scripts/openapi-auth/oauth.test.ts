import { describe, expect, it } from 'vitest';

import { findApplicationCandidates } from './browser';
import { expiryFromSeconds, parseTokenResponse, validateCallback } from './oauth';

describe('Alibaba OAuth callback', () => {
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
});
