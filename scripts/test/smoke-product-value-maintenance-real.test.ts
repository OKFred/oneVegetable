import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import fixture from '../../mock/data/product-value-maintenance-smoke.json';
import {
  parseProductValueSmokeOptions,
  parseProductValueCreationProof,
  parseProductValuePlan,
  runProductValueMaintenancePlan,
  runProductValueSmokeCli,
  ProductValueGuardedTransport,
  createProductValueAcceptanceClient,
  PRODUCT_VALUE_POLL_MS,
  PRODUCT_VALUE_VERIFY_MS
} from '../smoke-product-value-maintenance-real';
import type { ProductValueSmokeIO, ProductValueBaseline } from '../smoke-product-value-maintenance-real';
import {
  createProductMaintenanceIntent,
  classifyProductMaintenanceResponse,
  PRODUCT_MAINTENANCE_METHODS
} from '../../packages/core/src/product-maintenance-api';
import type { ProductMaintenanceSnapshot } from '../../packages/core/src/product-maintenance-api';
import type { GatewayCredentials } from '../../packages/core/src/types';

const proof = () => parseProductValueCreationProof(fixture.proof, fixture.proof.product.id, fixture.now);
function urlText(input: RequestInfo | URL): string {
  return input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
}
function harness() {
  let current: ProductMaintenanceSnapshot = structuredClone(fixture.snapshots.baseline);
  let baseline: ProductValueBaseline | null = null;
  let now = fixture.now;
  const events: Readonly<Record<string, unknown>>[] = [];
  const write = vi.fn<ProductValueSmokeIO['write']>((intent) => {
    const draft = intent.draft;
    if (draft.operation === 'setPrice') {
      if (draft.mode !== 'tiered') throw new Error('Unexpected synthetic mode');
      current = structuredClone(
        draft.tiers[0]?.price === fixture.plan.price.tiers[0]?.price
          ? fixture.snapshots.changedPrice
          : fixture.snapshots.baseline
      );
    } else if (draft.operation === 'setInventory') {
      if (draft.mode !== 'spu') throw new Error('Unexpected synthetic mode');
      current = structuredClone(
        draft.inventory === fixture.plan.inventory.inventory
          ? fixture.snapshots.changedInventory
          : fixture.snapshots.baseline
      );
    }
    return Promise.resolve(
      classifyProductMaintenanceResponse(
        draft,
        draft.operation === 'deleteDraft' ? fixture.responses.deleted : fixture.responses.accepted
      )
    );
  });
  const io: ProductValueSmokeIO = {
    readProduct: vi.fn(() => Promise.resolve(structuredClone(current))),
    write,
    persistBaseline: vi.fn((value: ProductValueBaseline) => {
      baseline = structuredClone(value);
      return Promise.resolve();
    }),
    readBaseline: vi.fn(() => Promise.resolve(structuredClone(baseline))),
    appendReceipt: vi.fn((event: Readonly<Record<string, unknown>>) => {
      events.push(structuredClone(event));
      return Promise.resolve();
    }),
    wait: vi.fn((milliseconds: number) => {
      now += milliseconds;
      return Promise.resolve();
    }),
    now: () => now
  };
  return {
    io,
    write,
    events,
    setCurrent: (value: ProductMaintenanceSnapshot) => {
      current = value;
    },
    baseline: () => baseline
  };
}
const temporary: string[] = [];
afterEach(async () => {
  for (const dir of temporary.splice(0)) {
    if (dirname(dir) !== tmpdir() || !dir.includes('onevegetable-value-smoke-'))
      throw new Error('Refusing unsafe temporary cleanup');
    await rm(dir, { recursive: true });
  }
});

describe('explicit local acceptance options and creation proof', () => {
  it('requires confirmation, all explicit paths and an exact decimal product ID', () => {
    expect(parseProductValueSmokeOptions(fixture.cli).productId).toBe(fixture.proof.product.id);
    expect(() => parseProductValueSmokeOptions(fixture.cli.slice(1))).toThrow(
      'EXPLICIT_CONFIRMATION_REQUIRED'
    );
    expect(() => parseProductValueSmokeOptions([...fixture.cli, '--confirm-real-write'])).toThrow(
      'OPTIONS_INVALID'
    );
    expect(() => parseProductValueSmokeOptions([...fixture.cli, '--credential=other'])).toThrow(
      'OPTIONS_INVALID'
    );
    expect(() => parseProductValueSmokeOptions([...fixture.cli, '--unknown=other'])).toThrow(
      'OPTIONS_INVALID'
    );
  });
  it('refuses missing confirmation before reading any input or constructing a transport', async () => {
    await expect(runProductValueSmokeCli([])).rejects.toThrow('EXPLICIT_CONFIRMATION_REQUIRED');
  });
  it.each(fixture.invalidProofs)('rejects an untrusted/stale/mismatched creation proof %#', (value) => {
    expect(() => parseProductValueCreationProof(value, fixture.proof.product.id, fixture.now)).toThrow();
  });
  it.each(fixture.invalidPlans)('rejects a plan outside the parent-created resources %#', async (value) => {
    await expect(parseProductValuePlan(value, proof())).rejects.toThrow();
  });
  it('refuses an existing receipt before reading credential/proof files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'onevegetable-value-smoke-'));
    temporary.push(dir);
    const receiptPath = join(dir, 'receipt.jsonl');
    const handle = await open(receiptPath, 'wx');
    await handle.close();
    await expect(
      runProductValueSmokeCli([
        '--confirm-real-write',
        '--credential',
        join(dir, 'nonexistent-credential'),
        '--baseline',
        join(dir, 'baseline.json'),
        '--receipt',
        receiptPath,
        '--creation-proof',
        join(dir, 'nonexistent-proof'),
        '--plan',
        join(dir, 'nonexistent-plan'),
        '--product-id',
        fixture.proof.product.id
      ])
    ).rejects.toThrow('OUTPUT_ALREADY_EXISTS');
    await expect(open(receiptPath, 'wx')).rejects.toMatchObject({ code: 'EEXIST' });
  });
});

describe('offline reversible value maintenance plan', () => {
  it('captures/rereads minimal baseline and verifies both roundtrips before one draft delete', async () => {
    const h = harness();
    const plan = await parseProductValuePlan(fixture.plan, proof());
    const result = await runProductValueMaintenancePlan(plan, proof(), h.io);
    expect(result).toEqual({ price: 'restored', inventory: 'restored', draft: 'reported-deleted' });
    expect(h.write.mock.calls.map(([intent]) => intent.method)).toEqual([
      PRODUCT_MAINTENANCE_METHODS.setPrice,
      PRODUCT_MAINTENANCE_METHODS.setPrice,
      PRODUCT_MAINTENANCE_METHODS.setInventory,
      PRODUCT_MAINTENANCE_METHODS.setInventory,
      PRODUCT_MAINTENANCE_METHODS.deleteDraft
    ]);
    expect(h.events[0]?.phase).toBe('baseline-persisted');
    expect(h.events.filter((event) => event.phase === 'readback-confirmed')).toHaveLength(4);
    expect(h.events.at(-1)?.draftReadback).toBe('not-performed');
    expect(h.baseline()).not.toHaveProperty('snapshot');
    expect(h.baseline()?.price.fields).toEqual({
      'price/type': 'TIERED',
      'price/currency': 'USD',
      'price/tiers/1': '1'
    });
    expect(h.io.wait).toHaveBeenCalledTimes(4);
    expect(h.io.wait).toHaveBeenCalledWith(PRODUCT_VALUE_POLL_MS);
  });
  it('does not send when baseline persistence or its readback fails', async () => {
    const plan = await parseProductValuePlan(fixture.plan, proof());
    const failed = harness();
    failed.io.persistBaseline = () => Promise.reject(new Error('Synthetic storage failure'));
    await expect(runProductValueMaintenancePlan(plan, proof(), failed.io)).rejects.toThrow(
      'Synthetic storage failure'
    );
    expect(failed.write).not.toHaveBeenCalled();
    const corrupted = harness();
    corrupted.io.readBaseline = () => Promise.resolve(fixture.responses.invalid);
    await expect(runProductValueMaintenancePlan(plan, proof(), corrupted.io)).rejects.toThrow(
      'BASELINE_NOT_PERSISTED'
    );
    expect(corrupted.write).not.toHaveBeenCalled();
  });
  it('requires a flushed sending receipt before the first write', async () => {
    const h = harness();
    h.io.appendReceipt = (event) =>
      event.phase === 'sending' ? Promise.reject(new Error('Synthetic storage failure')) : Promise.resolve();
    await expect(
      runProductValueMaintenancePlan(await parseProductValuePlan(fixture.plan, proof()), proof(), h.io)
    ).rejects.toThrow('Synthetic storage failure');
    expect(h.write).not.toHaveBeenCalled();
  });
  it('stops after an unknown forward write and never blindly restores', async () => {
    const h = harness();
    h.write.mockRejectedValue(new Error('Synthetic private detail'));
    await expect(
      runProductValueMaintenancePlan(await parseProductValuePlan(fixture.plan, proof()), proof(), h.io)
    ).rejects.toThrow('WRITE_OUTCOME_UNKNOWN');
    expect(h.write).toHaveBeenCalledTimes(1);
    expect(h.events.some((event) => event.phase === 'ambiguous')).toBe(true);
    expect(JSON.stringify(h.events)).not.toContain('Synthetic private detail');
  });
  it('stops after an unknown restoration without later inventory/delete writes', async () => {
    const h = harness();
    const forward = h.write.getMockImplementation();
    if (!forward) throw new Error('Missing synthetic writer');
    h.write.mockImplementationOnce(forward).mockRejectedValue(new Error('Synthetic unknown restoration'));
    await expect(
      runProductValueMaintenancePlan(await parseProductValuePlan(fixture.plan, proof()), proof(), h.io)
    ).rejects.toThrow('WRITE_OUTCOME_UNKNOWN');
    expect(h.write).toHaveBeenCalledTimes(2);
  });
  it('does not compensate an explicit rejected forward write', async () => {
    const h = harness();
    h.write.mockImplementation((intent) =>
      Promise.resolve(classifyProductMaintenanceResponse(intent.draft, fixture.responses.rejected))
    );
    await expect(
      runProductValueMaintenancePlan(await parseProductValuePlan(fixture.plan, proof()), proof(), h.io)
    ).rejects.toThrow('WRITE_NOT_ACCEPTED');
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it('bounds readback polling at 5-second intervals for 5 minutes without write retries', async () => {
    const h = harness();
    h.write.mockImplementation((intent) =>
      Promise.resolve(classifyProductMaintenanceResponse(intent.draft, fixture.responses.accepted))
    );
    await expect(
      runProductValueMaintenancePlan(await parseProductValuePlan(fixture.plan, proof()), proof(), h.io)
    ).rejects.toThrow('READBACK_UNRESOLVED');
    expect(h.io.wait).toHaveBeenCalledTimes(PRODUCT_VALUE_VERIFY_MS / PRODUCT_VALUE_POLL_MS);
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it('blocks baseline drift before sending and concurrent changes before restoration', async () => {
    const before = harness();
    let reads = 0;
    before.io.readProduct = () =>
      Promise.resolve(
        structuredClone(++reads === 1 ? fixture.snapshots.baseline : fixture.snapshots.concurrentPrice)
      );
    const plan = await parseProductValuePlan(fixture.plan, proof());
    await expect(runProductValueMaintenancePlan(plan, proof(), before.io)).rejects.toThrow(
      'BASELINE_CHANGED'
    );
    expect(before.write).not.toHaveBeenCalled();
    const during = harness();
    const original = during.io.readProduct;
    reads = 0;
    during.io.readProduct = (id) =>
      ++reads === 4 ? Promise.resolve(structuredClone(fixture.snapshots.concurrentPrice)) : original(id);
    await expect(runProductValueMaintenancePlan(plan, proof(), during.io)).rejects.toThrow(
      'CONCURRENT_CHANGE_STOPPED_RESTORATION'
    );
    expect(during.write).toHaveBeenCalledTimes(1);
  });
  it('does not treat receipt-write errors during successful readback as retryable reads', async () => {
    const h = harness();
    const append = h.io.appendReceipt;
    h.io.appendReceipt = (event) =>
      event.phase === 'readback-confirmed'
        ? Promise.reject(new Error('Synthetic storage failure'))
        : append(event);
    await expect(
      runProductValueMaintenancePlan(await parseProductValuePlan(fixture.plan, proof()), proof(), h.io)
    ).rejects.toThrow('Synthetic storage failure');
    expect(h.write).toHaveBeenCalledTimes(1);
  });
});

describe('fixed guarded native transport and real contracts, entirely offline', () => {
  const make = () => {
    const send = vi.fn(() => Promise.resolve(Response.json(fixture.transport.response)));
    return { send, guard: new ProductValueGuardedTransport({ send }) };
  };
  const input = () => new URLSearchParams(fixture.transport.body);
  const init = () => ({ method: 'POST', redirect: 'manual' as const, body: input() });
  it('allows only one exact armed request and consumes the arm on a mismatch', async () => {
    const { send, guard } = make();
    await expect(guard.send(fixture.transport.url, init())).rejects.toThrow('TRANSPORT_SCOPE_DENIED');
    guard.arm(PRODUCT_MAINTENANCE_METHODS.setPrice, fixture.transport.url, input());
    await expect(
      guard.send(fixture.transport.url, {
        ...init(),
        body: new URLSearchParams(fixture.transport.changedBody)
      })
    ).rejects.toThrow('TRANSPORT_SCOPE_DENIED');
    await expect(guard.send(fixture.transport.url, init())).rejects.toThrow('TRANSPORT_SCOPE_DENIED');
    expect(send).not.toHaveBeenCalled();
  });
  it('blocks foreign origins, other mutations and redirects', () => {
    const { guard } = make();
    expect(() => {
      guard.arm(PRODUCT_MAINTENANCE_METHODS.setPrice, fixture.transport.foreignUrl, input());
    }).toThrow();
    expect(() => {
      guard.arm(fixture.transport.wrongPath, fixture.transport.url, input());
    }).toThrow();
  });
  it('has a hard two-write price budget with no hidden retries', async () => {
    const { send, guard } = make();
    for (let index = 0; index < 2; index++) {
      guard.arm(PRODUCT_MAINTENANCE_METHODS.setPrice, fixture.transport.url, input());
      await guard.send(fixture.transport.url, init());
    }
    guard.arm(PRODUCT_MAINTENANCE_METHODS.setPrice, fixture.transport.url, input());
    await expect(guard.send(fixture.transport.url, init())).rejects.toThrow('TRANSPORT_BUDGET_EXHAUSTED');
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('signs fixed native calls with actual standalone contracts through NetworkManager, no fetch', async () => {
    const send = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        Response.json(
          urlText(input).endsWith('/get/v2') ? fixture.responses.read : fixture.responses.accepted
        )
      )
    );
    const client = createProductValueAcceptanceClient({
      credentials: fixture.credentials as GatewayCredentials,
      proof: proof(),
      transport: { send }
    });
    expect((await client.readProduct(fixture.proof.product.id)).inventory).toBe(
      fixture.snapshots.baseline.inventory
    );
    const intent = await createProductMaintenanceIntent(fixture.plan.price);
    expect((await client.write(intent)).status).toBe('accepted');
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(send.mock.calls.map(([url]) => urlText(url)))).not.toContain(
      fixture.credentials.appSecret
    );
  });
  it('requires the actual contracts for all three native write methods', async () => {
    const send = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        Response.json(
          urlText(input).endsWith('/draft/delete') ? fixture.responses.deleted : fixture.responses.accepted
        )
      )
    );
    const client = createProductValueAcceptanceClient({
      credentials: fixture.credentials as GatewayCredentials,
      proof: proof(),
      transport: { send }
    });
    for (const draft of [fixture.plan.price, fixture.plan.inventory, fixture.plan.deleteDraft]) {
      expect((await client.write(await createProductMaintenanceIntent(draft))).status).toBe('accepted');
    }
    expect(send).toHaveBeenCalledTimes(3);
  });
  it('refuses a different product and malformed responses without a success default', async () => {
    const send = vi.fn(() => Promise.resolve(Response.json(fixture.responses.invalid)));
    const client = createProductValueAcceptanceClient({
      credentials: fixture.credentials as GatewayCredentials,
      proof: proof(),
      transport: { send }
    });
    await expect(client.readProduct(fixture.proof.draft.id)).rejects.toThrow('PLAN_SCOPE_MISMATCH');
    expect(send).not.toHaveBeenCalled();
    await expect(client.write(await createProductMaintenanceIntent(fixture.plan.price))).rejects.toThrow(
      'RESPONSE_CONTRACT_INVALID'
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});
