import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  isProductMutationJobPage,
  type ProductMutationJob,
  type ProductMutationJobPage,
  type ProductMutationJobClient,
  type ControlClient
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { GatewayException } from '@one-vegetable/core/errors';
import {
  validateGalleryTransferTask,
  type GalleryTransferContext
} from '@one-vegetable/core/gallery-transfer-task';
import {
  validateVideoUploadResult,
  type VideoUploadResult,
  type VideoUploadControl,
  type VideoUploadTask
} from '@one-vegetable/core/video-upload';
import type { S3StorageControl } from '@one-vegetable/core/s3-storage';
import fixture from '../../../mock/data/task-center/snapshot.json';
import type { AppServices } from '../src/lib/services';
import { VIDEO_ASSOCIATION_PREFIX } from '../src/lib/video-association-storage';
import { IndexedDbGalleryTaskRepository } from '../src/lib/gallery-task-repository';
import {
  TaskCenterError,
  bindTaskBatchItems,
  loadTaskCenterSnapshot,
  mapGalleryTask,
  mapProductTask,
  mapVideoAssociationTask,
  mapVideoUploadTask,
  parseVideoAssociationReceipt,
  taskContextStamp,
  taskErrorCode,
  taskGuidance,
  taskReasonCode,
  type TaskState
} from '../src/lib/task-center';

const QUEUE_KEY = 'one-vegetable-product-batch-publish-v2';
const LEGACY_QUEUE_KEY = 'one-vegetable-product-batch-publish-v1';
const context: GalleryTransferContext = fixture.context;

function productPage(): ProductMutationJobPage {
  const result: unknown = structuredClone(fixture.productPage);
  if (!isProductMutationJobPage(result)) throw new Error('invalid product fixture');
  return result;
}
function product(): ProductMutationJob {
  const job = productPage().items[0];
  if (!job) throw new Error('missing product fixture');
  return job;
}
function gallery() {
  return validateGalleryTransferTask(structuredClone(fixture.gallery[0]));
}
function uploadResult(): VideoUploadResult {
  const value: unknown = structuredClone(fixture.videoUploads);
  if (!validateVideoUploadResult(value)) throw new Error('invalid upload fixture');
  return value as VideoUploadResult;
}
function upload(): VideoUploadTask {
  const task = uploadResult().tasks[0];
  if (!task) throw new Error('missing upload fixture');
  return task;
}
function receipt() {
  return parseVideoAssociationReceipt(structuredClone(fixture.associationReceipt), '1600000000001');
}
function associationKey(scope = context, mode = 'bff', productId = '1600000000001') {
  return (
    VIDEO_ASSOCIATION_PREFIX +
    JSON.stringify([mode, JSON.stringify([scope.identity, scope.gateway]), productId])
  );
}
function readonlyStorage(entries: Record<string, string> = {}) {
  const data = new Map(Object.entries(entries));
  return {
    get length() {
      return data.size;
    },
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    key: vi.fn((index: number) => [...data.keys()][index] ?? null),
    setItem: vi.fn(() => {
      throw new Error('unexpected storage write');
    }),
    removeItem: vi.fn(() => {
      throw new Error('unexpected storage delete');
    }),
    clear: vi.fn(() => {
      throw new Error('unexpected storage clear');
    })
  } satisfies Storage;
}
function setup(entries: Record<string, string> = {}) {
  const gateway = new MockGatewayClient(0);
  const getContext = vi.spyOn(gateway, 'galleryTransferContext').mockResolvedValue({ ...context });
  const request = vi.spyOn(gateway, 'request');
  const jobs = {
    list: vi.fn<ProductMutationJobClient['list']>().mockResolvedValue(productPage()),
    get: vi.fn(),
    refresh: vi.fn(),
    recover: vi.fn()
  };
  const videoUpload = vi.fn<VideoUploadControl['videoUpload']>().mockResolvedValue(uploadResult());
  const repository = { list: vi.fn().mockResolvedValue([gallery()]) };
  const storage = readonlyStorage({
    [QUEUE_KEY]: JSON.stringify(fixture.queue),
    [associationKey()]: JSON.stringify(fixture.associationReceipt),
    ...entries
  });
  const services: AppServices = {
    gateway,
    mode: 'bff',
    settings: { load: vi.fn(), save: vi.fn() },
    productMutationJobs: jobs,
    videoUploads: { videoUpload }
  };
  return { services, gateway, getContext, request, jobs, videoUpload, repository, storage };
}

describe('task center pure mappings', () => {
  it('distinguishes workbench-visible product history from known Alibaba account ownership', () => {
    const productItem = mapProductTask(product());
    const linked = bindTaskBatchItems(readonlyStorage({ [QUEUE_KEY]: JSON.stringify(fixture.queue) }), [
      productItem
    ]);
    expect(linked.items[0]).toMatchObject({ accountMatch: 'unknown', batchItemId: 'bound-batch-item' });
    expect(productItem).not.toHaveProperty('batchItemId');
    expect(mapGalleryTask(gallery(), context)?.accountMatch).toBe('matched');
    expect(mapVideoUploadTask(upload(), context)?.accountMatch).toBe('matched');
    for (const mapper of [
      () => mapGalleryTask(gallery(), { ...context, gateway: 'new' }),
      () => mapVideoUploadTask(upload(), { ...context, gateway: 'new' })
    ])
      expect(mapper()).toMatchObject({ accountMatch: 'changed', contextChanged: true });
    // Storage is configuration, not a different Alibaba account.
    expect(mapGalleryTask(gallery(), { ...context, storage: 'new' })).toMatchObject({
      accountMatch: 'matched',
      contextChanged: true
    });
    expect(mapVideoAssociationTask(receipt()).accountMatch).toBe('matched');
  });

  it('exports operation keys and numbered steps aligned with task-center translations', () => {
    expect(mapGalleryTask({ ...gallery(), direction: 'import', storage: 'zip' }, context)?.operation).toBe(
      'import-zip'
    );
    expect(mapGalleryTask({ ...gallery(), direction: 'export', storage: 's3' }, context)?.operation).toBe(
      'export-s3'
    );
    for (const source of ['file', 'url'] as const)
      expect(mapVideoUploadTask({ ...upload(), source }, context)?.operation).toBe(source);
    for (const type of ['main', 'detail'] as const)
      expect(
        mapVideoAssociationTask({ ...receipt(), request: { ...receipt().request, type } }).operation
      ).toBe(type);
    expect(mapVideoUploadTask(upload(), context)?.steps[0]?.label).toBe('part-1');
  });

  it('does not confirm contradictory video receipts allowed by the structural validator', () => {
    const confirmed = { ...upload(), status: 'confirmed' as const, videoId: '7001', reasonCode: null };
    expect(mapVideoUploadTask(confirmed, context)?.status).toBe('confirmed');
    for (const videoId of [null, '', '0', 'not-a-video', 'https://private.invalid/']) {
      expect(mapVideoUploadTask({ ...confirmed, videoId }, context)).toMatchObject({
        status: 'attention',
        rawStatus: 'confirmed',
        guidance: 'verify',
        reasonCode: 'VIDEO_CONFIRMATION_INVALID'
      });
    }
    for (const status of ['pending', 'in-flight', 'unknown'] as const)
      expect(
        mapVideoUploadTask(
          { ...confirmed, parts: confirmed.parts.map((part) => ({ ...part, status })) },
          context
        )
      ).toMatchObject({ status: 'attention', rawStatus: 'confirmed', guidance: 'verify' });
  });

  it('keeps a clean cancellation cancelled and never mutates its persisted state', () => {
    const task = { ...gallery(), status: 'cancelled' as const };
    task.items.forEach((item) => {
      item.status = 'confirmed';
    });
    const original = structuredClone(task);
    expect(mapGalleryTask(task, context)?.status).toBe('cancelled');
    expect(task).toEqual(original);
  });

  it('keeps only strict error codes from gateway, code and message without leaking free text', () => {
    expect(
      taskErrorCode(
        new GatewayException({ code: 'AUTHENTICATION_REQUIRED', message: 'private-secret', retryable: false })
      )
    ).toBe('AUTHENTICATION_REQUIRED');
    expect(taskErrorCode(Object.assign(new Error('private-secret'), { code: 'VAULT_LOCKED' }))).toBe(
      'VAULT_LOCKED'
    );
    expect(taskErrorCode(new Error('PERMISSION_DENIED'))).toBe('PERMISSION_DENIED');
    expect(taskErrorCode(new Error('PERMISSION_DENIED https://private.invalid/'))).toBe(
      'TASK_SOURCE_UNAVAILABLE'
    );
    expect(taskErrorCode({ code: 'data:text/plain;base64,c2VjcmV0', message: 'private' })).toBe(
      'TASK_SOURCE_UNAVAILABLE'
    );
  });

  it('uses an unambiguous context stamp independent of property insertion order', () => {
    expect(taskContextStamp(context)).toBe(
      taskContextStamp({ storage: context.storage, gateway: context.gateway, identity: context.identity })
    );
    expect(taskContextStamp({ identity: 'a,b', gateway: 'c', storage: null })).not.toBe(
      taskContextStamp({ identity: 'a', gateway: 'b,c', storage: null })
    );
    expect(taskContextStamp(context)).not.toBe(taskContextStamp({ ...context, storage: null }));
  });

  it.each<[ProductMutationJob['status'], TaskState]>([
    ['submitted', 'submitted'],
    ['auditing', 'submitted'],
    ['verifying', 'submitted'],
    ['verified', 'confirmed'],
    ['recovery-required', 'attention'],
    ['recovering', 'running'],
    ['recovered', 'cancelled'],
    ['failed', 'failed']
  ])('maps product %s to %s without mistaking acceptance or rollback for confirmation', (raw, expected) => {
    const item = mapProductTask({ ...product(), status: raw });
    expect(item).toMatchObject({
      source: 'product',
      status: expected,
      rawStatus: raw,
      title: '',
      operation: 'publishProduct',
      lastCheckedAt: 1790000000100
    });
    expect(item.id).toBe(`product:${item.sourceId}`);
  });

  it('prioritizes unknown/unconfirmed gallery steps over the parent completed state', () => {
    const task = gallery();
    task.status = 'completed';
    expect(mapGalleryTask(task, context)).toMatchObject({ status: 'attention', guidance: 'verify' });
    for (const item of task.items) item.status = 'unconfirmed';
    expect(mapGalleryTask(task, context)).toMatchObject({ status: 'submitted', guidance: 'verify' });
    for (const item of task.items) item.status = 'confirmed';
    expect(mapGalleryTask(task, context)?.status).toBe('confirmed');
    task.items = [];
    expect(mapGalleryTask(task, context)?.status).toBe('attention');
  });

  it.each(['unknown', 'unconfirmed', 'running'] as const)(
    'preserves cancellation and a warning for gallery %s steps',
    (status) => {
      const task = gallery();
      task.status = 'cancelled';
      task.items.forEach((item) => {
        item.status = status;
      });
      expect(mapGalleryTask(task, context)).toMatchObject({
        status: 'attention',
        rawStatus: 'cancelled',
        guidance: 'verify'
      });
      expect(mapGalleryTask(task, context)?.reasonCode).not.toBeNull();
    }
  );

  it('filters gallery identities and marks gateway/storage mismatches without mutating the task', () => {
    const task = gallery(),
      original = structuredClone(task);
    expect(mapGalleryTask(task, { ...context, identity: 'other' })).toBeNull();
    for (const field of ['gateway', 'storage'] as const)
      expect(mapGalleryTask(task, { ...context, [field]: 'other' })).toMatchObject({
        contextChanged: true,
        guidance: 'configuration'
      });
    expect(task).toEqual(original);
  });

  it.each<[VideoUploadTask['status'], TaskState]>([
    ['prepared', 'pending'],
    ['staging', 'running'],
    ['staged', 'pending'],
    ['submitting', 'attention'],
    ['accepted', 'submitted'],
    ['needs-review', 'attention'],
    ['confirmed', 'confirmed'],
    ['cancelled', 'cancelled'],
    ['failed', 'failed']
  ])('maps video upload %s to %s', (raw, expected) => {
    const item = mapVideoUploadTask({ ...upload(), status: raw, reasonCode: null, videoId: '7001' }, context);
    expect(item).toMatchObject({ status: expected, rawStatus: raw });
    expect(item?.lastCheckedAt).toBeNull();
  });

  it('scopes uploads and only gives verification success to a confirmed receipt', () => {
    expect(mapVideoUploadTask(upload(), { ...context, identity: 'other' })).toBeNull();
    expect(mapVideoUploadTask(upload(), { ...context, storage: null })).toMatchObject({
      contextChanged: true,
      guidance: 'configuration'
    });
    const saved = receipt(),
      original = structuredClone(saved);
    expect(mapVideoAssociationTask(saved)).toMatchObject({
      status: 'attention',
      rawStatus: 'sending',
      guidance: 'verify'
    });
    expect(saved).toEqual(original);
    for (const outcome of ['confirmed', 'unconfirmed', 'rejected', 'unknown'] as const) {
      expect(mapVideoAssociationTask({ ...saved, state: outcome, outcome }).status).toBe(
        { confirmed: 'confirmed', unconfirmed: 'submitted', rejected: 'failed', unknown: 'attention' }[
          outcome
        ]
      );
    }
  });

  it.each([
    'https://example.invalid/?X-Amz-Signature=secret',
    'data:video/mp4;base64,c2VjcmV0',
    'failed: private message',
    'CODE\nsecret'
  ])('does not forward free-form reason text %s', (value) => {
    expect(taskReasonCode(value)).toBeNull();
    expect(
      mapProductTask({ ...product(), reasonCode: value, traceId: value, requestId: value, productId: value })
    ).toMatchObject({ reasonCode: null, traceId: null, requestId: null, resourceId: null });
    expect(
      mapVideoUploadTask({ ...upload(), reasonCode: value, title: value }, context)?.reasonCode
    ).toBeNull();
  });

  it.each([
    ['VAULT_LOCKED', 'unlock'],
    ['AUTHENTICATION_FAILED', 'login'],
    ['PERMISSION_DENIED', 'permission'],
    ['S3_NOT_CONFIGURED', 'configuration'],
    ['VIDEO_FILE_CHANGED', 'file'],
    ['VIDEO_PENDING_READBACK', 'verify']
  ] as const)('gives stable guidance for %s', (code, expected) => {
    expect(taskGuidance(code, 'attention')).toBe(expected);
  });

  it('checks association request/result validators and consistent receipt states', () => {
    for (const malformed of [
      { ...fixture.associationReceipt, state: 'confirmed' },
      { ...fixture.associationReceipt, outcome: 'surprise' },
      { ...fixture.associationReceipt, updatedAt: -1 },
      {
        ...fixture.associationReceipt,
        request: { ...fixture.associationReceipt.request, videoId: 'https://example.invalid/' }
      },
      {
        ...fixture.associationReceipt,
        request: { ...fixture.associationReceipt.request, productId: '9999' }
      },
      {
        ...fixture.associationReceipt,
        request: { ...fixture.associationReceipt.request, contentBase64: 'secret' }
      }
    ])
      expect(() => parseVideoAssociationReceipt(malformed, '1600000000001')).toThrow(
        'TASK_ASSOCIATION_INVALID'
      );
  });
});

describe('task center read-only snapshot', () => {
  it('can seed the raw gallery fixture into the real repository without model-specific transformation', async () => {
    const s = setup();
    const repository = new IndexedDbGalleryTaskRepository(new IDBFactory());
    for (const task of fixture.gallery)
      await repository.create(validateGalleryTransferTask(structuredClone(task)));
    const result = await loadTaskCenterSnapshot(s.services, repository, s.storage);
    expect(result.items.filter((item) => item.source === 'gallery')).toHaveLength(fixture.gallery.length);
    expect(result.errors).toEqual([]);
    expect(await repository.get('gallery-task-1')).toEqual(fixture.gallery[0]);
  });

  it.each(['AUTHENTICATION_REQUIRED', 'VAULT_LOCKED', 'PERMISSION_DENIED'])(
    'retains actionable source error %s and successful sources',
    async (code) => {
      const s = setup();
      s.jobs.list.mockRejectedValue(
        new GatewayException({ code, message: 'private-provider-secret', retryable: false })
      );
      const result = await loadTaskCenterSnapshot(s.services, s.repository, s.storage);
      expect(result.errors).toContainEqual({ source: 'product', code });
      expect(result.items).toHaveLength(3);
      expect(JSON.stringify(result)).not.toContain('private-provider-secret');
    }
  );

  it('loads all four sources without invoking mutation, verification, recovery or storage writes', async () => {
    const s = setup();
    const snapshot = await loadTaskCenterSnapshot(s.services, s.repository, s.storage);
    expect(snapshot.items.map((item) => item.source)).toEqual([
      'video-association',
      'video-upload',
      'gallery',
      'product'
    ]);
    expect(snapshot.items.find((item) => item.source === 'product')).toMatchObject({
      batchItemId: 'bound-batch-item',
      title: ''
    });
    expect(snapshot).toMatchObject({ context, errors: [], productHasMore: false, unscopedQueueCount: 1 });
    expect(s.getContext).toHaveBeenCalledTimes(2);
    expect(s.jobs.list).toHaveBeenCalledExactlyOnceWith({ page: 1, pageSize: 100 });
    expect(s.videoUpload).toHaveBeenCalledExactlyOnceWith({ action: 'list' }, context);
    for (const operation of [
      s.request,
      s.jobs.get,
      s.jobs.refresh,
      s.jobs.recover,
      s.storage.setItem,
      s.storage.removeItem,
      s.storage.clear
    ])
      expect(operation).not.toHaveBeenCalled();
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('private-');
    expect(serialized).not.toContain('https:');
    expect(serialized).not.toContain('base64');
    expect(serialized).not.toContain('<private>');
  });

  it('uses a real mock gateway context, but never invents one when missing', async () => {
    const s = setup();
    s.getContext.mockRestore();
    const expected = await s.gateway.galleryTransferContext();
    expect((await loadTaskCenterSnapshot(s.services, s.repository, s.storage)).context).toEqual(expected);
    for (const mode of ['mock', 'bff', 'extension'] as const) {
      s.services.mode = mode;
      s.services.gateway = { request: vi.fn() };
      await expect(loadTaskCenterSnapshot(s.services, s.repository, s.storage)).rejects.toMatchObject({
        code: 'TASK_CONTEXT_UNAVAILABLE'
      });
    }
  });

  it('rejects malformed/unavailable initial context before starting source reads', async () => {
    for (const value of [{ ...context, identity: '' }, { ...context, secret: 'private' }, null]) {
      const s = setup();
      s.getContext.mockResolvedValue(value as GalleryTransferContext);
      await expect(loadTaskCenterSnapshot(s.services, s.repository, s.storage)).rejects.toBeInstanceOf(
        TaskCenterError
      );
      expect(s.jobs.list).not.toHaveBeenCalled();
      expect(s.repository.list).not.toHaveBeenCalled();
    }
    const s = setup();
    s.getContext.mockRejectedValue(new Error('https://private.invalid/'));
    await expect(loadTaskCenterSnapshot(s.services, s.repository, s.storage)).rejects.toThrow(
      'TASK_CONTEXT_UNAVAILABLE'
    );
  });

  it.each(['identity', 'gateway', 'storage'] as const)(
    'discards every source if %s changes during the batch',
    async (field) => {
      const s = setup();
      s.getContext
        .mockResolvedValueOnce({ ...context })
        .mockResolvedValueOnce({ ...context, [field]: 'other' });
      await expect(loadTaskCenterSnapshot(s.services, s.repository, s.storage)).rejects.toMatchObject({
        code: 'TASK_CONTEXT_CHANGED'
      });
      expect(s.jobs.list).toHaveBeenCalledTimes(1);
      expect(s.repository.list).toHaveBeenCalledTimes(1);
    }
  );

  it('detects mutation of the gateway-owned context object, and waits for the slowest source', async () => {
    const s = setup(),
      shared = { ...context };
    let finish: (result: VideoUploadResult) => void = () => {
      throw new Error('not started');
    };
    s.getContext.mockResolvedValue(shared);
    s.videoUpload.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const loading = loadTaskCenterSnapshot(s.services, s.repository, s.storage);
    await vi.waitFor(() => {
      expect(s.videoUpload).toHaveBeenCalledTimes(1);
    });
    expect(s.getContext).toHaveBeenCalledTimes(1);
    shared.gateway = 'changed';
    finish(uploadResult());
    await expect(loading).rejects.toThrow('TASK_CONTEXT_CHANGED');
  });

  it('rejects stale generations before reads and after the batch, including during final context read', async () => {
    const s = setup();
    await expect(loadTaskCenterSnapshot(s.services, s.repository, s.storage, () => false)).rejects.toThrow(
      'TASK_CONTEXT_CHANGED'
    );
    expect(s.getContext).not.toHaveBeenCalled();
    let current = true;
    s.getContext.mockImplementationOnce(() => {
      current = false;
      return Promise.resolve({ ...context });
    });
    await expect(loadTaskCenterSnapshot(s.services, s.repository, s.storage, () => current)).rejects.toThrow(
      'TASK_CONTEXT_CHANGED'
    );
    expect(s.jobs.list).not.toHaveBeenCalled();
    current = true;
    s.getContext.mockResolvedValueOnce({ ...context }).mockImplementationOnce(() => {
      current = false;
      return Promise.resolve({ ...context });
    });
    await expect(loadTaskCenterSnapshot(s.services, s.repository, s.storage, () => current)).rejects.toThrow(
      'TASK_CONTEXT_CHANGED'
    );
  });

  it('rejects when final context becomes unavailable even if all sources succeed', async () => {
    const s = setup();
    s.getContext.mockResolvedValueOnce({ ...context }).mockRejectedValueOnce(new Error('private failure'));
    await expect(loadTaskCenterSnapshot(s.services, s.repository, s.storage)).rejects.toThrow(
      'TASK_CONTEXT_UNAVAILABLE'
    );
  });

  it.each(['product', 'gallery', 'video-upload'] as const)(
    'keeps other sources on an independent %s failure and does not leak the error',
    async (source) => {
      const s = setup();
      ({ product: s.jobs.list, gallery: s.repository.list, 'video-upload': s.videoUpload })[
        source
      ].mockRejectedValue(new Error('private-provider-message https://private.invalid/'));
      const result = await loadTaskCenterSnapshot(s.services, s.repository, s.storage);
      expect(result.items).toHaveLength(3);
      expect(result.items.some((item) => item.source === source)).toBe(false);
      expect(result.errors).toEqual([{ source, code: 'TASK_SOURCE_UNAVAILABLE' }]);
      expect(JSON.stringify(result)).not.toContain('private');
      if (source === 'product') expect(result.unscopedQueueCount).toBe(2);
    }
  );

  it('tolerates storage being unavailable independently of remote and gallery sources', async () => {
    const s = setup();
    s.storage.key.mockImplementation(() => {
      throw new Error('private');
    });
    s.storage.getItem.mockImplementation(() => {
      throw new Error('private');
    });
    const result = await loadTaskCenterSnapshot(s.services, s.repository, s.storage);
    expect(result.items).toHaveLength(3);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { source: 'video-association', code: 'TASK_SOURCE_UNAVAILABLE' },
        { source: 'product', code: 'TASK_QUEUE_INVALID' }
      ])
    );
  });

  it.each([
    [1, 101, true],
    [2, 201, true],
    [2, 200, false]
  ] as const)(
    'explicitly loads page %i with total %i and hasMore=%s, without a paging loop',
    async (page, total, hasMore) => {
      const s = setup();
      s.jobs.list.mockResolvedValue({ ...productPage(), page, total });
      const result = await loadTaskCenterSnapshot(s.services, s.repository, s.storage, () => true, page);
      expect(result.productHasMore).toBe(hasMore);
      expect(s.jobs.list).toHaveBeenCalledExactlyOnceWith({ page, pageSize: 100 });
    }
  );

  it('caps products at 100 even if the source violates the requested limit', async () => {
    const s = setup();
    s.jobs.list.mockResolvedValue({
      ...productPage(),
      total: 150,
      items: Array.from({ length: 150 }, (_, index) => ({ ...product(), id: `job-${index}` }))
    });
    const result = await loadTaskCenterSnapshot(s.services, s.repository, s.storage);
    expect(result.items.filter((item) => item.source === 'product')).toHaveLength(100);
    expect(result.productHasMore).toBe(true);
    expect(result.errors).toContainEqual({ source: 'product', code: 'TASK_PRODUCT_TRUNCATED' });
  });

  it('rejects an invalid product page without hiding other sources', async () => {
    const s = setup();
    s.jobs.list.mockResolvedValue({ ...productPage(), page: 99 });
    const result = await loadTaskCenterSnapshot(s.services, s.repository, s.storage);
    expect(result.items.filter((item) => item.source === 'product')).toEqual([]);
    expect(result.errors).toContainEqual({ source: 'product', code: 'TASK_PRODUCT_INVALID' });
  });

  it('only binds the current product page to an unscoped queue, never copies its title or status', async () => {
    const s = setup();
    s.jobs.list.mockResolvedValue({ ...productPage(), items: [], page: 2, total: 101 });
    const result = await loadTaskCenterSnapshot(s.services, s.repository, s.storage, () => true, 2);
    expect(result.unscopedQueueCount).toBe(2);
    expect(result.items.some((item) => 'batchItemId' in item)).toBe(false);
    const old = readonlyStorage({
      [LEGACY_QUEUE_KEY]: JSON.stringify([
        { schemaVersion: 1, id: 'legacy', title: 'private', xml: 'private' }
      ])
    });
    expect(bindTaskBatchItems(old, [])).toEqual({ items: [], unscopedQueueCount: 1, errors: [] });
    expect(old.setItem).not.toHaveBeenCalled();
    expect(old.removeItem).not.toHaveBeenCalled();
  });

  it('leaves corrupt queues and receipts byte-for-byte untouched and reports warnings', async () => {
    const s = setup({ [QUEUE_KEY]: '{private-broken', [associationKey()]: '{private-broken' });
    const result = await loadTaskCenterSnapshot(s.services, s.repository, s.storage);
    expect(result.errors).toContainEqual({ source: 'product', code: 'TASK_QUEUE_INVALID' });
    expect(result.errors).toContainEqual({ source: 'video-association', code: 'TASK_ASSOCIATION_INVALID' });
    expect(result.items).toHaveLength(3);
    expect(s.storage.getItem(QUEUE_KEY)).toBe('{private-broken');
    expect(s.storage.getItem(associationKey())).toBe('{private-broken');
    expect(s.storage.removeItem).not.toHaveBeenCalled();
    expect(s.storage.setItem).not.toHaveBeenCalled();
  });

  it('never reads foreign account/gateway/mode association values; storage changes do not change association ownership', async () => {
    const foreign = [
      associationKey({ ...context, identity: 'other' }),
      associationKey({ ...context, gateway: 'other' }),
      associationKey(context, 'mock')
    ];
    const s = setup(Object.fromEntries(foreign.map((key) => [key, '{private-broken'])));
    s.getContext.mockResolvedValue({ ...context, storage: 'new-storage' });
    const result = await loadTaskCenterSnapshot(s.services, s.repository, s.storage);
    expect(result.items.filter((item) => item.source === 'video-association')).toHaveLength(1);
    expect(result.errors).toEqual([]);
    for (const key of foreign) expect(s.storage.getItem).not.toHaveBeenCalledWith(key);
  });

  it('does not recover a durable sending receipt and rejects a product-key/request mismatch', async () => {
    const s = setup({ [associationKey(context, 'bff', '9999')]: JSON.stringify(fixture.associationReceipt) });
    const result = await loadTaskCenterSnapshot(s.services, s.repository, s.storage);
    expect(result.items.filter((item) => item.source === 'video-association')).toHaveLength(1);
    expect(result.items.find((item) => item.source === 'video-association')).toMatchObject({
      status: 'attention',
      rawStatus: 'sending'
    });
    expect(s.storage.getItem(associationKey())).toBe(JSON.stringify(fixture.associationReceipt));
    expect(result.errors).toContainEqual({ source: 'video-association', code: 'TASK_ASSOCIATION_INVALID' });
  });

  it('validates video responses with AJV and retains the other sources on malformed data', async () => {
    const s = setup();
    const malformed = {
      ...fixture.videoUploads,
      tasks: [
        {
          ...fixture.videoUploads.tasks[0],
          sourceUrl: 'https://private.invalid/?X-Amz-Signature=secret',
          contentBase64: 'secret'
        }
      ]
    };
    s.videoUpload.mockResolvedValue(malformed as VideoUploadResult);
    const result = await loadTaskCenterSnapshot(s.services, s.repository, s.storage);
    expect(result.items).toHaveLength(3);
    expect(result.errors).toContainEqual({ source: 'video-upload', code: 'TASK_VIDEO_UPLOAD_INVALID' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('filters foreign gallery/video tasks and independently warns about corrupt gallery entries', async () => {
    const s = setup();
    s.repository.list.mockResolvedValue([
      gallery(),
      { ...gallery(), context: { ...context, identity: 'other' }, id: 'foreign' },
      { id: 'broken', secret: 'private' }
    ]);
    s.videoUpload.mockResolvedValue({
      uploadEnabled: false,
      tasks: [upload(), { ...upload(), context: { ...context, identity: 'other' }, title: 'private-foreign' }]
    });
    const result = await loadTaskCenterSnapshot(s.services, s.repository, s.storage);
    expect(result.items).toHaveLength(4);
    expect(result.errors).toContainEqual({ source: 'gallery', code: 'TASK_GALLERY_INVALID' });
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it.each(['videoUploads', 's3Storage', 'control'] as const)(
    'uses the %s video adapter with its bound receiver',
    async (adapter) => {
      const s = setup();
      delete s.services.videoUploads;
      const owner = {
        marker: 'bound',
        videoUpload: vi.fn(function (this: { marker: string }) {
          expect(this.marker).toBe('bound');
          return Promise.resolve(uploadResult());
        })
      };
      if (adapter === 'videoUploads') s.services.videoUploads = owner;
      else if (adapter === 's3Storage') s.services.s3Storage = owner as unknown as S3StorageControl;
      else s.services.control = owner as unknown as ControlClient;
      const result = await loadTaskCenterSnapshot(s.services, s.repository, s.storage);
      expect(result.items.some((item) => item.source === 'video-upload')).toBe(true);
      expect(owner.videoUpload).toHaveBeenCalledExactlyOnceWith({ action: 'list' }, context);
    }
  );
});
