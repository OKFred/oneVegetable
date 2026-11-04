import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import fixture from '../../../mock/data/s3-files-e2e.json' with { type: 'json' };
import { createRequestId, type NetworkTransport } from '@one-vegetable/core';
import { createApiApp } from '../src/app';
import { AdminService } from '../src/auth/admin-service';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import {
  S3StorageConfigurationCipher,
  S3StorageConfigurationService,
  SqlS3StorageConfigurationRepository
} from '../src/storage/s3-configuration';

// Test-only loopback server: signed S3 requests terminate in memory, never at a provider.
const database = openNodeDatabase(':memory:');
applyNodeMigrations(database);
const authRepository = new SqlAuthRepository(database.executor);
const authService = new AuthService({
  repository: authRepository,
  bootstrapToken: fixture.auth.bootstrapToken
});
const administrator = await authService.bootstrap({ requestId: createRequestId(), ...fixture.auth });
interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}
interface RequestRecord {
  method: string;
  key: string;
  continuation: string | null;
  conditional: boolean;
}
const objects = new Map<string, StoredObject>();
const cursors = new Map<string, { prefix: string; offset: number }>();
const requests: RequestRecord[] = [];
const root = fixture.configuration.rootPrefix + '/';
function reset(): void {
  objects.clear();
  cursors.clear();
  requests.length = 0;
  for (const item of fixture.objects)
    objects.set(root + item.key, {
      bytes: new TextEncoder().encode(item.text),
      contentType: item.contentType
    });
  for (let index = 0; index < fixture.generated.count; index++)
    objects.set(root + fixture.generated.prefix + 'entry-' + String(index).padStart(3, '0') + '.txt', {
      bytes: new TextEncoder().encode('Entry ' + String(index)),
      contentType: 'text/plain'
    });
}
function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function failure(code: string, status: number): Response {
  return new Response('<Error><Code>' + code + '</Code></Error>', { status });
}
function listing(url: URL): Response {
  const prefix = url.searchParams.get('prefix') ?? '';
  assert(prefix.startsWith(root), 'List escaped the configured root');
  assert.equal(url.searchParams.get('delimiter'), '/');
  const continuation = url.searchParams.get('continuation-token');
  const cursor = continuation ? cursors.get(continuation) : { prefix, offset: 0 };
  if (cursor?.prefix !== prefix) return failure('InvalidToken', 400);
  const entries = new Map<string, 'file' | 'directory'>();
  for (const key of objects.keys()) {
    if (!key.startsWith(prefix) || key === prefix) continue;
    const relative = key.slice(prefix.length);
    const slash = relative.indexOf('/');
    if (slash < 0) entries.set(key, 'file');
    else entries.set(prefix + relative.slice(0, slash + 1), 'directory');
  }
  const sorted = [...entries.keys()].sort();
  const maximum = Number(url.searchParams.get('max-keys'));
  assert(Number.isSafeInteger(maximum) && maximum > 0 && maximum <= 100);
  const page = sorted.slice(cursor.offset, cursor.offset + maximum);
  const truncated = cursor.offset + page.length < sorted.length;
  const next = truncated ? randomUUID() : null;
  if (next) cursors.set(next, { prefix, offset: cursor.offset + page.length });
  const content = page
    .map((key) => {
      if (entries.get(key) === 'directory')
        return '<CommonPrefixes><Prefix>' + xml(key) + '</Prefix></CommonPrefixes>';
      const item = objects.get(key);
      assert(item);
      return (
        '<Contents><Key>' +
        xml(key) +
        '</Key><Size>' +
        String(item.bytes.length) +
        '</Size><ETag>&quot;' +
        digest(item.bytes) +
        '&quot;</ETag><LastModified>' +
        fixture.modified +
        '</LastModified></Contents>'
      );
    })
    .join('');
  return new Response(
    '<ListBucketResult><IsTruncated>' +
      String(truncated) +
      '</IsTruncated>' +
      (next ? '<NextContinuationToken>' + next + '</NextContinuationToken>' : '') +
      content +
      '</ListBucketResult>',
    { headers: { 'content-type': 'application/xml' } }
  );
}
const transport: NetworkTransport = {
  async send(input, init) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.origin, fixture.configuration.endpoint, 'Unexpected provider request');
    const bucketPath = '/' + fixture.configuration.bucket;
    assert(url.pathname === bucketPath || url.pathname.startsWith(bucketPath + '/'));
    assert(request.headers.has('authorization'), 'S3 request was not signed');
    const key = decodeURIComponent(url.pathname.slice(bucketPath.length + 1));
    requests.push({
      method: request.method,
      key: url.searchParams.has('list-type') ? (url.searchParams.get('prefix') ?? '') : key,
      continuation: url.searchParams.get('continuation-token'),
      conditional: request.headers.get('if-none-match') === '*'
    });
    if (url.searchParams.get('list-type') === '2') {
      assert.equal(request.method, 'GET');
      return listing(url);
    }
    assert(key.startsWith(root), 'Object escaped the configured root');
    if (request.method === 'GET') {
      const object = objects.get(key);
      return object
        ? new Response(Uint8Array.from(object.bytes), {
            headers: { 'content-type': object.contentType, etag: '"' + digest(object.bytes) + '"' }
          })
        : failure('NoSuchKey', 404);
    }
    assert.equal(request.method, 'PUT', 'Only non-overwriting creation is supported');
    assert.equal(request.headers.get('if-none-match'), '*');
    if (objects.has(key)) return failure('PreconditionFailed', 412);
    const bytes = new Uint8Array(await request.arrayBuffer());
    objects.set(key, {
      bytes,
      contentType: request.headers.get('content-type') ?? 'application/octet-stream'
    });
    return new Response('', { headers: { etag: '"' + digest(bytes) + '"' } });
  }
};
const storage = new S3StorageConfigurationService(
  new SqlS3StorageConfigurationRepository(database.executor),
  await S3StorageConfigurationCipher.create(Buffer.alloc(32, 7).toString('base64url')),
  Date.now,
  transport
);
await storage.save({
  configuration: fixture.configuration,
  actorId: administrator.user.id,
  expectedRevision: null,
  remark: null
});
reset();
const app = new Hono();
app.post('/__files_test/reset', (context) => {
  reset();
  return context.json({ reset: true });
});
app.get('/__files_test/stats', (context) =>
  context.json({
    requests,
    objects: [...objects].map(([key, item]) => ({
      key,
      size: item.bytes.length,
      sha256: digest(item.bytes)
    }))
  })
);
app.route(
  '/',
  createApiApp({
    runtime: 'node',
    database: 'sqlite',
    environment: 'test',
    gatewayMode: 'disabled',
    authService,
    adminService: new AdminService(authRepository),
    s3Storage: storage,
    allowedOrigins: ['http://127.0.0.1:4183']
  })
);
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 4184 });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () =>
    server.close(() => {
      database.connection.close();
      process.exit(0);
    })
  );
