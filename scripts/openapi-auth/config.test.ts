import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { callbackMatches, readOpenApiAuthConfiguration } from './config';
import { OpenApiAuthError, redactText, safeError } from './storage';

describe('OpenAPI auth configuration', () => {
  const workingDirectory = resolve('test-workspace');

  it('uses safe defaults and treats login credentials separately', () => {
    const result = readOpenApiAuthConfiguration(
      { ALI_ACCOUNT: 'seller@example.com', ALL_PASS: 'not-printed' },
      workingDirectory
    );

    expect(result.targetUrl.href).toBe('https://i.alibaba.com/explore/open-api');
    expect(result.callbackUrl).toBeNull();
    expect(result.account).toBe('seller@example.com');
    expect(result.password).toBe('not-printed');
    expect(result.outputPath).toBe(resolve(workingDirectory, 'artifacts/openapi-auth/credentials.json'));
  });

  it.each([
    'http://example.com/callback',
    'https://user:pass@example.com/callback',
    'https://localhost/callback',
    'https://127.0.0.1/callback',
    'https://192.168.1.4/callback',
    'https://example.com/callback#token'
  ])('rejects an unsafe callback URL: %s', (callbackUrl) => {
    expect(() =>
      readOpenApiAuthConfiguration({ OPEN_API_CALLBACK_URL: callbackUrl }, workingDirectory)
    ).toThrow('公共 HTTPS URL');
  });

  it('matches callback origin and normalized path without trusting query values', () => {
    expect(
      callbackMatches(
        new URL('https://i.alibaba.com/oauth/callback/'),
        new URL('https://i.alibaba.com/oauth/callback?code=secret&state=state')
      )
    ).toBe(true);
    expect(
      callbackMatches(
        new URL('https://i.alibaba.com/oauth/callback'),
        new URL('https://evil.example/oauth/callback?code=secret')
      )
    ).toBe(false);
  });
});

describe('OpenAPI auth diagnostics', () => {
  it('redacts OAuth and credential values', () => {
    const result = redactText(
      'https://example.com?code=abc&state=def app_secret=ghi password=jkl access_token=mno'
    );

    expect(result).not.toContain('abc');
    expect(result).not.toContain('def');
    expect(result).not.toContain('ghi');
    expect(result).not.toContain('jkl');
    expect(result).not.toContain('mno');
  });

  it('preserves stable error codes', () => {
    expect(safeError(new OpenApiAuthError('LOGIN_REQUIRED', '需要登录'))).toEqual({
      code: 'LOGIN_REQUIRED',
      message: '需要登录'
    });
  });
});
