import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import integrityFixture from '../../../mock/data/product-maintenance-integrity.json';
import {
  ProductMaintenanceService,
  parseProductMaintenanceRecord,
  productMaintenanceIsTerminal,
  productMaintenanceLockEntities,
  createProductMaintenanceBaseline
} from '../src/product-maintenance-service';
import type {
  ProductMaintenanceRepository,
  ProductMaintenanceRecord,
  ProductMaintenanceTask,
  ProductMaintenanceRuntime,
  ProductMaintenanceResolver,
  ProductMaintenanceCommand,
  ProductMaintenanceServiceResult
} from '../src/product-maintenance-service';
import type { KnownProductDraft, ProductMaintenanceSnapshot } from '../src/product-maintenance-api';
import type { ProductOperationContext } from '../src/product-operation-context';

interface Fixtures {
  drafts: Record<string, unknown>;
  snapshots: Record<string, ProductMaintenanceSnapshot>;
  responses: Record<string, unknown>;
  errors: Record<string, unknown>;
  service: {
    ownerId: string;
    otherOwnerId: string;
    requestId: string;
    taskIds: string[];
    context: ProductOperationContext;
    otherContext: ProductOperationContext;
    now: number;
    knownDrafts: KnownProductDraft[];
    draftReads: Record<string, { draftId: string; status: 'absent' | 'present' | 'unknown' }[]>;
  };
}
const data = JSON.parse(
  await readFile(new URL('../../../mock/data/product-maintenance-api.json', import.meta.url), 'utf8')
) as Fixtures;
const fx = data.service;
function task(result: ProductMaintenanceServiceResult): ProductMaintenanceTask {
  return (
    result.tasks[0] ??
    (() => {
      throw new Error('Expected task');
    })()
  );
}
class MemoryRepository implements ProductMaintenanceRepository {
  rows = new Map<string, ProductMaintenanceRecord>();
  history: ProductMaintenanceRecord[] = [];
  failStatus: string | null = null;
  get(id: string, ownerId: string): Promise<ProductMaintenanceRecord | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row?.ownerId === ownerId ? structuredClone(row) : null);
  }
  list(ownerId: string): Promise<ProductMaintenanceRecord[]> {
    return Promise.resolve(
      [...this.rows.values()].filter((row) => row.ownerId === ownerId).map((row) => structuredClone(row))
    );
  }
  save(row: ProductMaintenanceRecord, expected: number | null): Promise<void> {
    const old = this.rows.get(row.task.id);
    if (expected === null ? old !== undefined : old?.task.revision !== expected)
      throw new Error('ENTITY_VERSION_CONFLICT');
    if (row.task.status === this.failStatus) throw new Error('Synthetic storage failure');
    for (const other of this.rows.values()) {
      if (
        other.task.id === row.task.id ||
        other.ownerId !== row.ownerId ||
        other.task.context.identity !== row.task.context.identity ||
        other.task.context.gateway !== row.task.context.gateway ||
        productMaintenanceIsTerminal(other.task.status) ||
        productMaintenanceIsTerminal(row.task.status)
      )
        continue;
      if (
        productMaintenanceLockEntities(row.task).some((key) =>
          productMaintenanceLockEntities(other.task).includes(key)
        )
      )
        throw new Error('PRODUCT_MAINTENANCE_ENTITY_BUSY');
    }
    this.rows.set(row.task.id, structuredClone(row));
    this.history.push(structuredClone(row));
    return Promise.resolve();
  }
}
function sampleSnapshot(name: string): ProductMaintenanceSnapshot {
  const value = data.snapshots[name];
  if (!value) throw new Error('Missing synthetic snapshot');
  return { ...structuredClone(integrityFixture.snapshot), ...value };
}
function setup() {
  const repo = new MemoryRepository();
  const current = { snapshot: sampleSnapshot('matching') };
  const client = {
    call: vi.fn((method: string) => Promise.resolve({ method, data: data.responses.accepted }))
  };
  const runtime: ProductMaintenanceRuntime = {
    context: structuredClone(fx.context),
    protocol: 'iop',
    enabled: true,
    client,
    readProduct: vi.fn(() => Promise.resolve(structuredClone(current.snapshot))),
    knownDrafts: fx.knownDrafts,
    readDrafts: vi.fn(() => Promise.resolve(data.service.draftReads.absent ?? []))
  };
  const resolve = vi.fn<ProductMaintenanceResolver>(() => Promise.resolve(runtime));
  let nextId = 0;
  const factory = () =>
    new ProductMaintenanceService(
      repo,
      resolve,
      () => fx.now,
      () =>
        fx.taskIds[nextId++] ??
        (() => {
          throw new Error('Missing task id');
        })()
    );
  const service = factory();
  const request = (command: ProductMaintenanceCommand, context = fx.context) => ({
    requestId: fx.requestId,
    context,
    command
  });
  const create = async (name = 'inventory') =>
    task(await service.execute(fx.ownerId, request({ action: 'create', draft: data.drafts[name] })));
  const send = (item: ProductMaintenanceTask, instance = service) =>
    instance.execute(
      fx.ownerId,
      request({
        action: 'send',
        taskId: item.id,
        revision: item.revision,
        fingerprint: item.intent.fingerprint
      })
    );
  const verify = (item: ProductMaintenanceTask, instance = service) =>
    instance.execute(fx.ownerId, request({ action: 'verify', taskId: item.id, revision: item.revision }));
  return { repo, client, runtime, current, resolve, factory, service, request, create, send, verify };
}

describe('durable product maintenance state machine', () => {
  it('captures target values and non-target hashes without sending during create', async () => {
    const h = setup();
    const item = await h.create('skuPrice');
    expect(item.status).toBe('prepared');
    expect(item.baseline?.fields).toMatchObject({
      'skus/990001/currency': 'EUR',
      'skus/990001/price': '1.50000000000000000001'
    });
    expect(item.baseline).not.toHaveProperty('skus');
    expect(item.baseline).not.toHaveProperty('snapshot');
    expect(item.baseline?.fields['integrity/modelNumber']).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(item.baseline)).not.toContain(integrityFixture.snapshot.title);
    expect(item.submitAttempted).toBe(false);
    expect(h.client.call).not.toHaveBeenCalled();
    expect(h.repo.history).toHaveLength(1);
  });
  it('persists claim before one call and separates accepted from verified', async () => {
    const h = setup();
    const item = await h.create();
    h.client.call.mockImplementation((method) => {
      expect(h.repo.history.at(-1)?.task.status).toBe('dispatching');
      expect(h.repo.history.at(-1)?.task.submitAttempted).toBe(true);
      return Promise.resolve({ method, data: data.responses.accepted });
    });
    const sent = task(await h.send(item));
    expect(sent.status).toBe('accepted');
    expect(sent.revision).toBe(3);
    expect(sent.receipt?.readbackRequired).toBe(true);
    expect(sent.readback).toBeNull();
    expect(h.repo.history.map((row) => row.task.status)).toEqual(['prepared', 'dispatching', 'accepted']);
    expect(task(await h.verify(sent)).status).toBe('verified');
    expect(h.client.call).toHaveBeenCalledTimes(1);
  });
  it.each(['inventory', 'skuPrice'])('blocks changed %s baseline before claim or dispatch', async (name) => {
    const h = setup();
    const item = await h.create(name);
    h.current.snapshot = sampleSnapshot(name === 'inventory' ? 'inventoryMismatch' : 'priceMismatch');
    await expect(h.send(item)).rejects.toThrow('BASELINE_CHANGED');
    expect(h.repo.history).toHaveLength(1);
    expect(h.client.call).not.toHaveBeenCalled();
    expect((await h.repo.get(item.id, fx.ownerId))?.task.submitAttempted).toBe(false);
  });
  it('requires another preview when non-target data changes before sending', async () => {
    const h = setup();
    const item = await h.create();
    h.current.snapshot = sampleSnapshot('priceMismatch');
    await expect(h.send(item)).rejects.toThrow('BASELINE_CHANGED');
    expect(h.client.call).not.toHaveBeenCalled();
  });
  it('does not verify matching prices when the model number disappears', async () => {
    const h = setup();
    const sent = task(await h.send(await h.create('skuPrice')));
    Object.assign(h.current.snapshot, { modelNumber: null });
    const verified = task(await h.verify(sent));
    expect(verified.status).toBe('accepted');
    expect(verified.reasonCode).toBe('PRODUCT_MAINTENANCE_NON_TARGET_FIELDS_CHANGED');
    expect(verified.readback?.mismatchedFields).toContain('integrity/modelNumber');
    expect(h.client.call).toHaveBeenCalledTimes(1);
    await expect(h.send(verified)).rejects.toThrow('ALREADY_ATTEMPTED');
  });
  it('rejects missing metadata rather than claiming complete baseline evidence', async () => {
    const h = setup();
    Reflect.deleteProperty(h.current.snapshot, 'modelNumber');
    await expect(h.create()).rejects.toThrow('INTEGRITY_SNAPSHOT_UNAVAILABLE');
    expect(h.repo.history).toHaveLength(0);
    expect(h.client.call).not.toHaveBeenCalled();
  });
  it('keeps historical target-only receipts readable without upgrading them to verified', async () => {
    const h = setup();
    const sent = task(await h.send(await h.create()));
    const stored = h.repo.rows.get(sent.id);
    if (!stored) throw new Error('Missing stored task');
    stored.task.baseline = await createProductMaintenanceBaseline(
      stored.task.intent.draft,
      h.current.snapshot
    );
    expect(
      task(await h.service.execute(fx.ownerId, h.request({ action: 'get', taskId: sent.id }))).status
    ).toBe('accepted');
    const checked = task(await h.verify(sent));
    expect(checked.status).toBe('accepted');
    expect(checked.reasonCode).toBe('PRODUCT_MAINTENANCE_INTEGRITY_UNAVAILABLE');
    expect(checked.readback?.unavailableFields).toContain('integrity/modelNumber');
    expect(h.client.call).toHaveBeenCalledTimes(1);
  });
  it('blocks dispatch while the platform is reviewing the product', async () => {
    const h = setup();
    const item = await h.create();
    Object.assign(h.current.snapshot, { auditStatus: 'pending' });
    await expect(h.send(item)).rejects.toThrow('REVIEW_PENDING');
    expect(h.client.call).not.toHaveBeenCalled();
  });
  it('waits for approval even when the target values already match', async () => {
    const h = setup();
    const sent = task(await h.send(await h.create()));
    Object.assign(h.current.snapshot, { auditStatus: 'pending' });
    const pending = task(await h.verify(sent));
    expect(pending.status).toBe('accepted');
    expect(pending.reasonCode).toBe('PRODUCT_MAINTENANCE_PRODUCT_STATE_UNCONFIRMED');
    expect(pending.readback?.unavailableFields).toContain('auditStatus');
    Object.assign(h.current.snapshot, { auditStatus: 'approved' });
    expect(task(await h.verify(pending)).status).toBe('verified');
    expect(h.client.call).toHaveBeenCalledTimes(1);
  });
  it('does not verify a deleted product from otherwise matching metadata', async () => {
    const h = setup();
    const sent = task(await h.send(await h.create()));
    Object.assign(h.current.snapshot, { status: 'deleted' });
    const checked = task(await h.verify(sent));
    expect(checked.status).toBe('accepted');
    expect(checked.readback?.unavailableFields).toContain('productStatus');
    expect(h.client.call).toHaveBeenCalledTimes(1);
  });
  it('requires complete baseline data rather than filling missing values with zero', async () => {
    const h = setup();
    h.current.snapshot = sampleSnapshot('missingInventory');
    await expect(h.create()).rejects.toThrow('BASELINE_UNAVAILABLE');
    expect(h.repo.history).toHaveLength(0);
  });
  it('rechecks explicit existing SKU currency on create and before send', async () => {
    const h = setup();
    const item = await h.create('skuPrice');
    h.current.snapshot = sampleSnapshot('currencyMismatch');
    await expect(h.send(item)).rejects.toThrow('SKU_CURRENCY_UNCONFIRMED');
    expect(h.client.call).not.toHaveBeenCalled();
    await expect(createProductMaintenanceBaseline(data.drafts.skuPrice, h.current.snapshot)).rejects.toThrow(
      'SKU_CURRENCY_UNCONFIRMED'
    );
  });
  it('does not retry an ambiguous write across service reloads', async () => {
    const h = setup();
    const item = await h.create();
    h.client.call.mockRejectedValue(data.errors.network);
    const sent = task(await h.send(item));
    expect(sent.status).toBe('ambiguous');
    await expect(h.send(sent, h.factory())).rejects.toThrow('ALREADY_ATTEMPTED');
    const verified = task(await h.verify(sent, h.factory()));
    expect(verified.status).toBe('verified');
    expect(verified.receipt?.status).toBe('ambiguous');
    expect(h.client.call).toHaveBeenCalledTimes(1);
  });
  it('keeps a durable dispatching barrier when receipt persistence fails', async () => {
    const h = setup();
    const item = await h.create();
    h.repo.failStatus = 'accepted';
    await expect(h.send(item)).rejects.toThrow('RESULT_NOT_PERSISTED');
    const stored = await h.repo.get(item.id, fx.ownerId);
    expect(stored?.task.status).toBe('dispatching');
    const saved =
      stored?.task ??
      (() => {
        throw new Error('Missing claim');
      })();
    await expect(h.send(saved, h.factory())).rejects.toThrow('ALREADY_ATTEMPTED');
    expect(task(await h.verify(saved, h.factory())).status).toBe('verified');
    expect(h.client.call).toHaveBeenCalledTimes(1);
  });
  it('sends nothing when durable claim storage fails', async () => {
    const h = setup();
    const item = await h.create();
    h.repo.failStatus = 'dispatching';
    await expect(h.send(item)).rejects.toThrow('Synthetic storage failure');
    expect(h.client.call).not.toHaveBeenCalled();
  });
  it('CAS allows only one of two concurrent send commands', async () => {
    const h = setup();
    const item = await h.create();
    const attempts = await Promise.allSettled([h.send(item), h.send(item, h.factory())]);
    expect(attempts.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(h.client.call).toHaveBeenCalledTimes(1);
  });
  it('blocks another price/inventory task for the same owner/context/product while unresolved', async () => {
    const h = setup();
    const item = await h.create();
    expect(productMaintenanceLockEntities(item)).toEqual(['product:880001']);
    await expect(h.create('tiered')).rejects.toThrow('ENTITY_BUSY');
    await h.service.execute(
      fx.ownerId,
      h.request({ action: 'cancel', taskId: item.id, revision: item.revision })
    );
    expect((await h.create('tiered')).status).toBe('prepared');
  });
  it('rejects context switching and TOP runtime without a provider call', async () => {
    const h = setup();
    const item = await h.create();
    h.runtime.context = fx.otherContext;
    await expect(h.send(item)).rejects.toThrow('PRODUCT_CONTEXT_CHANGED');
    h.runtime.context = fx.context;
    h.runtime.protocol = 'top';
    await expect(h.send(item)).rejects.toThrow('IOP_REQUIRED');
    expect(h.client.call).not.toHaveBeenCalled();
  });
  it('honors per-method disabled flags while allowing local receipt reads', async () => {
    const h = setup();
    const item = await h.create();
    h.runtime.enabled = false;
    await expect(h.send(item)).rejects.toThrow('METHOD_DISABLED');
    expect(task(await h.service.execute(fx.ownerId, h.request({ action: 'get', taskId: item.id }))).id).toBe(
      item.id
    );
    expect(h.client.call).not.toHaveBeenCalled();
  });
  it('rejects stale revisions, forged fingerprint and caller context before sending', async () => {
    const h = setup();
    const item = await h.create();
    await expect(
      h.service.execute(
        fx.ownerId,
        h.request({
          action: 'send',
          taskId: item.id,
          revision: item.revision + 1,
          fingerprint: item.intent.fingerprint
        })
      )
    ).rejects.toThrow('ENTITY_VERSION_CONFLICT');
    await expect(
      h.service.execute(
        fx.ownerId,
        h.request({
          action: 'send',
          taskId: item.id,
          revision: item.revision,
          fingerprint: fx.context.identity
        })
      )
    ).rejects.toThrow('INTENT_MISMATCH');
    await expect(
      h.service.execute(fx.ownerId, h.request({ action: 'get', taskId: item.id }, fx.otherContext))
    ).rejects.toThrow('PRODUCT_CONTEXT_CHANGED');
    expect(h.client.call).not.toHaveBeenCalled();
  });
  it('requires trusted known draft evidence, not client-provided draft labels', async () => {
    const h = setup();
    delete h.runtime.knownDrafts;
    await expect(h.create('deleteOne')).rejects.toThrow('KNOWN_DRAFT_REQUIRED');
    expect(h.repo.history).toHaveLength(0);
    expect(h.client.call).not.toHaveBeenCalled();
  });
  it('keeps partial deletion per-ID evidence and confirms only explicit bounded absence', async () => {
    const h = setup();
    const item = await h.create('deleteBatch');
    expect(item.baseline).toBeNull();
    expect(productMaintenanceLockEntities(item)).toEqual(['draft:770001', 'draft:770002']);
    h.client.call.mockImplementation((method) => Promise.resolve({ method, data: data.responses.partial }));
    const sent = task(await h.send(item));
    expect(sent.status).toBe('partial');
    h.runtime.readDrafts = () => Promise.resolve(fx.draftReads.partial ?? []);
    const partial = task(await h.verify(sent));
    expect(partial.status).toBe('partial');
    expect(partial.readback?.status).toBe('mismatched');
    h.runtime.readDrafts = () => Promise.resolve(fx.draftReads.absent ?? []);
    const verified = task(await h.verify(partial));
    expect(verified.status).toBe('verified');
    expect(verified.receipt?.status).toBe('partial');
  });
  it.each(['unknown', 'incomplete', 'duplicate'])(
    'never infers draft deletion from %s evidence',
    async (name) => {
      const h = setup();
      const item = await h.create('deleteBatch');
      h.client.call.mockImplementation((method) =>
        Promise.resolve({ method, data: data.responses.deleteBatch })
      );
      const sent = task(await h.send(item));
      h.runtime.readDrafts = () => Promise.resolve(fx.draftReads[name] ?? []);
      expect(task(await h.verify(sent)).status).not.toBe('verified');
    }
  );
  it('keeps readback errors safe and unavailable, not a verified mutation', async () => {
    const h = setup();
    const sent = task(await h.send(await h.create()));
    h.runtime.readProduct = () => Promise.reject(new Error(JSON.stringify(data.errors.unknown)));
    const checked = task(await h.verify(sent));
    expect(checked.status).toBe('accepted');
    expect(checked.readback?.status).toBe('unavailable');
    expect(JSON.stringify(checked)).not.toContain('Synthetic private detail');
  });
  it('cannot verify an unsent or cancelled task', async () => {
    const h = setup();
    const item = await h.create();
    await expect(h.verify(item)).rejects.toThrow('VERIFY_NOT_ALLOWED');
    const cancelled = task(
      await h.service.execute(
        fx.ownerId,
        h.request({ action: 'cancel', taskId: item.id, revision: item.revision })
      )
    );
    await expect(h.send(cancelled)).rejects.toThrow('ALREADY_ATTEMPTED');
  });
  it('filters local lists by owner/context without resolving platform runtime', async () => {
    const h = setup();
    const item = await h.create();
    h.resolve.mockClear();
    expect((await h.service.execute(fx.ownerId, h.request({ action: 'list' }))).tasks).toHaveLength(1);
    expect((await h.service.execute(fx.otherOwnerId, h.request({ action: 'list' }))).tasks).toHaveLength(0);
    await expect(
      h.service.execute(fx.otherOwnerId, h.request({ action: 'get', taskId: item.id }))
    ).rejects.toThrow('TASK_NOT_FOUND');
    expect(h.resolve).not.toHaveBeenCalled();
  });
  it('persists explicit rejection separately and releases only terminal entity locks', async () => {
    const h = setup();
    const item = await h.create();
    h.client.call.mockImplementation((method) => Promise.resolve({ method, data: data.responses.rejected }));
    const rejected = task(await h.send(item));
    expect(rejected.status).toBe('rejected');
    expect(rejected.receipt?.status).toBe('rejected');
    expect(productMaintenanceIsTerminal(rejected.status)).toBe(true);
    await expect(h.verify(rejected)).rejects.toThrow('VERIFY_NOT_ALLOWED');
    expect((await h.create('tiered')).status).toBe('prepared');
  });
  it('rechecks trusted draft membership immediately before sending', async () => {
    const h = setup();
    const item = await h.create('deleteOne');
    delete h.runtime.knownDrafts;
    await expect(h.send(item)).rejects.toThrow('KNOWN_DRAFT_REQUIRED');
    expect(h.repo.history).toHaveLength(1);
    expect(h.client.call).not.toHaveBeenCalled();
  });
  it('detects persisted baseline or intent corruption before sending', async () => {
    const h = setup();
    const item = await h.create();
    const row = await h.repo.get(item.id, fx.ownerId);
    if (!row?.task.baseline) throw new Error('Missing baseline');
    row.task.baseline = { ...row.task.baseline, fingerprint: fx.context.gateway };
    h.repo.rows.set(item.id, row);
    await expect(h.send(item)).rejects.toThrow('TASK_CORRUPT');
    expect(h.client.call).not.toHaveBeenCalled();
  });
  it('parses only safe persisted task fields and classifies terminal lock release', async () => {
    const h = setup();
    const item = await h.create();
    expect(parseProductMaintenanceRecord({ ownerId: fx.ownerId, task: item }).task.id).toBe(item.id);
    expect(() =>
      parseProductMaintenanceRecord({ ownerId: fx.ownerId, task: item, raw: data.responses.accepted })
    ).toThrow('TASK_CORRUPT');
    for (const status of ['prepared', 'dispatching', 'accepted', 'partial', 'ambiguous'] as const)
      expect(productMaintenanceIsTerminal(status)).toBe(false);
    for (const status of ['verified', 'rejected', 'cancelled'] as const)
      expect(productMaintenanceIsTerminal(status)).toBe(true);
  });
});
