import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createNodeAlibabaCredentialProvider } from '../src/gateway/node-credential-bundle';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Node Alibaba credential bundle provider', () => {
  it('loads a valid ignored authorization bundle without exposing values in status', () => {
    const path = bundleFile({ expiresAtUtc: '2026-09-01T00:00:00.000Z' });
    const provider = createNodeAlibabaCredentialProvider(
      { ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: path },
      { now: () => Date.parse('2026-08-20T00:00:00.000Z') }
    );

    expect(provider.status()).toEqual({
      source: 'credential-bundle',
      configured: true,
      hasAppKey: true,
      hasAppSecret: true,
      hasAccessToken: true,
      accessTokenExpiresTimeUtc: Date.parse('2026-09-01T00:00:00.000Z'),
      endpointOrigin: 'https://eco.taobao.com',
      endpoint: 'https://eco.taobao.com/router/rest',
      protocol: 'top',
      signMethod: 'hmac',
      systemApiPermission: 'unknown',
      permissionCapturedTimeUtc: null
    });
    expect(JSON.stringify(provider.status())).not.toContain('secret-value');
    expect(provider.requireCredentials()).toMatchObject({
      appKey: 'app-key-value',
      appSecret: 'app-secret-value',
      accessToken: 'access-token-value'
    });
  });

  it('fails closed when the access token is expired or near expiry', () => {
    const path = bundleFile({ expiresAtUtc: '2026-08-20T00:04:59.000Z' });
    const provider = createNodeAlibabaCredentialProvider(
      { ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: path },
      { now: () => Date.parse('2026-08-20T00:00:00.000Z') }
    );

    expect(provider.status().configured).toBe(false);
    expect(() => provider.requireCredentials()).toThrow('openapi:auth:refresh');
  });

  it('preserves explicit IOP bundles and rejects a conflicting environment protocol', () => {
    const path = bundleFile({ expiresAtUtc: null, protocol: 'iop' });
    const provider = createNodeAlibabaCredentialProvider({ ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: path });
    expect(provider.status()).toMatchObject({
      protocol: 'iop',
      endpoint: 'https://openapi-api.alibaba.com/rest'
    });
    expect(provider.requireCredentials()).toMatchObject({
      protocol: 'iop',
      endpoint: 'https://openapi-api.alibaba.com/rest'
    });
    expect(() =>
      createNodeAlibabaCredentialProvider({
        ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: path,
        ONE_VEGETABLE_ALIBABA_PROTOCOL: 'top'
      })
    ).toThrow('协议不匹配');
    const oldPath = bundleFile({ expiresAtUtc: null });
    expect(() =>
      createNodeAlibabaCredentialProvider({
        ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: oldPath,
        ONE_VEGETABLE_ALIBABA_PROTOCOL: 'iop'
      })
    ).toThrow('协议不匹配');
  });

  it('rejects an incomplete or malformed bundle', () => {
    const directory = createTemporaryDirectory();
    const path = join(directory, 'credentials.json');
    writeFileSync(path, '{"schemaVersion":1,"application":{},"oauth":{}}', 'utf8');

    expect(() =>
      createNodeAlibabaCredentialProvider({ ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: path })
    ).toThrow('AppKey 无效');
  });
});

function bundleFile(input: { expiresAtUtc: string | null; protocol?: 'top' | 'iop' }): string {
  const directory = createTemporaryDirectory();
  const path = join(directory, 'credentials.json');
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 1,
      ...(input.protocol ? { protocol: input.protocol } : {}),
      application: {
        appName: 'TEST',
        appKey: 'app-key-value',
        appSecret: 'app-secret-value',
        callbackUrl: 'https://i.alibaba.com',
        status: 'Online',
        permissions: []
      },
      oauth: {
        accessToken: 'access-token-value',
        refreshToken: 'refresh-token-value',
        expiresAtUtc: input.expiresAtUtc,
        refreshExpiresAtUtc: null
      }
    }),
    'utf8'
  );
  return path;
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'one-vegetable-auth-'));
  temporaryDirectories.push(directory);
  return directory;
}
