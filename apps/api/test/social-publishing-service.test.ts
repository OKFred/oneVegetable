import { afterEach, describe, expect, it } from 'vitest';

import { createRequestId, encodeBase64 } from '@one-vegetable/core';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import { SocialMediaAssetService } from '../src/social-meta/media-service';
import { MemorySocialMediaStore } from '../src/social-meta/media-store';
import { MetaPublisher } from '../src/social-meta/meta-publisher';
import { SqlSocialPublishingRepository } from '../src/social-meta/publishing-repository';
import { SocialPublishingService } from '../src/social-meta/publishing-service';
import { SqlMetaSocialRepository } from '../src/social-meta/repository';
import { MetaSecretCipher } from '../src/social-meta/secret-cipher';
import { MetaSocialService } from '../src/social-meta/service';

import type { NetworkTransport, SocialPlatform } from '@one-vegetable/core';
import type { NodeDatabaseHandle } from '../src/db/node-database';

const databases: NodeDatabaseHandle[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.connection.close();
});

describe('social publishing state machine', () => {
  it('publishes one Facebook image once and reuses an identical idempotency key', async () => {
    const transport = new RoutingTransport(() =>
      jsonResponse({ id: 'photo-1', post_id: 'page-1_123' }, { 'x-fb-request-id': 'fb-request-1' })
    );
    const harness = await createHarness('facebook', transport);
    const input = prepareRequest(harness.destinationId, pngHeader(1200, 1000), 'image/png');
    const prepared = await harness.service.prepare(input, harness.actorId);
    const repeated = await harness.service.prepare(input, harness.actorId);
    const published = await harness.service.publish({
      jobId: prepared.id,
      requestId: createRequestId(),
      actorId: harness.actorId
    });

    expect(repeated.id).toBe(prepared.id);
    expect(published).toMatchObject({
      status: 'published',
      platformPostId: 'page-1_123',
      platformRequestId: 'fb-request-1'
    });
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.url.pathname).toBe('/v26.0/page-1/photos');
    expect(transport.requests[0]?.body).toContain('published=true');
    expect(JSON.stringify(published)).not.toContain('A concise caption');
    expect(published).not.toHaveProperty('encryptedCaption');
    const stored = harness.database.connection
      .prepare('SELECT encrypted_caption FROM social_publish_jobs WHERE id = ?')
      .get(prepared.id) as { encrypted_caption: string };
    expect(stored.encrypted_caption).not.toContain('A concise caption');
  });

  it('marks an ambiguous Facebook timeout unknown and never sends it again', async () => {
    const transport = new RoutingTransport(() => {
      throw new Error('socket closed after upload');
    });
    const harness = await createHarness('facebook', transport);
    const prepared = await harness.service.prepare(
      prepareRequest(harness.destinationId, pngHeader(1000, 1000), 'image/png'),
      harness.actorId
    );
    const first = await harness.service.publish({
      jobId: prepared.id,
      requestId: createRequestId(),
      actorId: harness.actorId
    });
    const repeated = await harness.service.publish({
      jobId: prepared.id,
      requestId: createRequestId(),
      actorId: harness.actorId
    });

    expect(first.status).toBe('unknown');
    expect(repeated.status).toBe('unknown');
    expect(transport.requests).toHaveLength(1);
  });

  it('marks an explicit invalid-token response failed and requires reconnection', async () => {
    const transport = new RoutingTransport(() =>
      jsonResponse(
        { error: { code: 190, error_subcode: 463, fbtrace_id: 'trace-expired' } },
        { 'x-fb-request-id': 'request-expired' },
        400
      )
    );
    const harness = await createHarness('facebook', transport);
    const prepared = await harness.service.prepare(
      prepareRequest(harness.destinationId, pngHeader(1000, 1000), 'image/png'),
      harness.actorId
    );
    const failed = await harness.service.publish({
      jobId: prepared.id,
      requestId: createRequestId(),
      actorId: harness.actorId
    });
    const connection = harness.database.connection
      .prepare('SELECT status FROM meta_oauth_grants LIMIT 1')
      .get() as { status: string };

    expect(failed).toMatchObject({
      status: 'failed',
      reasonCode: 'META_GRAPH_190_463',
      platformRequestId: 'request-expired',
      platformTraceId: 'trace-expired'
    });
    expect(connection.status).toBe('reconnect-required');
  });

  it('waits for an Instagram container and executes media_publish exactly once', async () => {
    const transport = new RoutingTransport(({ url, method }) => {
      if (method === 'POST' && url.pathname === '/v26.0/ig-1/media') {
        return jsonResponse({ id: 'container-1' });
      }
      if (method === 'GET' && url.pathname === '/v26.0/container-1') {
        return jsonResponse({ id: 'container-1', status_code: 'FINISHED' });
      }
      if (method === 'POST' && url.pathname === '/v26.0/ig-1/media_publish') {
        return jsonResponse({ id: 'ig-post-1' }, { 'x-fb-trace-id': 'ig-trace-1' });
      }
      return jsonResponse({ error: { code: 100 } }, {}, 400);
    });
    const harness = await createHarness('instagram', transport);
    const prepared = await harness.service.prepare(
      prepareRequest(harness.destinationId, jpegHeader(1080, 1350), 'image/jpeg'),
      harness.actorId
    );
    const processing = await harness.service.publish({
      jobId: prepared.id,
      requestId: createRequestId(),
      actorId: harness.actorId
    });
    expect(processing).toMatchObject({ status: 'processing', platformContainerId: 'container-1' });

    const tooSoon = await harness.service.advance({
      jobId: prepared.id,
      requestId: createRequestId(),
      actorId: harness.actorId
    });
    expect(tooSoon.status).toBe('processing');
    expect(transport.requests).toHaveLength(1);

    harness.advanceClock(60_000);
    const published = await harness.service.advance({
      jobId: prepared.id,
      requestId: createRequestId(),
      actorId: harness.actorId
    });
    const repeated = await harness.service.advance({
      jobId: prepared.id,
      requestId: createRequestId(),
      actorId: harness.actorId
    });
    expect(published).toMatchObject({
      status: 'published',
      platformPostId: 'ig-post-1',
      platformTraceId: 'ig-trace-1'
    });
    expect(repeated.status).toBe('published');
    expect(transport.requests.map(({ url }) => url.pathname)).toEqual([
      '/v26.0/ig-1/media',
      '/v26.0/container-1',
      '/v26.0/ig-1/media_publish'
    ]);
  });

  it('rejects one idempotency key reused with a different caption before another platform call', async () => {
    const harness = await createHarness('facebook', new RoutingTransport(() => jsonResponse({ id: 'x' })));
    const original = prepareRequest(harness.destinationId, pngHeader(800, 800), 'image/png');
    await harness.service.prepare(original, harness.actorId);
    await expect(
      harness.service.prepare({ ...original, caption: 'Different caption' }, harness.actorId)
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
  });
});

class RoutingTransport implements NetworkTransport {
  readonly requests: { url: URL; method: string; body: string }[] = [];

  constructor(private readonly route: (request: { url: URL; method: string; body: string }) => Response) {}

  send(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    const published = init.body instanceof FormData ? init.body.get('published') : null;
    const request = {
      url,
      method: init.method ?? 'GET',
      body:
        init.body instanceof URLSearchParams
          ? init.body.toString()
          : typeof published === 'string'
            ? `published=${published}`
            : ''
    };
    this.requests.push(request);
    return Promise.resolve(this.route(request));
  }
}

async function createHarness(platform: SocialPlatform, transport: NetworkTransport) {
  let now = Date.parse('2026-09-01T00:00:00.000Z');
  const database = openNodeDatabase(':memory:');
  databases.push(database);
  applyNodeMigrations(database);
  const authRepository = new SqlAuthRepository(database.executor);
  const auth = new AuthService({
    repository: authRepository,
    bootstrapToken: 'bootstrap-secret-that-is-long'
  });
  const bootstrap = await auth.bootstrap({
    requestId: createRequestId(),
    bootstrapToken: 'bootstrap-secret-that-is-long',
    username: 'admin',
    password: 'correct-password-value'
  });
  const metaRepository = new SqlMetaSocialRepository(database.executor);
  const publishingRepository = new SqlSocialPublishingRepository(database.executor);
  const cipher = await MetaSecretCipher.create(encodedKey(1));
  const appSecret = await cipher.encrypt('app-secret', 'primary', 'app-secret');
  await metaRepository.saveConfiguration({
    appId: '123456789012345',
    encryptedAppSecret: appSecret.ciphertext,
    initializationVector: appSecret.initializationVector,
    graphApiVersion: 'v26.0',
    publicOrigin: 'https://social.example.com',
    actorId: bootstrap.user.id,
    expectedRevision: null,
    remark: null,
    now
  });
  const connectionId = crypto.randomUUID();
  const userToken = await cipher.encrypt('user-token', connectionId, 'user-token');
  await metaRepository.saveConnection({
    id: connectionId,
    accountExternalId: 'account-1',
    accountName: 'Test Admin',
    encryptedUserToken: userToken.ciphertext,
    initializationVector: userToken.initializationVector,
    grantedScopes: [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'instagram_basic',
      'instagram_content_publish'
    ],
    tokenExpiresTimeUtc: now + 3_600_000,
    actorId: bootstrap.user.id,
    now
  });
  const destinationId = crypto.randomUUID();
  const destinationToken = await cipher.encrypt('destination-token', destinationId, 'page-token');
  await metaRepository.saveDestination({
    id: destinationId,
    connectionId,
    platform,
    externalId: platform === 'instagram' ? 'ig-1' : 'page-1',
    name: platform === 'instagram' ? 'onevegetable.test' : 'oneVegetable Test',
    pageExternalId: 'page-1',
    pageName: 'oneVegetable Test',
    encryptedAccessToken: destinationToken.ciphertext,
    initializationVector: destinationToken.initializationVector,
    tasks: ['CREATE_CONTENT'],
    canPublish: true,
    unavailableReasonCode: null,
    now
  });
  const mediaAssets = new SocialMediaAssetService(
    publishingRepository,
    new MemorySocialMediaStore(),
    () => now
  );
  const metaSocial = new MetaSocialService(metaRepository, cipher, { clock: () => now });
  return {
    actorId: bootstrap.user.id,
    database,
    destinationId,
    service: new SocialPublishingService(
      publishingRepository,
      mediaAssets,
      metaSocial,
      cipher,
      new MetaPublisher(transport),
      () => now
    ),
    advanceClock(milliseconds: number) {
      now += milliseconds;
    }
  };
}

function prepareRequest(destinationId: string, bytes: Uint8Array, contentType: 'image/jpeg' | 'image/png') {
  return {
    requestId: createRequestId(),
    destinationId,
    caption: 'A concise caption',
    idempotencyKey: createRequestId(),
    file: {
      fileName: contentType === 'image/jpeg' ? 'share.jpg' : 'share.png',
      contentType,
      byteLength: bytes.byteLength,
      contentBase64: encodeBase64(bytes)
    }
  };
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function jpegHeader(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xd9
  ]);
}

function encodedKey(seed: number): string {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 256);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
