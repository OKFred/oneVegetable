import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { decodeBase64, type GatewaySettings, type RequestOf, type ResponseOf } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { MemoryProductDescriptionTemplateClient } from '../../core/src/product-description-template-client';
import {
  parseTemplateMaterialDocument,
  type TemplateMaterialPackage
} from '@one-vegetable/core/template-materials';
import imageFixture from '../../../mock/data/gallery-task-assets.json';
import photoFixture from '../../../mock/data/photos.json';
import { GalleryTransferService } from '../src/lib/gallery-transfer-service';
import { galleryAssetSha256 } from '../src/lib/gallery-transfer-archive';
import {
  createTemplateMaterialArchive,
  readTemplateMaterialArchive
} from '../src/lib/template-material-archive';
import {
  executeTemplateMaterialImport,
  prepareTemplateMaterialExport,
  prepareTemplateMaterialImport
} from '../src/lib/template-material-transfer';
import type { AppServices } from '../src/lib/services';

const servicesToDispose: GalleryTransferService[] = [];
const unsupported = () => Promise.reject(new Error('Unused offline service'));
const SOURCE_URL = 'https://sc04.alicdn.com/kf/mock-template-runtime-source.png';
const FRESH_URL = 'https://sc04.alicdn.com/kf/mock-template-runtime-fresh.png';
const activeLocks = new Set<string>();
type LockAction = (lock: object | null) => Promise<unknown>;

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('BroadcastChannel', undefined);
  activeLocks.clear();
  const tails = new Map<string, Promise<void>>();
  vi.stubGlobal('navigator', {
    locks: {
      request: async (
        name: string,
        optionsOrAction: { ifAvailable?: boolean } | LockAction,
        suppliedAction?: LockAction
      ) => {
        const action = typeof optionsOrAction === 'function' ? optionsOrAction : suppliedAction;
        if (!action) throw new Error('Missing offline lock callback');
        const previous = tails.get(name);
        if (typeof optionsOrAction !== 'function' && optionsOrAction.ifAvailable && previous)
          return action(null);
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const tail = (previous ?? Promise.resolve()).then(() => gate);
        tails.set(name, tail);
        await previous;
        activeLocks.add(name);
        try {
          return await action({ name });
        } finally {
          activeLocks.delete(name);
          release();
          if (tails.get(name) === tail) tails.delete(name);
        }
      }
    }
  });
});
afterEach(() => {
  for (const service of servicesToDispose.splice(0)) service.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const gateway = new MockGatewayClient(0);
  const context = vi
    .spyOn(gateway, 'galleryTransferContext')
    .mockResolvedValue(structuredClone(photoFixture.transferContext));
  const client = new MemoryProductDescriptionTemplateClient();
  const services: AppServices = {
    gateway,
    mode: 'mock',
    productDescriptionTemplates: client,
    settings: { load: (): Promise<GatewaySettings> => unsupported(), save: unsupported }
  };
  const transfers = new GalleryTransferService(services);
  servicesToDispose.push(transfers);
  const originalRequest = services.gateway.request.bind(services.gateway);
  const request = vi.spyOn(services.gateway, 'request');
  return { gateway, services, transfers, client, context, request, originalRequest };
}

async function materialPackage(withImage = true): Promise<TemplateMaterialPackage> {
  const bytes = decodeBase64(imageFixture.base64);
  const sha256 = await galleryAssetSha256(bytes);
  const path = `assets/${sha256}.png`;
  const document = parseTemplateMaterialDocument(
    new TextEncoder().encode(
      JSON.stringify({
        kind: 'oneVegetable.product-description-template-assets',
        schemaVersion: 1,
        exportedAtUtc: 1_788_793_200_000,
        templates: [
          {
            name: 'Offline material runtime',
            category: 'custom',
            language: 'en_US',
            remark: null,
            html: `<p>Offline runtime</p>${withImage ? `<img src="${path}">` : ''}`
          }
        ],
        assets: withImage
          ? [
              {
                path,
                fileName: imageFixture.fileName,
                contentType: imageFixture.contentType,
                byteLength: bytes.byteLength,
                sha256
              }
            ]
          : []
      })
    )
  );
  return { document, assets: withImage ? [{ path, bytes }] : [] };
}

describe('template material runtime with persistent gallery tasks', () => {
  it('persists the write-ahead receipt before uploading, then uses a fresh verified fileId and URL', async () => {
    const s = setup();
    const pack = await materialPackage();
    const plan = await prepareTemplateMaterialImport(s.transfers, pack, '2001', 'Chosen group', () => true);
    const task = required(plan.task);
    expect(await s.transfers.repository.list()).toEqual([]);
    const create = vi.spyOn(s.client, 'create');
    const original = s.originalRequest;
    let photoReads = 0;
    let uploaded = false;
    s.request.mockImplementation(async (operation, payload, options) => {
      if (operation === 'uploadPhoto') {
        const stored = await s.transfers.repository.get(task.id);
        const receipt = required(stored.items[0]);
        expect(stored.status).toBe('running');
        expect(receipt.status).toBe('running');
        expect(receipt.requestId).toBe(options?.requestId);
        expect(receipt.requestId).toMatch(/^[a-f0-9-]{36}$/u);
        expect(receipt.targetGroupId).toBe('2001');
        expect(JSON.stringify(stored)).not.toContain('contentBase64');
        expect(JSON.stringify(stored)).not.toContain(imageFixture.base64);
        expect(create).not.toHaveBeenCalled();
        uploaded = true;
      }
      const result = await original(operation, payload, options);
      if (operation === 'listPhotos' && uploaded && ++photoReads >= 2) {
        const page = result as ResponseOf<'listPhotos'>;
        return {
          ...page,
          items: page.items.map((photo) =>
            photo.id.startsWith('ph_upload_') ? { ...photo, url: FRESH_URL } : photo
          )
        };
      }
      return result;
    });
    const outcomes = await executeTemplateMaterialImport(s.services, s.transfers, plan, 'copy', () => true);
    expect(outcomes.map((value) => value.status)).toEqual(['created']);
    expect(s.request.mock.calls.filter(([operation]) => operation === 'uploadPhoto')).toHaveLength(1);
    expect(create).toHaveBeenCalledOnce();
    const stored = await s.transfers.repository.get(task.id);
    expect(stored.status).toBe('completed');
    const fileId = required(stored.items[0]).fileId;
    expect(fileId).toMatch(/^ph_upload_/u);
    const html = required(create.mock.calls[0])[0].html;
    expect(html).toContain(FRESH_URL);
    expect(html).toContain(`data-photobank-file-id="${fileId ?? ''}"`);
    expect(html).not.toContain(required(pack.assets[0]).path);
    expect(html).not.toContain(SOURCE_URL);
  });

  it('reuses completed receipts after reload when the same original template ZIP is reselected', async () => {
    const s = setup();
    const originalZip = await createTemplateMaterialArchive(await materialPackage());
    const first = await prepareTemplateMaterialImport(
      s.transfers,
      await readTemplateMaterialArchive(originalZip),
      '2001',
      'Chosen group',
      () => true
    );
    await executeTemplateMaterialImport(s.services, s.transfers, first, 'copy', () => true);
    const uploaded = s.request.mock.calls.filter(([operation]) => operation === 'uploadPhoto').length;
    const reloaded = new GalleryTransferService(s.services);
    servicesToDispose.push(reloaded);
    const second = await prepareTemplateMaterialImport(
      reloaded,
      await readTemplateMaterialArchive(originalZip),
      '2001',
      'Chosen group',
      () => true
    );
    expect(second.task?.id).toBe(first.task?.id);
    expect(second.task?.archiveSha256).toBe(first.task?.archiveSha256);
    expect(second.task?.status).toBe('completed');
    await executeTemplateMaterialImport(s.services, reloaded, second, 'copy', () => true);
    expect(s.request.mock.calls.filter(([operation]) => operation === 'uploadPhoto')).toHaveLength(uploaded);
    expect(await reloaded.repository.list()).toHaveLength(1);
    expect((await s.client.list()).items).toHaveLength(2);
  });

  it('attaches the original template ZIP to a persisted pending gallery task after reload', async () => {
    const s = setup();
    const originalZip = await createTemplateMaterialArchive(await materialPackage());
    const plan = await prepareTemplateMaterialImport(
      s.transfers,
      await readTemplateMaterialArchive(originalZip),
      '2001',
      'Chosen group',
      () => true
    );
    const task = required(plan.task);
    await s.transfers.create(task, required(plan.archiveBytes), false);
    const reloaded = new GalleryTransferService(s.services);
    servicesToDispose.push(reloaded);
    await reloaded.driver.attachArchive(task, originalZip);
    await reloaded.run(task.id);
    expect((await reloaded.repository.get(task.id)).status).toBe('completed');
    expect(s.request.mock.calls.filter(([operation]) => operation === 'uploadPhoto')).toHaveLength(1);
  });

  it.each(['unknown', 'unconfirmed', 'running'] as const)(
    'never resends a persisted %s write without a confirmed fileId',
    async (status) => {
      const s = setup();
      const plan = await prepareTemplateMaterialImport(
        s.transfers,
        await materialPackage(),
        '2001',
        'Chosen group',
        () => true
      );
      const task = required(plan.task);
      await s.transfers.create(task, required(plan.archiveBytes), false);
      const requestId = crypto.randomUUID();
      await s.transfers.repository.update(task.id, (current) => {
        current.status = 'attention';
        Object.assign(required(current.items[0]), { status, requestId, fileId: null });
      });
      const run = vi.spyOn(s.transfers, 'run');
      const create = vi.spyOn(s.client, 'create');
      s.request.mockClear();
      await expect(
        executeTemplateMaterialImport(s.services, s.transfers, plan, 'copy', () => true)
      ).rejects.toThrow('TEMPLATE_MATERIAL_UNCONFIRMED');
      expect(run).toHaveBeenCalledWith(task.id, true);
      expect(s.request.mock.calls.filter(([operation]) => operation === 'uploadPhoto')).toHaveLength(0);
      expect(create).not.toHaveBeenCalled();
      expect(required((await s.transfers.repository.get(task.id)).items[0]).requestId).toBe(requestId);
    }
  );

  it('queries a previously sent upload with a known fileId instead of reuploading it', async () => {
    const s = setup();
    const plan = await prepareTemplateMaterialImport(
      s.transfers,
      await materialPackage(),
      '2001',
      'Chosen group',
      () => true
    );
    const task = required(plan.task);
    await executeTemplateMaterialImport(s.services, s.transfers, plan, 'copy', () => true);
    await s.transfers.repository.update(task.id, (current) => {
      current.status = 'attention';
      required(current.items[0]).status = 'unknown';
    });
    const run = vi.spyOn(s.transfers, 'run');
    s.request.mockClear();
    await executeTemplateMaterialImport(s.services, s.transfers, plan, 'copy', () => true);
    expect(run).toHaveBeenCalledWith(task.id, true);
    expect(s.request.mock.calls.filter(([operation]) => operation === 'uploadPhoto')).toHaveLength(0);
    expect(s.request.mock.calls.some(([operation]) => operation === 'listPhotos')).toBe(true);
    expect((await s.transfers.repository.get(task.id)).status).toBe('completed');
  });

  it('reuses an unknown receipt from the first of two stale previews without a second upload', async () => {
    const s = setup();
    const pack = await materialPackage();
    const first = await prepareTemplateMaterialImport(s.transfers, pack, '2001', 'Chosen group', () => true);
    const second = await prepareTemplateMaterialImport(s.transfers, pack, '2001', 'Chosen group', () => true);
    expect(first.task?.id).not.toBe(second.task?.id);
    expect(first.task?.archiveSha256).toBe(second.task?.archiveSha256);
    expect(await s.transfers.repository.list()).toEqual([]);
    s.request.mockImplementation(async (operation, payload, options) => {
      if (operation === 'uploadPhoto') {
        expect(activeLocks.has('one-vegetable.template-material.import-claim.v1')).toBe(false);
        expect(activeLocks.has('one-vegetable.gallery-transfer.executor.v1')).toBe(true);
        await s.originalRequest(operation, payload as RequestOf<'uploadPhoto'>, options);
        throw new Error('Offline response lost after upload');
      }
      return s.originalRequest(operation, payload, options);
    });
    const create = vi.spyOn(s.client, 'create');
    const run = vi.spyOn(s.transfers, 'run');
    await expect(
      executeTemplateMaterialImport(s.services, s.transfers, first, 'copy', () => true)
    ).rejects.toThrow('TEMPLATE_MATERIAL_UNCONFIRMED');
    const originalReceipt = await s.transfers.repository.get(required(first.task).id);
    expect(required(originalReceipt.items[0]).status).toBe('unknown');
    await expect(
      executeTemplateMaterialImport(s.services, s.transfers, second, 'copy', () => true)
    ).rejects.toThrow('TEMPLATE_MATERIAL_UNCONFIRMED');
    expect(run).toHaveBeenLastCalledWith(originalReceipt.id, true);
    expect(s.request.mock.calls.filter(([operation]) => operation === 'uploadPhoto')).toHaveLength(1);
    const receipts = await s.transfers.repository.list();
    expect(receipts).toHaveLength(1);
    expect(required(receipts[0]).id).toBe(originalReceipt.id);
    expect(required(required(receipts[0]).items[0]).requestId).toBe(
      required(originalReceipt.items[0]).requestId
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps a matching cancelled receipt unconfirmed and never creates a replacement task', async () => {
    const s = setup();
    const pack = await materialPackage();
    const plan = await prepareTemplateMaterialImport(s.transfers, pack, '2001', 'Chosen group', () => true);
    const task = required(plan.task);
    await s.transfers.create(task, required(plan.archiveBytes), false);
    await s.transfers.repository.update(task.id, (current) => {
      current.status = 'cancelled';
    });
    const reused = await prepareTemplateMaterialImport(s.transfers, pack, '2001', 'Chosen group', () => true);
    expect(reused.task?.id).toBe(task.id);
    const run = vi.spyOn(s.transfers, 'run');
    const create = vi.spyOn(s.client, 'create');
    s.request.mockClear();
    await expect(
      executeTemplateMaterialImport(s.services, s.transfers, reused, 'copy', () => true)
    ).rejects.toThrow('TEMPLATE_MATERIAL_UNCONFIRMED');
    expect(run).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(s.request.mock.calls.filter(([operation]) => operation === 'uploadPhoto')).toHaveLength(0);
    expect(await s.transfers.repository.list()).toHaveLength(1);
  });

  it('skips an all-conflicting bundle without persisting tasks, uploading images or creating templates', async () => {
    const s = setup();
    const pack = await materialPackage();
    const template = required(pack.document.templates[0]);
    await s.client.create({ ...template, html: '<p>Existing template</p>' });
    const plan = await prepareTemplateMaterialImport(s.transfers, pack, '2001', 'Chosen group', () => true);
    const createTask = vi.spyOn(s.transfers, 'create');
    const create = vi.spyOn(s.client, 'create');
    const run = vi.spyOn(s.transfers, 'run');
    s.request.mockClear();
    expect(await executeTemplateMaterialImport(s.services, s.transfers, plan, 'skip', () => true)).toEqual([
      { name: template.name, status: 'skipped', error: null }
    ]);
    expect(createTask).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(s.request).not.toHaveBeenCalled();
    expect(await s.transfers.repository.list()).toEqual([]);
  });

  it('imports image-free templates without gallery, group selection or any image writes', async () => {
    const s = setup();
    const plan = await prepareTemplateMaterialImport(
      undefined,
      await materialPackage(false),
      '',
      '',
      () => true
    );
    expect(plan.task).toBeNull();
    expect(plan.archiveBytes).toBeNull();
    expect(plan.context).toBeNull();
    expect(
      (await executeTemplateMaterialImport(s.services, undefined, plan, 'copy', () => true)).map(
        (value) => value.status
      )
    ).toEqual(['created']);
    expect(s.request).not.toHaveBeenCalled();
    expect(s.context).not.toHaveBeenCalled();
    expect(await s.transfers.repository.list()).toEqual([]);
  });

  it.each(['isCurrent', 'identity', 'gateway', 'storage'] as const)(
    'makes no outgoing operation after %s changes before execution',
    async (changed) => {
      const s = setup();
      const plan = await prepareTemplateMaterialImport(
        s.transfers,
        await materialPackage(),
        '2001',
        'Chosen group',
        () => true
      );
      if (changed !== 'isCurrent')
        s.context.mockResolvedValue({ ...photoFixture.transferContext, [changed]: `changed-${changed}` });
      s.request.mockClear();
      const create = vi.spyOn(s.client, 'create');
      await expect(
        executeTemplateMaterialImport(s.services, s.transfers, plan, 'copy', () => changed !== 'isCurrent')
      ).rejects.toThrow('TEMPLATE_CONTEXT_CHANGED');
      expect(s.request).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(await s.transfers.repository.list()).toEqual([]);
    }
  );

  it('stops before outgoing preview reads when the caller becomes stale during asynchronous packing', async () => {
    const s = setup();
    const pack = await materialPackage();
    let current = true;
    const preparing = prepareTemplateMaterialImport(s.transfers, pack, '2001', 'Chosen group', () => current);
    current = false;
    await expect(preparing).rejects.toThrow('TEMPLATE_CONTEXT_CHANGED');
    expect(s.context).not.toHaveBeenCalled();
    expect(s.request).not.toHaveBeenCalled();
    expect(await s.transfers.repository.list()).toEqual([]);
  });

  it('rechecks context before each template creation and stops after a first-create context change', async () => {
    const s = setup();
    const pack = await materialPackage();
    pack.document.templates.push({
      ...required(pack.document.templates[0]),
      name: 'Second runtime template'
    });
    const plan = await prepareTemplateMaterialImport(s.transfers, pack, '2001', 'Chosen group', () => true);
    const original = s.client.create.bind(s.client);
    const create = vi.spyOn(s.client, 'create').mockImplementationOnce(async (input) => {
      const created = await original(input);
      s.context.mockResolvedValue({
        ...photoFixture.transferContext,
        identity: 'changed-after-first-template'
      });
      return created;
    });
    const result = await executeTemplateMaterialImport(s.services, s.transfers, plan, 'copy', () => true);
    expect(create).toHaveBeenCalledOnce();
    expect(result.map((value) => value.status)).toEqual(['created', 'failed']);
    expect(result[1]?.error).toMatchObject({ gatewayError: { code: 'TEMPLATE_CONTEXT_CHANGED' } });
    expect((await s.client.list()).items).toHaveLength(1);
  });

  it('deduplicates downloaded content and removes original URLs and photo IDs from exported metadata', async () => {
    const s = setup();
    const template = await s.client.create({
      name: 'Export fixture',
      category: 'custom',
      language: 'en_US',
      html: `<p>Export</p><img src="${SOURCE_URL}" data-photobank-file-id="old-fixture-id"><img src="${SOURCE_URL}">`
    });
    const bytes = decodeBase64(imageFixture.base64);
    const sha256 = await galleryAssetSha256(bytes);
    s.request.mockImplementation((operation) => {
      if (operation !== 'downloadProductAsset') throw new Error(`Unexpected offline operation: ${operation}`);
      return Promise.resolve({
        fileName: imageFixture.fileName,
        contentBase64: imageFixture.base64,
        contentType: imageFixture.contentType,
        byteLength: bytes.byteLength,
        sha256
      });
    });
    const exported = await prepareTemplateMaterialExport(s.services, [template], () => true);
    expect(exported.package.assets).toHaveLength(1);
    expect(s.request).toHaveBeenCalledOnce();
    expect(JSON.stringify(exported.package.document)).not.toContain(SOURCE_URL);
    expect(JSON.stringify(exported.package.document)).not.toContain('old-fixture-id');
    expect(required(exported.package.document.templates[0]).html.match(/assets\//gu)).toHaveLength(2);
    expect(exported.context).toEqual(photoFixture.transferContext);
  });

  it('does not download or create an export result for an already stale caller', async () => {
    const s = setup();
    const template = await s.client.create({
      name: 'Stale export fixture',
      category: 'custom',
      language: 'en_US',
      html: `<img src="${SOURCE_URL}">`
    });
    await expect(prepareTemplateMaterialExport(s.services, [template], () => false)).rejects.toThrow(
      'TEMPLATE_CONTEXT_CHANGED'
    );
    expect(s.request).not.toHaveBeenCalled();
    expect(s.context).not.toHaveBeenCalled();
  });
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing offline fixture value');
  return value;
}
