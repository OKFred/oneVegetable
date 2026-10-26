import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  decodeBase64,
  validatePhotoBytes,
  type GatewayClient,
  type OperationId,
  type OperationAvailabilityClient,
  type OperationAvailabilityResult
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { GatewayException } from '@one-vegetable/core/errors';
import { getIopOperationSupport } from '@one-vegetable/core/alibaba-iop-registry';
import { MemoryProductDescriptionTemplateClient } from '@one-vegetable/core/templates';
import { validateGalleryTransferTask } from '@one-vegetable/core/gallery-transfer-task';
import type { TemplateMaterialPackage } from '@one-vegetable/core/template-materials';
import photos from '../../../mock/data/photos.json';
import image from '../../../mock/data/gallery-task-assets.json';
import taskFixture from '../../../mock/data/gallery-transfer-task.json';
import { assertGalleryImportReadback, galleryCanQueryAllPhotos } from '../src/lib/gallery-import-readback';
import { BrowserGalleryTransferDriver } from '../src/lib/gallery-transfer-driver';
import { GalleryTransferService, type GalleryTaskPlanInput } from '../src/lib/gallery-transfer-service';
import { createGalleryTransferArchive, galleryAssetSha256 } from '../src/lib/gallery-transfer-archive';
import {
  prepareTemplateMaterialImport,
  executeTemplateMaterialImport
} from '../src/lib/template-material-transfer';
import type { AppServices } from '../src/lib/services';

const allowed = (): OperationAvailabilityResult => ({
  items: [{ operation: 'listPhotos', allowed: true, reasonCode: null }]
});
const unverified = (): OperationAvailabilityResult => ({
  items: [
    {
      operation: 'listPhotos',
      allowed: true,
      reasonCode: null,
      protocolSupport: { protocol: 'iop', ...getIopOperationSupport('listPhotos') }
    }
  ]
});
const unused = () => Promise.reject(new Error('Unused offline service'));
const disposables: GalleryTransferService[] = [];
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('navigator', {
    locks: {
      request: async (_name: string, _options: unknown, action: (lock: object) => Promise<unknown>) =>
        action({})
    }
  });
});
afterEach(() => {
  for (const service of disposables.splice(0)) service.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(mode: AppServices['mode'] = 'bff') {
  const gateway: GatewayClient = new MockGatewayClient(0);
  const context = { ...photos.transferContext, storage: 'offline-s3' };
  const current = vi.spyOn(gateway, 'galleryTransferContext').mockResolvedValue(context);
  const get = vi.fn<OperationAvailabilityClient['get']>().mockResolvedValue(allowed());
  const bytes = decodeBase64(image.base64);
  const source = vi.fn().mockResolvedValue({
    key: image.sourceKey,
    bytes,
    etag: 'v1',
    contentType: image.contentType
  });
  const put = vi.fn((input: { key: string }) => Promise.resolve({ key: input.key, etag: 'v2' }));
  const services: AppServices = {
    mode,
    gateway,
    operationAvailability: { get },
    settings: { load: unused, save: unused },
    s3Storage: {
      s3StorageConfiguration: unused,
      updateS3StorageConfiguration: unused,
      clearS3StorageConfiguration: unused,
      testS3StorageConnection: unused,
      listS3Objects: unused,
      getS3Object: source,
      putS3Object: put
    }
  };
  const service = new GalleryTransferService(services);
  disposables.push(service);
  const driver = new BrowserGalleryTransferDriver(services, vi.fn());
  const request = vi.spyOn(gateway, 'request');
  const input: GalleryTaskPlanInput = {
    direction: 'import',
    storage: 's3',
    photos: [],
    groupId: '2001',
    groupName: 'Images',
    archiveBytes: null,
    archiveName: 'offline.zip',
    decisions: [
      {
        sourcePath: image.sourceKey,
        fileName: image.fileName,
        byteLength: bytes.length,
        contentType: image.contentType,
        action: 'import',
        matchedRuleId: 'offline',
        targetGroupPath: 'New/Leaf',
        reason: 'matched',
        etag: 'v1'
      }
    ],
    conflictPolicy: 'rename',
    createMissingGroups: true,
    importMapping: 'current',
    exportMapping: 'flat',
    exportPrefix: 'offline'
  };
  return { gateway, context, current, get, bytes, source, put, services, service, driver, request, input };
}

async function materialPackage(withImage = true): Promise<TemplateMaterialPackage> {
  const bytes = decodeBase64(image.base64);
  const contentType = validatePhotoBytes(bytes);
  if (contentType !== 'image/png' || image.contentType !== contentType)
    throw new Error('Offline material fixture must contain a PNG with matching metadata');
  const sha256 = await galleryAssetSha256(bytes);
  const path = 'assets/' + sha256 + '.png';
  return {
    document: {
      kind: 'oneVegetable.product-description-template-assets',
      schemaVersion: 1,
      exportedAtUtc: 1788793200000,
      templates: [
        {
          name: 'Offline preflight',
          category: 'custom',
          language: 'en_US',
          remark: null,
          html: withImage ? '<p>Test</p><img src="' + path + '">' : '<p>Test</p>'
        }
      ],
      assets: withImage
        ? [
            {
              path,
              fileName: image.fileName,
              contentType,
              byteLength: bytes.length,
              sha256
            }
          ]
        : []
    },
    assets: withImage ? [{ path, bytes }] : []
  };
}
async function zipBytes(): Promise<Uint8Array> {
  const pack = await materialPackage();
  return createGalleryTransferArchive({
    document: {
      kind: 'one-vegetable-gallery-transfer',
      schemaVersion: 1,
      createdTimeUtc: 1788793200000,
      assets: pack.document.assets.map((asset) => ({
        ...asset,
        sourcePhotoId: 'offline',
        groupPath: 'Images',
        width: 1,
        height: 1,
        modifiedTimeUtc: null
      }))
    },
    assets: pack.assets,
    totalUncompressedBytes: pack.assets.reduce((sum, asset) => sum + asset.bytes.length, 0)
  });
}
function oldTask(s: ReturnType<typeof setup>, kind: 'asset' | 'group' = 'asset') {
  const task = validateGalleryTransferTask(structuredClone(taskFixture));
  task.context = s.context;
  const asset = task.items[0];
  if (!asset) throw new Error('Missing offline item');
  Object.assign(asset, {
    kind,
    sourcePath: image.sourceKey,
    fileName: kind === 'group' ? 'Offline new group' : image.fileName,
    sourceSize: s.bytes.length,
    sourceEtag: 'v1',
    targetGroupId: kind === 'group' ? null : '2001'
  });
  return { task, asset };
}

describe('context-bound import readback preflight', () => {
  it('rejects the registry IOP scope constraint without changing all-photo-query semantics', async () => {
    const s = setup();
    s.get.mockResolvedValue(unverified());
    await expect(assertGalleryImportReadback(s.services, s.context)).rejects.toThrow(
      'GALLERY_READBACK_UNVERIFIED'
    );
    expect(await galleryCanQueryAllPhotos(s.services, s.context)).toBe(false);
    expect(s.request).not.toHaveBeenCalled();
    expect(s.current).not.toHaveBeenCalled();
  });
  it('does not treat a group-required-only constraint as globally disabled IOP', async () => {
    const s = setup();
    const result = unverified();
    const support = result.items[0]?.protocolSupport;
    if (!support) throw new Error('Missing protocol support');
    support.constraints = ['photo-group-required'];
    s.get.mockResolvedValue(result);
    await expect(assertGalleryImportReadback(s.services, s.context)).resolves.toBeUndefined();
    expect(await galleryCanQueryAllPhotos(s.services, s.context)).toBe(false);
  });
  it.each(['top', 'iop'] as const)(
    'uses the passed %s context, not the other dual-authorization default',
    async (protocol) => {
      const s = setup();
      const bound = { ...s.context, gateway: 'bound-' + protocol };
      s.current.mockResolvedValue({ ...bound, gateway: 'other-default' });
      s.get.mockImplementation((_operations, options) =>
        Promise.resolve(options?.galleryContext?.gateway === 'bound-top' ? allowed() : unverified())
      );
      const check = assertGalleryImportReadback(s.services, bound);
      if (protocol === 'top') await expect(check).resolves.toBeUndefined();
      else await expect(check).rejects.toThrow('GALLERY_READBACK_UNVERIFIED');
      expect(s.get).toHaveBeenCalledExactlyOnceWith(['listPhotos'], { galleryContext: bound });
      expect(s.current).not.toHaveBeenCalled();
    }
  );
  it.each(['bff', 'extension'] as const)('fails closed without %s availability', async (mode) => {
    const s = setup(mode);
    delete s.services.operationAvailability;
    await expect(assertGalleryImportReadback(s.services, s.context)).rejects.toThrow(
      'OPERATION_AVAILABILITY_UNAVAILABLE'
    );
    await expect(s.service.preview(s.input)).rejects.toThrow('OPERATION_AVAILABILITY_UNAVAILABLE');
    expect(s.request).not.toHaveBeenCalled();
  });
  it.each([
    [{ items: [] }, 'OPERATION_AVAILABILITY_UNAVAILABLE'],
    [
      { items: [{ operation: 'uploadPhoto', allowed: true, reasonCode: null }] },
      'OPERATION_AVAILABILITY_UNAVAILABLE'
    ],
    [
      { items: [{ operation: 'listPhotos', allowed: false, reasonCode: null }] },
      'OPERATION_AVAILABILITY_UNAVAILABLE'
    ],
    [{ items: [{ operation: 'listPhotos', allowed: false, reasonCode: 'AUTH_REQUIRED' }] }, 'AUTH_REQUIRED']
  ] as const)('preserves unknown/denied availability reason %#', async (result, code) => {
    const s = setup();
    s.get.mockResolvedValue({ items: result.items.map((item) => ({ ...item })) });
    await expect(s.service.preview(s.input)).rejects.toThrow(code);
    expect(s.request).not.toHaveBeenCalled();
  });
  it('maps unreadable availability to unavailable but preserves a structured context denial', async () => {
    const s = setup();
    s.get.mockRejectedValue(new Error('offline transport'));
    await expect(assertGalleryImportReadback(s.services, s.context)).rejects.toThrow(
      'OPERATION_AVAILABILITY_UNAVAILABLE'
    );
    s.get.mockRejectedValue(
      new GatewayException({ code: 'GALLERY_CONTEXT_CHANGED', message: 'redacted', retryable: false })
    );
    await expect(assertGalleryImportReadback(s.services, s.context)).rejects.toThrow(
      'GALLERY_CONTEXT_CHANGED'
    );
  });
  it('retains mock defaults only when availability is absent; explicit mock denials still apply', async () => {
    const s = setup('mock');
    delete s.services.operationAvailability;
    await expect(assertGalleryImportReadback(s.services, s.context)).resolves.toBeUndefined();
    s.services.operationAvailability = { get: s.get };
    s.get.mockResolvedValue(unverified());
    await expect(assertGalleryImportReadback(s.services, s.context)).rejects.toThrow(
      'GALLERY_READBACK_UNVERIFIED'
    );
  });
});

describe('import preview and persisted mutation boundaries', () => {
  it.each(['zip', 's3'] as const)(
    'rejects %s imports before group scans, directory creation or upload',
    async (storage) => {
      const s = setup();
      s.input.storage = storage;
      s.input.importMapping = 'rules';
      if (storage === 'zip') s.input.archiveBytes = await zipBytes();
      s.get.mockResolvedValue(unverified());
      await expect(s.service.preview(s.input)).rejects.toThrow('GALLERY_READBACK_UNVERIFIED');
      expect(s.get).toHaveBeenCalledExactlyOnceWith(['listPhotos'], { galleryContext: s.context });
      expect(s.request).not.toHaveBeenCalled();
      expect(s.source).not.toHaveBeenCalled();
      expect(s.put).not.toHaveBeenCalled();
      expect(await s.service.repository.list()).toEqual([]);
    }
  );
  it.each(['zip', 's3'] as const)(
    'keeps allowed TOP %s imports bound through upload and readback',
    async (storage) => {
      const s = setup();
      s.input.storage = storage;
      if (storage === 'zip') s.input.archiveBytes = await zipBytes();
      const task = await s.service.preview(s.input);
      await s.service.create(task, s.input.archiveBytes, false);
      expect(s.request.mock.calls.some(([operation]) => operation === 'uploadPhoto')).toBe(false);
      await s.service.run(task.id);
      expect((await s.service.repository.get(task.id)).status).toBe('completed');
      expect(s.request.mock.calls.filter(([operation]) => operation === 'uploadPhoto')).toHaveLength(1);
      for (const [, options] of s.get.mock.calls) expect(options?.galleryContext).toEqual(task.context);
      for (const [, , options] of s.request.mock.calls) expect(options?.galleryContext).toEqual(task.context);
    }
  );
  it.each(['asset', 'group'] as const)(
    'stops a legacy pending %s before preparing or writing',
    async (kind) => {
      const s = setup();
      const { task, asset } = oldTask(s, kind);
      await s.service.create(task, null, false);
      s.request.mockClear();
      s.get.mockResolvedValue(unverified());
      await s.service.run(task.id);
      const stored = await s.service.repository.get(task.id);
      expect(stored.errorCode).toBe('GALLERY_READBACK_UNVERIFIED');
      expect(stored.items[0]).toMatchObject({
        id: asset.id,
        status: 'failed',
        errorCode: 'GALLERY_READBACK_UNVERIFIED',
        requestId: null
      });
      expect(s.request).not.toHaveBeenCalled();
      expect(s.source).not.toHaveBeenCalled();
    }
  );
  it.each(['asset', 'group'] as const)(
    'rechecks availability immediately before prepared %s dispatch',
    async (kind) => {
      const s = setup();
      const { task, asset } = oldTask(s, kind);
      const prepared = await s.driver.prepare(task, asset);
      s.request.mockClear();
      s.get.mockResolvedValue(unverified());
      const result = await s.driver.execute(task, { ...prepared, requestId: crypto.randomUUID() });
      expect(result).toMatchObject({ status: 'failed', errorCode: 'GALLERY_READBACK_UNVERIFIED' });
      expect(s.request).not.toHaveBeenCalled();
      expect(s.get).toHaveBeenCalledTimes(2);
    }
  );
  it('refuses a configuration change between prepare and execute without rebinding the task', async () => {
    const s = setup();
    const { task, asset } = oldTask(s);
    const prepared = await s.driver.prepare(task, asset);
    s.current.mockResolvedValue({ ...s.context, gateway: 'changed-route' });
    s.request.mockClear();
    expect(await s.driver.execute(task, prepared)).toMatchObject({
      status: 'failed',
      errorCode: 'GALLERY_CONTEXT_CHANGED'
    });
    expect(task.context).toEqual(s.context);
    expect(s.request).not.toHaveBeenCalled();
    expect(s.get).toHaveBeenCalledTimes(1);
  });
  it.each(['zip', 's3'] as const)(
    'does not require import availability for %s export preparation or execution',
    async (storage) => {
      const s = setup();
      s.get.mockRejectedValue(new Error('must not be consulted'));
      s.input.direction = 'export';
      s.input.storage = storage;
      s.input.photos = photos.responses.listPhotos.items.slice(0, 1);
      const mock: GatewayClient = new MockGatewayClient(0);
      s.request.mockImplementation((operation, payload, options) => {
        if (operation === 'downloadProductAsset')
          return Promise.resolve({
            fileName: image.fileName,
            contentBase64: image.base64,
            byteLength: s.bytes.length,
            contentType: image.contentType,
            sha256: '0'.repeat(64)
          });
        return mock.request<OperationId>(operation, payload, options);
      });
      const task = await s.service.preview(s.input);
      const asset = task.items.find((item) => item.kind === 'asset');
      if (!asset) throw new Error('Missing export asset');
      const prepared = await s.driver.prepare(task, asset);
      expect((await s.driver.execute(task, prepared)).status).toBe(
        storage === 's3' ? 'unconfirmed' : 'confirmed'
      );
      expect(s.get).not.toHaveBeenCalled();
    }
  );
  it('allows receipt-only verification, then stops before a following pending mutation', async () => {
    const s = setup();
    const { task, asset } = oldTask(s);
    const photo = photos.responses.listPhotos.items[0];
    if (!photo) throw new Error('Missing receipt photo');
    Object.assign(asset, {
      status: 'unknown',
      requestId: crypto.randomUUID(),
      fileId: photo.id,
      targetGroupId: photo.groupId
    });
    const pending = {
      ...asset,
      id: 'next-pending',
      status: 'pending' as const,
      fileId: null,
      requestId: null
    };
    task.items.push(pending);
    await s.service.create(task, null, false);
    s.get.mockResolvedValue(unverified());
    s.get.mockClear();
    s.request.mockClear();
    await s.service.run(task.id, true);
    let stored = await s.service.repository.get(task.id);
    expect(stored.items[0]).toMatchObject({
      status: 'confirmed',
      requestId: asset.requestId,
      fileId: photo.id
    });
    expect(stored.items[1]?.status).toBe('pending');
    expect(s.get).not.toHaveBeenCalled();
    expect(s.request.mock.calls.map(([operation]) => operation)).toEqual(['listPhotos']);
    s.request.mockClear();
    await s.service.run(task.id);
    stored = await s.service.repository.get(task.id);
    expect(stored.items[1]).toMatchObject({ status: 'failed', errorCode: 'GALLERY_READBACK_UNVERIFIED' });
    expect(s.request).not.toHaveBeenCalled();
  });
});

describe('shared template-material import path', () => {
  it('rejects image-bearing template preview via the same gallery preflight', async () => {
    const s = setup();
    s.get.mockResolvedValue(unverified());
    await expect(
      prepareTemplateMaterialImport(s.service, await materialPackage(), '2001', 'Images', () => true)
    ).rejects.toThrow('GALLERY_READBACK_UNVERIFIED');
    expect(s.request).not.toHaveBeenCalled();
  });
  it('keeps image-free JSON imports local without gallery availability or authorization', async () => {
    const s = setup();
    const client = new MemoryProductDescriptionTemplateClient();
    s.services.productDescriptionTemplates = client;
    s.get.mockRejectedValue(new Error('must not be consulted'));
    const plan = await prepareTemplateMaterialImport(
      undefined,
      await materialPackage(false),
      '',
      '',
      () => true
    );
    expect(plan.task).toBeNull();
    expect(
      (await executeTemplateMaterialImport(s.services, undefined, plan, 'copy', () => true)).map(
        (outcome) => outcome.status
      )
    ).toEqual(['created']);
    expect(s.get).not.toHaveBeenCalled();
    expect(s.current).not.toHaveBeenCalled();
    expect(s.request).not.toHaveBeenCalled();
  });
});
