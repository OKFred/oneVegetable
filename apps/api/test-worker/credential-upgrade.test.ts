import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { parseAlibabaOpenApiCredentialBundle } from '@one-vegetable/core/credential-bundle';
import fixture from '../../../mock/data/node-gateway-credentials.json';
import { openD1Database, isD1DatabaseReady } from '../src/db/d1-database';
import {
  GatewayCredentialCipher,
  SqlGatewayCredentialRepository,
  StoredAlibabaCredentialProvider
} from '../src/gateway/credential-vault';

it('upgrades an existing D1 v12 encrypted credential without losing its original AAD or audit fields', async () => {
  const legacy = env.TEST_MIGRATIONS.filter((migration) => !migration.name.startsWith('0013_'));
  await applyD1Migrations(env.DB, legacy);
  const cipher = await GatewayCredentialCipher.create(btoa('k'.repeat(32)).replace(/=+$/u, ''));
  const bundle = parseAlibabaOpenApiCredentialBundle(fixture.oauthBundle);
  const encrypted = await cipher.encrypt(bundle);
  await env.DB.prepare(
    "INSERT INTO alibaba_gateway_credentials (id, encrypted_bundle, initialization_vector, algorithm, schema_version, key_version, create_time_utc, update_time_utc, creator_id, updater_id, revision, remark) VALUES ('primary', ?, ?, 'AES-256-GCM', 1, 1, 123, 456, 'legacy', 'legacy', 7, 'retained')"
  )
    .bind(encrypted.encryptedBundle, encrypted.initializationVector)
    .run();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const database = openD1Database(env.DB);
  expect(await isD1DatabaseReady(database)).toBe(true);
  const repository = new SqlGatewayCredentialRepository(database.executor);
  const row = await repository.find();
  if (!row) throw new Error('Migrated credential missing');
  expect(row).toMatchObject({
    encryptedBundle: encrypted.encryptedBundle,
    initializationVector: encrypted.initializationVector,
    schemaVersion: 1,
    revision: 7,
    remark: 'retained'
  });
  expect(await cipher.decrypt(row)).toEqual(bundle);
  expect(await repository.managed()).toBe(true);
  expect((await new StoredAlibabaCredentialProvider(repository, cipher).requireCredentials()).appKey).toBe(
    bundle.application.appKey
  );
  const audit = await env.DB.prepare(
    'SELECT create_time_utc, update_time_utc, creator_id, updater_id FROM alibaba_gateway_credentials'
  ).first();
  expect(audit).toEqual({
    create_time_utc: 123,
    update_time_utc: 456,
    creator_id: 'legacy',
    updater_id: 'legacy'
  });
});
