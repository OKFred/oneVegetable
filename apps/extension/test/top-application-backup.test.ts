import { describe, expect, it } from 'vitest';
import fixtures from '../../../mock/data/alibaba-auth/top-application-backups.json';
import credentials from '../../../mock/data/alibaba-auth/standalone-json-imports.json';
import { parseTopApplicationBackup } from '../lib/top-application-backup';
import { parseAuthorizationJson } from '../lib/authorization-json-editor';

describe('TOP application metadata backup', () => {
  it('accepts the application-only format without requiring or returning a token', () => {
    const result = parseTopApplicationBackup(JSON.stringify(fixtures.top));
    expect(result).toEqual(fixtures.top.application);
    expect(Object.keys(result).sort()).toEqual(['appKey', 'appName', 'appSecret', 'callbackUrl']);
    expect(() => parseAuthorizationJson(JSON.stringify(fixtures.top), 'top')).toThrow('AUTH_JSON_INVALID');
  });

  it('accepts an unmarked legacy application and the optional application name', () => {
    const legacy = { application: { ...fixtures.top.application, appName: undefined } };
    expect(parseTopApplicationBackup(JSON.stringify(legacy))).toEqual({
      ...fixtures.top.application,
      appName: ''
    });
  });

  it('reads full and dual bundles while returning only the selected TOP application fields', () => {
    const expected = {
      appName: credentials.top.application.appName,
      appKey: credentials.top.application.appKey,
      appSecret: credentials.top.application.appSecret,
      callbackUrl: credentials.top.application.callbackUrl
    };
    for (const value of [credentials.top, [credentials.iop, credentials.top]]) {
      const result = parseTopApplicationBackup(JSON.stringify(value));
      expect(result).toEqual(expected);
      expect(JSON.stringify(result)).not.toContain(credentials.top.oauth.accessToken);
      expect(result).not.toHaveProperty('oauth');
    }
  });

  it('never treats an IOP app as TOP based on its key or callback', () => {
    expect(() => parseTopApplicationBackup(JSON.stringify(fixtures.iop))).toThrow('TOP_REQUIRED');
    expect(() => parseTopApplicationBackup(JSON.stringify(credentials.iop))).toThrow('TOP_REQUIRED');
    expect(() => parseTopApplicationBackup(JSON.stringify({ ...fixtures.top, protocol: 'unknown' }))).toThrow(
      'AUTH_JSON_INVALID'
    );
  });

  it('does not reinterpret an invalid full credential as an application-only backup', () => {
    for (const extra of [{ oauth: {} }, { schemaVersion: 1 }, { callback: {} }])
      expect(() => parseTopApplicationBackup(JSON.stringify({ ...fixtures.top, ...extra }))).toThrow(
        'AUTH_JSON_INVALID'
      );
  });

  it.each([
    'http://merchant.example/callback',
    'https://user:password@merchant.example/callback',
    'https://merchant.example/callback#fragment',
    'javascript:alert(1)',
    ''
  ])('rejects unsafe callback %s without exposing application secrets', (callbackUrl) => {
    expect(() =>
      parseTopApplicationBackup(
        JSON.stringify({ ...fixtures.top, application: { ...fixtures.top.application, callbackUrl } })
      )
    ).toThrow('AUTH_JSON_INVALID');
  });

  it('rejects missing fields, whitespace secrets, placeholders and oversized UTF-8 input', () => {
    for (const patch of [
      { appKey: undefined },
      { appSecret: null },
      { appKey: 'invalid key' },
      { appSecret: 'invalid\nsecret' },
      { appName: 1 }
    ])
      expect(() =>
        parseTopApplicationBackup(
          JSON.stringify({ ...fixtures.top, application: { ...fixtures.top.application, ...patch } })
        )
      ).toThrow('AUTH_JSON_INVALID');
    expect(() =>
      parseTopApplicationBackup(
        JSON.stringify({
          ...fixtures.top,
          application: { ...fixtures.top.application, appSecret: 'YOUR_APP_SECRET' }
        })
      )
    ).toThrow('AUTH_JSON_EXAMPLE');
    expect(() => parseTopApplicationBackup('文'.repeat(21_846))).toThrow('AUTH_JSON_TOO_LARGE');
    expect(() => parseTopApplicationBackup(fixtures.top.application.appSecret)).toThrow('AUTH_JSON_INVALID');
  });
});
