// @vitest-environment jsdom

import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import type { Photo } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import {
  createNativeShareFiles,
  createSocialShareArchive,
  prepareSocialShareAssets,
  type SocialSharePackageManifest
} from '../src/lib/social-share-package';

const photo: Photo = {
  id: 'ph_001',
  name: 'solar station.jpg',
  url: 'https://sc04.alicdn.com/kf/mock-solar-station.jpg',
  groupId: '2001',
  width: 1200,
  height: 1200,
  fileSize: 4,
  referenceCount: 1,
  modifiedAt: '2026-08-11T03:20:00Z'
};

describe('social share package', () => {
  it('downloads through the gateway and creates native files plus a portable ZIP', async () => {
    const progress: number[] = [];
    const assets = await prepareSocialShareAssets([photo], new MockGatewayClient(0), (current) => {
      progress.push(current);
    });

    expect(progress).toEqual([1]);
    expect(assets[0]).toMatchObject({
      photoId: 'ph_001',
      path: 'assets/mock-product-asset.jpg',
      contentType: 'image/jpeg'
    });
    const files = createNativeShareFiles(assets);
    expect(files[0]).toMatchObject({ name: 'mock-product-asset.jpg', type: 'image/jpeg', size: 4 });

    const archive = await createSocialShareArchive(
      assets,
      '  New product\r\n#solar  ',
      '2026-09-01T00:00:00Z'
    );
    const entries = unzipSync(archive);
    expect(Object.keys(entries).toSorted()).toEqual([
      'assets/mock-product-asset.jpg',
      'caption.txt',
      'share.json'
    ]);
    expect(strFromU8(entries['caption.txt'] ?? new Uint8Array())).toBe('New product\n#solar');
    const manifest = JSON.parse(
      strFromU8(entries['share.json'] ?? new Uint8Array())
    ) as SocialSharePackageManifest;
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      exportedAtUtc: '2026-09-01T00:00:00Z',
      caption: 'New product\n#solar',
      assets: [{ photoId: 'ph_001', path: 'assets/mock-product-asset.jpg', byteLength: 4 }]
    });
  });

  it('deduplicates repeated gateway file names', async () => {
    const assets = await prepareSocialShareAssets(
      [photo, { ...photo, id: 'ph_002', url: 'https://sc04.alicdn.com/kf/mock-second.jpg' }],
      new MockGatewayClient(0)
    );

    expect(assets.map((asset) => asset.fileName)).toEqual([
      'mock-product-asset.jpg',
      'mock-product-asset-2.jpg'
    ]);
  });
});
