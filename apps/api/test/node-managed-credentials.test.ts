import { afterEach, describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/node-gateway-credentials.json';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import {
  GatewayCredentialCipher,
  GatewayCredentialService,
  SqlGatewayCredentialRepository,
  StoredAlibabaCredentialProvider
} from '../src/gateway/credential-vault';
import { NodeManagedCredentialProvider } from '../src/gateway/node-managed-credentials';
import type { NodeDatabaseHandle } from '../src/db/node-database';

const databases: NodeDatabaseHandle[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => {
    db.connection.close();
  });
});
async function harness() {
  const database = openNodeDatabase(':memory:');
  databases.push(database);
  applyNodeMigrations(database);
  const repository = new SqlGatewayCredentialRepository(database.executor);
  const cipher = await GatewayCredentialCipher.create(btoa('k'.repeat(32)).replace(/=+$/u, ''));
  const service = new GatewayCredentialService(repository, cipher, Date.now, 'sqlite-vault');
  const stored = new StoredAlibabaCredentialProvider(repository, cipher, { source: 'sqlite-vault' });
  const environment = {
    ONE_VEGETABLE_ALIBABA_APP_KEY: 'old-app',
    ONE_VEGETABLE_ALIBABA_APP_SECRET: 'old-secret',
    ONE_VEGETABLE_ALIBABA_ACCESS_TOKEN: 'old-token'
  };
  return {
    database,
    repository,
    cipher,
    service,
    stored,
    environment,
    provider: new NodeManagedCredentialProvider(repository, stored, service, environment)
  };
}
const input = () => ({ credentials: fixture.manual, actorId: 'admin', expectedRevision: null, remark: null });

describe('Node live credential configuration', () => {
  it('switches immediately from legacy to encrypted manual input and never revives legacy on clear or restart', async () => {
    const h = await harness();
    expect((await h.provider.requireCredentials()).appKey).toBe('old-app');
    const saved = await h.service.save(input());
    expect((await h.provider.requireCredentials()).appKey).toBe(fixture.manual.appKey);
    expect(await h.provider.summary()).toMatchObject({
      source: 'sqlite-vault',
      inputSource: 'manual',
      canRefresh: false
    });
    const record = await h.repository.find();
    if (!record || saved.revision === null) throw new Error('Expected persisted credentials');
    expect(record.encryptedBundle).not.toContain(fixture.manual.appSecret);
    expect((await h.cipher.decryptDocument(record)).authorization).toBeNull();
    await h.service.clear(saved.revision);
    const restarted = new NodeManagedCredentialProvider(h.repository, h.stored, h.service, h.environment);
    await expect(restarted.requireCredentials()).rejects.toMatchObject({
      code: 'ALIBABA_CREDENTIALS_NOT_CONFIGURED'
    });
    const next = await h.service.save(input());
    expect(next.revision).toBeGreaterThan(saved.revision);
    await expect(h.service.clear(saved.revision)).rejects.toThrow();
  });
  it('rejects stale creation revisions and malformed secrets without storing them', async () => {
    const h = await harness();
    await expect(h.service.save({ ...input(), expectedRevision: 15 })).rejects.toThrow();
    await expect(
      h.service.save({ ...input(), credentials: { ...fixture.manual, appSecret: '' } })
    ).rejects.toThrow();
    expect(await h.repository.managed()).toBe(false);
  });
  it('reports invalid legacy files without preventing initialization', async () => {
    const h = await harness();
    const provider = new NodeManagedCredentialProvider(h.repository, h.stored, h.service, {
      ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: 'nonexistent-fixture.json'
    });
    expect((await provider.summary()).errorCode).toBe('ALIBABA_CREDENTIAL_FILE_INVALID');
    await h.service.save(input());
    expect((await provider.requireCredentials()).appKey).toBe(fixture.manual.appKey);
  });
  it('does not refresh unknown expiry and reports expired non-refreshable credentials', async () => {
    const h = await harness();
    const saved = await h.service.save(input());
    await expect(h.provider.requireCredentials(undefined, true)).rejects.toMatchObject({
      code: 'ALIBABA_REFRESH_TOKEN_MISSING'
    });
    await h.service.save({
      ...input(),
      expectedRevision: saved.revision,
      credentials: { ...fixture.manual, accessTokenExpiresTimeUtc: 1 }
    });
    await expect(h.provider.requireCredentials()).rejects.toMatchObject({
      code: 'ALIBABA_ACCESS_TOKEN_EXPIRED'
    });
  });
});
