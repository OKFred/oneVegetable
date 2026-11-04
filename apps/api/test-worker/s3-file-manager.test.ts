import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, expect, it, vi } from 'vitest';
import type { NetworkTransport } from '@one-vegetable/core';
import storageFixture from '../../../mock/data/extension-s3.json';
import fixture from '../../../mock/data/s3-file-manager.json';
import { openD1Database } from '../src/db/d1-database';
import {
  S3StorageConfigurationCipher,
  S3StorageConfigurationService,
  SqlS3StorageConfigurationRepository
} from '../src/storage/s3-configuration';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

it('workerd signs private directory requests and pins D1 configuration without Alibaba credentials', async () => {
  const responses = [
    new Response(fixture.directory),
    new Response('', { headers: { etag: '"folder"' } }),
    new Response(new Uint8Array()),
    new Response(fixture.collision, { status: 412 })
  ];
  const requests: Request[] = [];
  const send = vi.fn<NetworkTransport['send']>((input, init) => {
    const request = new Request(input, init);
    expect(request.headers.has('authorization')).toBe(true);
    expect(request.headers.has('cookie')).toBe(false);
    expect(new URL(request.url).origin).toBe(storageFixture.configuration.endpoint);
    requests.push(request);
    const response = responses.shift();
    if (!response) throw new Error('Unexpected retry');
    return Promise.resolve(response);
  });
  const service = new S3StorageConfigurationService(
    new SqlS3StorageConfigurationRepository(openD1Database(env.DB).executor),
    await S3StorageConfigurationCipher.create(btoa('k'.repeat(32)).replace(/=+$/u, '')),
    Date.now,
    { send }
  );
  const summary = await service.save({
    configuration: { ...storageFixture.configuration, rootPrefix: 'root' },
    actorId: 'file-manager-worker-test',
    expectedRevision: null,
    remark: null
  });
  expect(summary.configurationId).toMatch(/^[a-f0-9]{64}$/u);
  expect(JSON.stringify(summary)).not.toContain(storageFixture.configuration.secretAccessKey);
  await expect(service.createClient(undefined, 'f'.repeat(64))).rejects.toMatchObject({
    gatewayError: { code: 'GALLERY_CONTEXT_CHANGED' }
  });
  expect(send).not.toHaveBeenCalled();
  const client = await service.createClient(undefined, summary.configurationId);
  expect(await client.listObjects({ prefix: 'assets/', delimiter: '/' })).toMatchObject({
    items: [{ key: 'assets/hello.txt', size: 5 }],
    prefixes: ['assets/images/'],
    nextContinuationToken: 'second-page'
  });
  const folder = {
    key: 'assets/new/',
    bytes: new Uint8Array(),
    contentType: 'application/x-directory',
    directory: true,
    createOnly: true
  };
  await client.putObject(folder);
  expect((await client.getObject(folder.key)).bytes).toHaveLength(0);
  await expect(client.putObject(folder)).rejects.toMatchObject({
    gatewayError: { subCode: 'HTTP_412:PreconditionFailed' }
  });
  expect(send).toHaveBeenCalledTimes(4);
  expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(2);
  for (const request of requests.filter((value) => value.method === 'PUT')) {
    expect(request.headers.get('if-none-match')).toBe('*');
    expect(new URL(request.url).pathname).toBe('/gallery/root/assets/new/');
  }
});
