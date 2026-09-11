import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, expect, it } from 'vitest';
import fixture from '../../../mock/data/node-gateway-credentials.json';
import { openD1Database, isD1DatabaseReady } from '../src/db/d1-database';
import {
  GatewayCredentialCipher,
  GatewayCredentialService,
  SqlGatewayCredentialRepository,
  StoredAlibabaCredentialProvider
} from '../src/gateway/credential-vault';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

it('runs shared migrations and preserves encrypted save, revision and clear semantics in D1', async () => {
  const db = openD1Database(env.DB);
  expect(await isD1DatabaseReady(db)).toBe(true);
  const repository = new SqlGatewayCredentialRepository(db.executor);
  const cipher = await GatewayCredentialCipher.create(
    btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replace(/\+/gu, '-')
      .replace(/\//gu, '_')
      .replace(/=+$/u, '')
  );
  const service = new GatewayCredentialService(repository, cipher);
  const provider = new StoredAlibabaCredentialProvider(repository, cipher);
  const saved = await service.save({
    credentials: fixture.manual,
    actorId: 'admin',
    expectedRevision: null,
    remark: null
  });
  expect(saved).toMatchObject({ configured: true, revision: 1, source: 'd1-vault', inputSource: 'manual' });
  expect(await provider.requireCredentials(crypto.randomUUID())).toMatchObject({
    appKey: fixture.manual.appKey
  });
  await expect(
    service.save({ credentials: fixture.manual, actorId: 'admin', expectedRevision: null, remark: null })
  ).rejects.toThrow();
  const replaced = await service.save({
    credentials: fixture.manual,
    actorId: 'admin',
    expectedRevision: 1,
    remark: null
  });
  expect(replaced.configurationId).not.toBe(saved.configurationId);
  await service.clear(2);
  expect(await repository.managed()).toBe(true);
  expect(await service.status()).toMatchObject({ configured: false });
  await expect(provider.requireCredentials(crypto.randomUUID())).rejects.toThrow();
  const restored = await service.save({
    credentials: fixture.manual,
    actorId: 'admin',
    expectedRevision: null,
    remark: null
  });
  expect(restored.revision).toBe(4);
});
