import { afterEach, describe, expect, it } from 'vitest';

import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import {
  GatewayCredentialCipher,
  GatewayCredentialService,
  SqlGatewayCredentialRepository,
  StoredAlibabaCredentialProvider
} from '../src/gateway/credential-vault';

import type { AlibabaOpenApiCredentialBundle, NetworkTransport } from '@one-vegetable/core';
import type { NodeDatabaseHandle } from '../src/db/node-database';

const databases: NodeDatabaseHandle[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.connection.close();
});

describe('D1-compatible Alibaba credential vault', () => {
  it('stores only AES-GCM ciphertext and enforces revision updates', async () => {
    const { repository, service } = await harness();
    const imported = await service.import({
      bundle: bundle(),
      actorId: 'admin-1',
      expectedRevision: null,
      remark: 'self-hosted'
    });
    expect(imported).toMatchObject({ configured: true, revision: 1, updaterId: 'admin-1' });
    const record = await repository.find();
    expect(record?.encryptedBundle).not.toContain('app-secret');
    expect(record?.encryptedBundle).not.toContain('access-token');
    await expect(
      service.import({
        bundle: bundle(),
        actorId: 'admin-1',
        expectedRevision: 0,
        remark: null
      })
    ).rejects.toThrow('实体已被其他请求更新');
  });

  it('decrypts valid credentials and refreshes an expiring token atomically', async () => {
    const now = Date.parse('2026-08-30T00:00:00.000Z');
    const transport: NetworkTransport = {
      send() {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: 'refreshed-access',
              refresh_token: 'refreshed-refresh',
              expires_in: 3600,
              refresh_token_timeout: 7200
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );
      }
    };
    const { repository, service, cipher } = await harness(() => now);
    await service.import({
      bundle: bundle({ expiresAtUtc: new Date(now + 60_000).toISOString() }),
      actorId: 'admin-1',
      expectedRevision: null,
      remark: null
    });
    const provider = new StoredAlibabaCredentialProvider(repository, cipher, {
      transport,
      clock: () => now
    });
    const credentials = await provider.requireCredentials('3d7c8523-93cc-48b7-a615-a23d2976c516');
    expect(credentials.accessToken).toBe('refreshed-access');
    expect(await service.status()).toMatchObject({
      revision: 2,
      lastRefreshTimeUtc: now,
      lastRefreshErrorCode: null
    });
  });

  it('does not fall back to mock or environment credentials when the vault is empty', async () => {
    const { repository, cipher } = await harness();
    const provider = new StoredAlibabaCredentialProvider(repository, cipher);
    await expect(provider.requireCredentials()).rejects.toMatchObject({
      code: 'ALIBABA_CREDENTIALS_NOT_CONFIGURED'
    });
  });

  it('rejects an incorrect encryption key', async () => {
    const { repository, service } = await harness();
    await service.import({
      bundle: bundle(),
      actorId: 'admin-1',
      expectedRevision: null,
      remark: null
    });
    const wrongCipher = await GatewayCredentialCipher.create(encodedKey(2));
    const provider = new StoredAlibabaCredentialProvider(repository, wrongCipher);
    await expect(provider.requireCredentials()).rejects.toMatchObject({
      code: 'ALIBABA_CREDENTIAL_VAULT_UNREADABLE'
    });
  });
});

async function harness(clock: () => number = Date.now) {
  const database = openNodeDatabase(':memory:');
  databases.push(database);
  applyNodeMigrations(database);
  const repository = new SqlGatewayCredentialRepository(database.executor);
  const cipher = await GatewayCredentialCipher.create(encodedKey(1));
  return {
    repository,
    cipher,
    service: new GatewayCredentialService(repository, cipher, clock)
  };
}

function encodedKey(seed: number): string {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 256);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function bundle(patch: { expiresAtUtc?: string } = {}): AlibabaOpenApiCredentialBundle {
  return {
    schemaVersion: 1,
    capturedAtUtc: '2026-08-30T00:00:00.000Z',
    application: {
      appName: 'oneVegetable',
      appKey: 'app-key',
      appSecret: 'app-secret',
      callbackUrl: 'https://example.com/callback',
      status: 'Online',
      permissions: []
    },
    oauth: {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAtUtc: patch.expiresAtUtc ?? '2026-08-30T01:00:00.000Z',
      refreshExpiresAtUtc: '2026-09-30T00:00:00.000Z'
    },
    callback: {
      receivedAtUtc: '2026-08-30T00:00:00.000Z',
      stateMatched: true,
      callbackOrigin: 'https://example.com',
      callbackPath: '/callback'
    }
  };
}
