import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { decodeBase64, type GatewaySettings } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import type { S3StorageControl, S3ObjectContent } from '@one-vegetable/core/s3-storage';
import photoFixture from '../../../mock/data/photos.json';
import fixture from '../../../mock/data/gallery-task-assets.json';
import { GalleryTransferService, type GalleryTaskPlanInput } from '../src/lib/gallery-transfer-service';
import { galleryAssetSha256, createGalleryTransferArchive } from '../src/lib/gallery-transfer-archive';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  let held = false;
  vi.stubGlobal('navigator', {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        action: (lock: object | null) => Promise<unknown>
      ) => {
        if (held) return action(null);
        held = true;
        try {
          return await action({});
        } finally {
          held = false;
        }
      }
    }
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const unsupported = () => Promise.reject(new Error('unused'));
function setup() {
  const gateway = new MockGatewayClient(0);
  vi.spyOn(gateway, 'galleryTransferContext').mockResolvedValue({
    ...photoFixture.transferContext,
    storage: 'test-s3'
  });
  const bytes = decodeBase64(fixture.base64);
  const objects = new Map<string, S3ObjectContent>([
    [fixture.sourceKey, { key: fixture.sourceKey, bytes, etag: 'v1', contentType: fixture.contentType }]
  ]);
  const put = vi.fn((input: { key: string; bytes: Uint8Array; contentType: string }) => {
    objects.set(input.key, { ...input, etag: 'written' });
    return Promise.resolve({ key: input.key, etag: 'written' });
  });
  const get = vi.fn((key: string) => {
    const value = objects.get(key);
    return value ? Promise.resolve(value) : Promise.reject(new Error('missing'));
  });
  const control: S3StorageControl = {
    s3StorageConfiguration: unsupported,
    updateS3StorageConfiguration: unsupported,
    clearS3StorageConfiguration: unsupported,
    testS3StorageConnection: unsupported,
    listS3Objects: () =>
      Promise.resolve({
        items: [...objects.values()].map((o) => ({
          key: o.key,
          size: o.bytes.length,
          etag: o.etag,
          lastModifiedTimeUtc: null
        })),
        nextContinuationToken: null
      }),
    getS3Object: get,
    putS3Object: put
  };
  const service = new GalleryTransferService({
    gateway,
    settings: { load: (): Promise<GatewaySettings> => unsupported(), save: unsupported },
    mode: 'mock',
    s3Storage: control
  });
  const input: GalleryTaskPlanInput = {
    direction: 'import',
    storage: 's3',
    photos: [],
    groupId: '2001',
    groupName: 'Images',
    archiveBytes: null,
    archiveName: '',
    decisions: [
      {
        sourcePath: fixture.sourceKey,
        fileName: fixture.fileName,
        byteLength: bytes.length,
        contentType: fixture.contentType,
        action: 'import',
        matchedRuleId: 'test',
        targetGroupPath: 'Images',
        reason: 'matched',
        etag: 'v1'
      }
    ],
    conflictPolicy: 'rename',
    createMissingGroups: true,
    importMapping: 'current',
    exportMapping: 'flat',
    exportPrefix: 'test'
  };
  return { service, gateway, input, put, get, objects, bytes };
}
describe('persistent gallery plan and adapters', () => {
  it('plans a third-level group under the actual existing parent and honors the unchecked option', async () => {
    const s = setup();
    s.input.importMapping = 'rules';
    const decision = s.input.decisions[0];
    if (!decision) throw new Error('fixture');
    s.input.decisions = [{ ...decision, targetGroupPath: '商品主图/白底主图/Leaf' }];
    const task = await s.service.preview(s.input);
    expect(task.items.filter((i) => i.kind === 'group')).toMatchObject([
      { fileName: 'Leaf', targetGroupId: '2101', parentItemId: null }
    ]);
    expect(task.items.find((i) => i.kind === 'asset')?.parentItemId).toBe(task.items[0]?.id);
    s.input.createMissingGroups = false;
    await expect(s.service.preview(s.input)).rejects.toThrow('GALLERY_TASK_GROUP_MISSING');
    s.input.createMissingGroups = true;
    s.input.decisions = [{ ...decision, targetGroupPath: 'One/Two/Three/Four' }];
    await expect(s.service.preview(s.input)).rejects.toThrow('GALLERY_TASK_INVALID_PATH');
  });
  it('imports S3, verifies fileId and never reuploads a completed task', async () => {
    const s = setup();
    const task = await s.service.preview(s.input);
    await s.service.create(task, null);
    const request = vi.spyOn(s.gateway, 'request');
    await s.service.run(task.id);
    await s.service.run(task.id);
    expect(request.mock.calls.filter(([operation]) => operation === 'uploadPhoto')).toHaveLength(1);
    expect((await s.service.repository.get(task.id)).status).toBe('completed');
  });
  it('refuses changed S3 objects before upload', async () => {
    const s = setup();
    const task = await s.service.preview(s.input);
    await s.service.create(task, null);
    const object = s.objects.get(fixture.sourceKey);
    if (!object) throw new Error('fixture');
    object.etag = 'v2';
    const request = vi.spyOn(s.gateway, 'request');
    await s.service.run(task.id);
    expect(request.mock.calls.filter(([operation]) => operation === 'uploadPhoto')).toHaveLength(0);
    expect((await s.service.repository.get(task.id)).items[0]?.errorCode).toBe('GALLERY_TASK_SOURCE_CHANGED');
  });
  it('keeps uncertain PUTs on their original key and verifies before any resend', async () => {
    const s = setup();
    s.input.direction = 'export';
    s.input.photos = photoFixture.responses.listPhotos.items.slice(0, 1);
    const original = s.gateway.request.bind(s.gateway);
    const sha256 = await galleryAssetSha256(s.bytes);
    vi.spyOn(s.gateway, 'request').mockImplementation(async (operation) => {
      if (operation === 'downloadProductAsset')
        return {
          fileName: fixture.fileName,
          contentBase64: fixture.base64,
          byteLength: s.bytes.length,
          contentType: fixture.contentType,
          sha256
        };
      if (operation === 'listPhotos') return original('listPhotos', { page: 1, pageSize: 100 });
      if (operation === 'listPhotoGroups') return original('listPhotoGroups', {});
      throw new Error(`Unexpected operation: ${operation}`);
    });
    const task = await s.service.preview(s.input);
    await s.service.create(task, null);
    s.put.mockImplementationOnce((input) => {
      s.objects.set(input.key, { ...input, etag: 'written' });
      return Promise.reject(new Error('timeout after write'));
    });
    await s.service.run(task.id);
    expect((await s.service.repository.get(task.id)).items[0]?.status).toBe('unknown');
    await s.service.run(task.id);
    expect(s.put.mock.calls.map(([value]) => value.key)).toHaveLength(2); // asset once, then final manifest
    expect(s.put.mock.calls[1]?.[0].key).toBe(`${task.batchPrefix}/gallery.json`);
    expect((await s.service.repository.get(task.id)).status).toBe('completed');
  });
  it('requires the original ZIP after a simulated reload, then resumes only pending items', async () => {
    const s = setup();
    const sha256 = await galleryAssetSha256(s.bytes);
    const path = 'assets/recovery.png';
    const bytes = await createGalleryTransferArchive({
      document: {
        schemaVersion: 1,
        kind: 'one-vegetable-gallery-transfer',
        createdTimeUtc: Date.now(),
        assets: [
          {
            path,
            fileName: fixture.fileName,
            sourcePhotoId: 'fixture',
            groupPath: 'Images',
            contentType: fixture.contentType,
            byteLength: s.bytes.length,
            sha256,
            width: 1,
            height: 1,
            modifiedTimeUtc: null
          }
        ]
      },
      assets: [{ path, bytes: s.bytes }],
      totalUncompressedBytes: s.bytes.length
    });
    s.input.storage = 'zip';
    s.input.archiveBytes = bytes;
    const task = await s.service.preview(s.input);
    await s.service.create(task, bytes);
    s.service.driver.forgetArchive(task.id);
    await s.service.run(task.id);
    expect((await s.service.repository.get(task.id)).items[0]?.errorCode).toBe(
      'GALLERY_TASK_ARCHIVE_REQUIRED'
    );
    await s.service.driver.attachArchive(task, bytes);
    await s.service.run(task.id);
    expect((await s.service.repository.get(task.id)).status).toBe('completed');
  });
});
