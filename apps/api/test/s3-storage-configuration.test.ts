import { afterEach, describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/extension-s3.json';

import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import {
  S3StorageConfigurationCipher,
  S3StorageConfigurationService,
  SqlS3StorageConfigurationRepository
} from '../src/storage/s3-configuration';

import type { NodeDatabaseHandle } from '../src/db/node-database';

const databases: NodeDatabaseHandle[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.connection.close();
});

describe('S3 storage configuration', () => {
  it('rejects private HTTP in server compositions unless explicitly opted in', async () => {
    const { service } = await harness();
    await expect(
      service.save({
        configuration: { ...configuration(), endpoint: fixture.localHttpEndpoint, allowInsecureLocal: true },
        actorId: 'admin',
        expectedRevision: null,
        remark: null
      })
    ).rejects.toThrow('S3_LOCAL_HTTP_DISABLED');
  });
  it('accepts explicitly opted-in private HTTP without weakening the default service', async () => {
    const { repository, service, cipher } = await harness(true);
    const localConfiguration = {
      ...configuration(),
      endpoint: fixture.localHttpEndpoint,
      allowInsecureLocal: true
    };
    await expect(
      service.save({
        configuration: localConfiguration,
        actorId: 'admin',
        expectedRevision: null,
        remark: null
      })
    ).resolves.toMatchObject({ configured: true, endpoint: fixture.localHttpEndpoint });
    expect(await service.requireConfiguration()).toEqual(localConfiguration);
    await expect(
      new S3StorageConfigurationService(repository, cipher).requireConfiguration()
    ).rejects.toThrow('S3_LOCAL_HTTP_DISABLED');
  });
  it('encrypts credentials and returns only a redacted summary', async () => {
    const { repository, service } = await harness();
    const summary = await service.save({
      configuration: configuration(),
      actorId: 'admin-1',
      expectedRevision: null,
      remark: ' gallery backup '
    });

    expect(summary).toMatchObject({
      configured: true,
      endpoint: 'https://account.r2.cloudflarestorage.com',
      accessKeyIdSuffix: '-key',
      revision: 1,
      remark: 'gallery backup'
    });
    const record = await repository.find();
    expect(record?.encryptedConfiguration).not.toContain('secret-value');
    expect(await service.requireConfiguration()).toEqual(configuration());
  });

  it('enforces revisions and rejects a different encryption key', async () => {
    const { repository, service } = await harness();
    await service.save({
      configuration: configuration(),
      actorId: 'admin-1',
      expectedRevision: null,
      remark: null
    });
    await expect(
      service.save({
        configuration: configuration(),
        actorId: 'admin-1',
        expectedRevision: 0,
        remark: null
      })
    ).rejects.toThrow('实体已被其他请求更新');

    const unreadable = new S3StorageConfigurationService(
      repository,
      await S3StorageConfigurationCipher.create(encodedKey(2))
    );
    await expect(unreadable.requireConfiguration()).rejects.toMatchObject({
      code: 'S3_CREDENTIAL_VAULT_UNREADABLE'
    });
  });
});

async function harness(allowLocalHttp = false) {
  const database = openNodeDatabase(':memory:');
  databases.push(database);
  applyNodeMigrations(database);
  const repository = new SqlS3StorageConfigurationRepository(database.executor);
  const cipher = await S3StorageConfigurationCipher.create(encodedKey(1));
  return {
    repository,
    cipher,
    service: new S3StorageConfigurationService(repository, cipher, undefined, undefined, allowLocalHttp)
  };
}

function configuration() {
  return {
    endpoint: 'https://account.r2.cloudflarestorage.com',
    region: 'auto',
    bucket: 'gallery-backup',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'secret-value',
    sessionToken: null,
    pathStyle: true,
    rootPrefix: 'one-vegetable/gallery'
  } as const;
}

function encodedKey(seed: number): string {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 256);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
