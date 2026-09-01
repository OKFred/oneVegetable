import { describe, expect, it } from 'vitest';

import {
  evaluateMetaDestinationPermission,
  META_GRAPH_API_VERSION,
  normalizeMetaPublicOrigin,
  validateMetaOAuthCallback
} from '../src/social-meta';

describe('Meta social contract helpers', () => {
  it('pins an explicit Graph API version', () => {
    expect(META_GRAPH_API_VERSION).toMatch(/^v\d+\.0$/u);
  });

  it('requires page publishing permissions and a content task', () => {
    expect(
      evaluateMetaDestinationPermission({
        platform: 'facebook',
        grantedScopes: ['pages_show_list', 'pages_read_engagement'],
        pageTasks: ['CREATE_CONTENT']
      })
    ).toEqual({
      allowed: false,
      reasonCode: 'META_PERMISSION_MISSING',
      missingScopes: ['pages_manage_posts']
    });
    expect(
      evaluateMetaDestinationPermission({
        platform: 'facebook',
        grantedScopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
        pageTasks: ['CREATE_CONTENT']
      })
    ).toEqual({ allowed: true, reasonCode: null, missingScopes: [] });
  });

  it('requires a linked Instagram professional account', () => {
    expect(
      evaluateMetaDestinationPermission({
        platform: 'instagram',
        grantedScopes: [
          'pages_show_list',
          'pages_read_engagement',
          'instagram_basic',
          'instagram_content_publish'
        ],
        pageTasks: ['CREATE_CONTENT'],
        hasLinkedInstagramAccount: false
      }).reasonCode
    ).toBe('INSTAGRAM_ACCOUNT_NOT_LINKED');
  });

  it('validates exact callback origin, pathname and state', () => {
    const callback = validateMetaOAuthCallback({
      expectedCallbackUrl: 'https://app.example.com/api/v1/social/meta/oauth/callback',
      actualCallbackUrl: 'https://app.example.com/api/v1/social/meta/oauth/callback?code=abc&state=expected',
      expectedState: 'expected'
    });
    expect(callback.searchParams.get('code')).toBe('abc');
    expect(() =>
      validateMetaOAuthCallback({
        expectedCallbackUrl: 'https://app.example.com/api/v1/social/meta/oauth/callback',
        actualCallbackUrl: 'https://evil.example/api/v1/social/meta/oauth/callback?code=abc&state=expected',
        expectedState: 'expected'
      })
    ).toThrow('登记地址不匹配');
  });

  it('normalizes HTTPS and local development origins', () => {
    expect(normalizeMetaPublicOrigin('https://app.example.com/')).toBe('https://app.example.com');
    expect(normalizeMetaPublicOrigin('http://localhost:8787')).toBe('http://localhost:8787');
    expect(() => normalizeMetaPublicOrigin('http://app.example.com')).toThrow('HTTPS');
  });
});
