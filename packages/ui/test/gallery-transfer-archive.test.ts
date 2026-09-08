import { describe, expect, it } from 'vitest';

import type { GalleryTransferDocumentV1 } from '@one-vegetable/core';
import {
  createGalleryTransferArchive,
  galleryAssetSha256,
  galleryTransferAssetPath,
  readGalleryTransferArchive
} from '../src/lib/gallery-transfer-archive';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

describe('gallery transfer archive', () => {
  it('round-trips a verified gallery manifest and image', async () => {
    const sha256 = await galleryAssetSha256(JPEG);
    const path = galleryTransferAssetPath('front image.jpeg', 'image/jpeg', sha256);
    const document = manifest(path, sha256);
    const bytes = await createGalleryTransferArchive({
      document,
      assets: [{ path, bytes: JPEG }],
      totalUncompressedBytes: JPEG.byteLength
    });
    const result = await readGalleryTransferArchive(bytes);
    expect(result.document).toEqual(document);
    expect(result.assets).toEqual([{ path, bytes: JPEG }]);
  });

  it('rejects a manifest digest that does not match the image bytes', async () => {
    const sha256 = await galleryAssetSha256(JPEG);
    const path = galleryTransferAssetPath('front.jpg', 'image/jpeg', sha256);
    await expect(
      createGalleryTransferArchive({
        document: manifest(path, 'b'.repeat(64)),
        assets: [{ path, bytes: JPEG }],
        totalUncompressedBytes: JPEG.byteLength
      })
    ).rejects.toThrow(/摘要/u);
  });
});

function manifest(path: string, sha256: string): GalleryTransferDocumentV1 {
  return {
    schemaVersion: 1,
    kind: 'one-vegetable-gallery-transfer',
    createdTimeUtc: 1_788_793_200_000,
    assets: [
      {
        path,
        fileName: 'front image.jpeg',
        sourcePhotoId: 'photo-1',
        groupPath: '商品/主图',
        contentType: 'image/jpeg',
        byteLength: JPEG.byteLength,
        sha256,
        width: 1200,
        height: 1200,
        modifiedTimeUtc: 1_788_793_200_000
      }
    ]
  };
}
