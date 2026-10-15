import { describe, expect, it, vi } from 'vitest';
import {
  decodeBase64,
  type GatewayClient,
  type OperationId,
  type RequestOf,
  type ResponseOf
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { validateGalleryTransferTask } from '@one-vegetable/core/gallery-transfer-task';
import fixture from '../../../mock/data/template-material-deduplication.json';
import image from '../../../mock/data/gallery-task-assets.json';
import taskFixture from '../../../mock/data/gallery-transfer-task.json';
import photos from '../../../mock/data/photos.json';
import { galleryImportReadback } from '../src/lib/gallery-import-readback';
import { galleryAssetSha256 } from '../src/lib/gallery-transfer-archive';

async function setup() {
  const task = validateGalleryTransferTask(structuredClone(taskFixture));
  task.direction = 'import';
  const item = task.items[0];
  const photo = photos.responses.listPhotos.items[0];
  if (!item || !photo) throw new Error('Missing offline fixture');
  Object.assign(item, {
    fileId: fixture.fileId,
    targetGroupId: fixture.targetGroupId,
    sourceSize: decodeBase64(image.base64).length,
    sha256: await galleryAssetSha256(decodeBase64(image.base64))
  });
  const existing = { ...photo, id: fixture.fileId, groupId: fixture.actualGroupId, url: fixture.url };
  const gateway: GatewayClient = new MockGatewayClient(0);
  const original = gateway.request.bind(gateway);
  const request = vi.spyOn(gateway, 'request').mockImplementation(async (operation, input, options) => {
    if (operation === 'listPhotos')
      return { ...photos.responses.listPhotos, page: 1, pageSize: 100, items: [existing] };
    if (operation === 'downloadProductAsset')
      return {
        ...(await original('downloadProductAsset', input as RequestOf<'downloadProductAsset'>, options)),
        contentBase64: image.base64,
        byteLength: item.sourceSize ?? 0
      };
    return original<OperationId>(operation, input, options);
  });
  return { task, item, existing, gateway, request };
}

describe('deduplicated gallery image readback', () => {
  it('retains strict target-group checks by default and never redownloads or rewrites', async () => {
    const s = await setup();
    await expect(galleryImportReadback(s.gateway, s.task, s.item, [])).rejects.toThrow(
      'GALLERY_TASK_EXISTING_OTHER_GROUP'
    );
    expect(s.request.mock.calls.map(([operation]) => operation)).toEqual(['listPhotos']);
  });
  it('requires explicit consent plus exact fileId and SHA-256, including ungrouped images', async () => {
    const s = await setup();
    s.task.reuseExistingPhotos = true;
    expect(await galleryImportReadback(s.gateway, s.task, s.item, [])).toEqual(s.existing);
    expect(s.request.mock.calls.map(([operation]) => operation)).toEqual([
      'listPhotos',
      'downloadProductAsset'
    ]);
    for (const [, , options] of s.request.mock.calls) expect(options?.galleryContext).toEqual(s.task.context);
  });
  it('refuses mismatched image bytes even when reuse is allowed', async () => {
    const s = await setup();
    s.task.reuseExistingPhotos = true;
    s.item.sha256 = '0'.repeat(64);
    await expect(galleryImportReadback(s.gateway, s.task, s.item, [])).rejects.toThrow(
      'GALLERY_TASK_SOURCE_CHANGED'
    );
  });
  it('does not scan additional pages, guess by name, or accept a missing receipt ID', async () => {
    const s = await setup();
    s.task.reuseExistingPhotos = true;
    s.item.fileId = 'not-returned-in-first-page';
    expect(await galleryImportReadback(s.gateway, s.task, s.item, [])).toBeNull();
    expect(s.request).toHaveBeenCalledTimes(1);
    expect(s.request.mock.calls[0]?.[1] as RequestOf<'listPhotos'>).toEqual({ page: 1, pageSize: 100 });
    s.item.fileId = null;
    expect(await galleryImportReadback(s.gateway, s.task, s.item, [])).toBeNull();
    expect(s.request).toHaveBeenCalledTimes(1);
  });
  it('keeps matching target-group receipts on the original no-extra-request path', async () => {
    const s = await setup();
    const target: ResponseOf<'listPhotos'>['items'][number] = {
      ...s.existing,
      groupId: fixture.targetGroupId
    };
    expect(await galleryImportReadback(s.gateway, s.task, s.item, [target])).toEqual(target);
    expect(s.request).not.toHaveBeenCalled();
  });
  it('validates new receipt fields without rejecting legacy tasks or permitting forged consent', async () => {
    const s = await setup();
    expect(validateGalleryTransferTask(s.task)).toBe(s.task);
    s.item.actualGroupId = fixture.actualGroupId;
    s.item.status = 'confirmed';
    expect(() => validateGalleryTransferTask(s.task)).toThrow('GALLERY_TASK_INVALID');
    s.task.reuseExistingPhotos = true;
    expect(validateGalleryTransferTask(s.task)).toBe(s.task);
    expect(() => validateGalleryTransferTask({ ...s.task, reuseExistingPhotos: 'true' })).toThrow();
    expect(() => validateGalleryTransferTask({ ...s.task, direction: 'export' })).toThrow();
  });
});
