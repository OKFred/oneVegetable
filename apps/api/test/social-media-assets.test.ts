import { afterEach, describe, expect, it } from 'vitest';

import { encodeBase64 } from '@one-vegetable/core';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import { SocialMediaAssetService } from '../src/social-meta/media-service';
import { MemorySocialMediaStore } from '../src/social-meta/media-store';
import { SqlSocialPublishingRepository } from '../src/social-meta/publishing-repository';

const databases: ReturnType<typeof openNodeDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.connection.close();
});

describe('private social media assets', () => {
  it('stages an image, rotates an opaque URL token and serves only the matching token', async () => {
    const database = openNodeDatabase(':memory:');
    databases.push(database);
    applyNodeMigrations(database);
    const repository = new SqlSocialPublishingRepository(database.executor);
    const store = new MemorySocialMediaStore();
    const service = new SocialMediaAssetService(repository, store, () => Date.UTC(2026, 8, 1));
    const bytes = pngHeader(1200, 1000);
    const asset = await service.stage(
      {
        fileName: 'share.png',
        contentType: 'image/png',
        byteLength: bytes.byteLength,
        contentBase64: encodeBase64(bytes)
      },
      'facebook'
    );

    const url = await service.issuePublicUrl({
      assetId: asset.id,
      publicOrigin: 'https://social.example.com',
      apiPrefix: '/api/v1'
    });
    const token = new URL(url).pathname.split('/').at(-1) ?? '';
    const stored = await service.readByOpaqueToken(token);

    expect(url).toMatch(/^https:\/\/social\.example\.com\/api\/v1\/social-media\/[A-Za-z0-9_-]{43}$/u);
    expect(stored).toEqual({ bytes, contentType: 'image/png' });
    expect(await service.readByOpaqueToken('A'.repeat(43))).toBeNull();
  });

  it('does not expose an expired object even when storage still contains bytes', async () => {
    let now = Date.UTC(2026, 8, 1);
    const database = openNodeDatabase(':memory:');
    databases.push(database);
    applyNodeMigrations(database);
    const repository = new SqlSocialPublishingRepository(database.executor);
    const service = new SocialMediaAssetService(repository, new MemorySocialMediaStore(), () => now);
    const bytes = pngHeader(800, 800);
    const asset = await service.stage(
      {
        fileName: 'expires.png',
        contentType: 'image/png',
        byteLength: bytes.byteLength,
        contentBase64: encodeBase64(bytes)
      },
      'facebook'
    );
    const url = await service.issuePublicUrl({
      assetId: asset.id,
      publicOrigin: 'https://social.example.com',
      apiPrefix: '/api/v1'
    });
    now = asset.expiresTimeUtc + 1;
    expect(await service.readByOpaqueToken(url.split('/').at(-1) ?? '')).toBeNull();
  });
});

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}
