import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import fixture from '../../mock/data/product-price-real.json';
import {
  parseProductPriceSmokeOptions,
  parseProductPriceCreationProof,
  parseProductPricePlan,
  runProductPriceMaintenancePlan,
  ProductPriceGuardedTransport,
  createProductPriceAcceptanceClient,
  runProductPriceSmokeCli,
  PRODUCT_PRICE_POLL_MS,
  PRODUCT_PRICE_VERIFY_MS,
  PRODUCT_PRICE_PROOF_CLAIM_SUFFIX
} from '../smoke-product-price-real';
import type { ProductPriceSmokeBaseline, ProductPriceSmokeIO } from '../smoke-product-price-real';
import {
  createProductMaintenanceIntent,
  classifyProductMaintenanceResponse
} from '../../packages/core/src/product-maintenance-api';
import type { ProductMaintenanceSnapshot } from '../../packages/core/src/product-maintenance-api';
import type { GatewayCredentials } from '../../packages/core/src/types';

const proof = () => parseProductPriceCreationProof(fixture.proof, fixture.proof.product.id, fixture.now);
function harness(name: 'tiered' | 'range' | 'sku' = 'tiered') {
  let current: ProductMaintenanceSnapshot = structuredClone(fixture.baseline[name]);
  let baseline: ProductPriceSmokeBaseline | null = null;
  let now = fixture.now;
  let writes = 0;
  const events: Readonly<Record<string, unknown>>[] = [];
  const write = vi.fn<ProductPriceSmokeIO['write']>((intent) => {
    current = structuredClone(++writes === 1 ? fixture.changed[name] : fixture.baseline[name]);
    return Promise.resolve(classifyProductMaintenanceResponse(intent.draft, fixture.responses.accepted));
  });
  const io: ProductPriceSmokeIO = {
    readProduct: vi.fn(() => Promise.resolve(structuredClone(current))),
    write,
    persistBaseline: vi.fn((value: ProductPriceSmokeBaseline) => {
      baseline = structuredClone(value);
      return Promise.resolve();
    }),
    readBaseline: vi.fn(() => Promise.resolve(structuredClone(baseline))),
    appendReceipt: vi.fn((event: Readonly<Record<string, unknown>>) => {
      events.push(structuredClone(event));
      return Promise.resolve();
    }),
    readReceipts: vi.fn(() => Promise.resolve(structuredClone(events))),
    wait: vi.fn((milliseconds: number) => {
      now += milliseconds;
      return Promise.resolve();
    }),
    now: () => now
  };
  return { io, write, events, baseline: () => baseline };
}
const artifactRoot = resolve(import.meta.dirname, '..', '..', 'artifacts');
const temporary: string[] = [];
beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('UNEXPECTED_REAL_NETWORK');
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const directory of temporary.splice(0)) {
    if (dirname(directory) !== artifactRoot || !directory.includes('price-smoke-offline-'))
      throw new Error('Unsafe temporary cleanup refused');
    await rm(directory, { recursive: true });
  }
});
const urlText = (input: RequestInfo | URL): string =>
  input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;

describe('explicit price-only scope and new-product proof', () => {
  it('requires explicit confirmation and all independent paths before any file I/O', async () => {
    expect(parseProductPriceSmokeOptions(fixture.cli).productId).toBe(fixture.proof.product.id);
    expect(() => parseProductPriceSmokeOptions(fixture.cli.slice(1))).toThrow(
      'EXPLICIT_CONFIRMATION_REQUIRED'
    );
    expect(() => parseProductPriceSmokeOptions([...fixture.cli, '--scope=full'])).toThrow('OPTIONS_INVALID');
    expect(() => parseProductPriceSmokeOptions([...fixture.cli, '--confirm-real-write'])).toThrow(
      'OPTIONS_INVALID'
    );
    await expect(runProductPriceSmokeCli([])).rejects.toThrow('EXPLICIT_CONFIRMATION_REQUIRED');
  });
  it.each(fixture.invalidProofs)('rejects source, stale, non-new or expanded proof %#', (value) => {
    expect(() => parseProductPriceCreationProof(value, fixture.proof.product.id, fixture.now)).toThrow();
  });
  it.each(fixture.invalidPlans)(
    'rejects inventory/draft operations and expanded or unsafe price plan %#',
    async (value) => {
      await expect(parseProductPricePlan(value, proof())).rejects.toThrow();
    }
  );
  it('refuses the source ID even if CLI and proof agree on it', () => {
    const source = fixture.invalidProofs.find(
      (value) => value.product.id !== fixture.proof.product.id && value.product.id.length > 6
    );
    if (!source) throw new Error('Missing protected-source fixture');
    expect(() => parseProductPriceCreationProof(source, source.product.id, fixture.now)).toThrow(
      'NEW_PRODUCT_ID_REQUIRED'
    );
  });
  it('cannot bypass an existing proof claim by choosing new output paths', async () => {
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(join(artifactRoot, 'price-smoke-offline-'));
    temporary.push(directory);
    const proofPath = join(directory, 'missing-proof.json');
    const handle = await open(proofPath + PRODUCT_PRICE_PROOF_CLAIM_SUFFIX, 'wx');
    await handle.close();
    await expect(
      runProductPriceSmokeCli([
        '--confirm-real-write',
        '--credential=' + join(directory, 'missing-credential.json'),
        '--creation-proof=' + proofPath,
        '--plan=' + join(directory, 'missing-plan.json'),
        '--product-id=' + fixture.proof.product.id,
        '--baseline=' + join(directory, 'different-baseline.json'),
        '--receipt=' + join(directory, 'different-receipt.jsonl')
      ])
    ).rejects.toThrow('PREVIOUS_ATTEMPT_NO_RESEND');
  });
  it('refuses an existing receipt before reading any credential or proof input', async () => {
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(join(artifactRoot, 'price-smoke-offline-'));
    temporary.push(directory);
    const receipt = join(directory, 'receipt.jsonl');
    const handle = await open(receipt, 'wx');
    await handle.close();
    await expect(
      runProductPriceSmokeCli([
        '--confirm-real-write',
        '--credential=' + join(directory, 'missing-credential.json'),
        '--creation-proof=' + join(directory, 'missing-proof.json'),
        '--plan=' + join(directory, 'missing-plan.json'),
        '--product-id=' + fixture.proof.product.id,
        '--baseline=' + join(directory, 'baseline.json'),
        '--receipt=' + receipt
      ])
    ).rejects.toThrow('OUTPUT_ALREADY_EXISTS');
  });
});

describe('price-only durable two-write roundtrip', () => {
  it.each(['tiered', 'range', 'sku'] as const)(
    'restores %s exactly with inventory unavailable and no other operation',
    async (name) => {
      const h = harness(name);
      const plan = await parseProductPricePlan(fixture.plans[name], proof());
      expect(await runProductPriceMaintenancePlan(plan, proof(), h.io)).toEqual({
        scope: 'price-only',
        price: 'restored',
        protocol: 'iop'
      });
      expect(h.write).toHaveBeenCalledTimes(2);
      expect(
        h.write.mock.calls.every(
          ([intent]) => intent.operation === 'setPrice' && intent.method === '/icbu/product/edit-price'
        )
      ).toBe(true);
      expect(h.events.filter((e) => e.phase === 'dispatching')).toHaveLength(2);
      expect(h.events.filter((e) => e.phase === 'readback-confirmed')).toHaveLength(2);
      expect(h.events.at(-1)?.phase).toBe('price-restored');
      expect(h.io.wait).toHaveBeenCalledTimes(2);
      expect(h.io.wait).toHaveBeenCalledWith(PRODUCT_PRICE_POLL_MS);
      expect(h.baseline()).not.toHaveProperty('inventory');
      expect(h.baseline()).not.toHaveProperty('snapshot');
      expect(JSON.stringify(h.baseline())).not.toContain('draft');
      const pending = h.events.filter((e) => e.phase === 'dispatching');
      expect(pending.map((e) => e.requestId)).toEqual(h.write.mock.calls.map(([, requestId]) => requestId));
    }
  );
  it('never silently runs a no-change price plan', async () => {
    const h = harness();
    await expect(
      runProductPriceMaintenancePlan(
        await parseProductPricePlan(fixture.plans.noChange, proof()),
        proof(),
        h.io
      )
    ).rejects.toThrow('PRICE_PLAN_UNCHANGED');
    expect(h.write).not.toHaveBeenCalled();
  });
  it('does not write when baseline persistence or readback fails', async () => {
    const plan = await parseProductPricePlan(fixture.plans.tiered, proof());
    const failed = harness();
    failed.io.persistBaseline = () => Promise.reject(new Error('Synthetic storage failure'));
    await expect(runProductPriceMaintenancePlan(plan, proof(), failed.io)).rejects.toThrow(
      'Synthetic storage failure'
    );
    expect(failed.write).not.toHaveBeenCalled();
    const corrupt = harness();
    corrupt.io.readBaseline = () => Promise.resolve(null);
    await expect(runProductPriceMaintenancePlan(plan, proof(), corrupt.io)).rejects.toThrow(
      'BASELINE_NOT_DURABLE'
    );
    expect(corrupt.write).not.toHaveBeenCalled();
  });
  it('must read the exact persisted pending receipt before dispatch', async () => {
    const h = harness();
    h.io.readReceipts = () => Promise.resolve([]);
    await expect(
      runProductPriceMaintenancePlan(
        await parseProductPricePlan(fixture.plans.tiered, proof()),
        proof(),
        h.io
      )
    ).rejects.toThrow('RECEIPT_NOT_DURABLE');
    expect(h.write).not.toHaveBeenCalled();
  });
  it('stops on pending-receipt storage failure before a write', async () => {
    const h = harness();
    const append = h.io.appendReceipt;
    h.io.appendReceipt = (e) =>
      e.phase === 'dispatching' ? Promise.reject(new Error('Synthetic storage failure')) : append(e);
    await expect(
      runProductPriceMaintenancePlan(
        await parseProductPricePlan(fixture.plans.tiered, proof()),
        proof(),
        h.io
      )
    ).rejects.toThrow('Synthetic storage failure');
    expect(h.write).not.toHaveBeenCalled();
  });
  it('does not restore, resend or expose raw data after unknown forward outcome', async () => {
    const h = harness();
    h.write.mockRejectedValue(fixture.responses.unknown);
    const plan = await parseProductPricePlan(fixture.plans.tiered, proof());
    await expect(runProductPriceMaintenancePlan(plan, proof(), h.io)).rejects.toThrow(
      'WRITE_OUTCOME_UNKNOWN'
    );
    expect(h.write).toHaveBeenCalledTimes(1);
    expect(h.events.find((e) => e.phase === 'unknown')?.result).toMatchObject({
      errorCode: 'NETWORK_ERROR',
      subCode: 'socket-closed'
    });
    expect(JSON.stringify(h.events)).not.toContain(fixture.marker);
    await expect(runProductPriceMaintenancePlan(plan, proof(), h.io)).rejects.toThrow(
      'PREVIOUS_ATTEMPT_NO_RESEND'
    );
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it('does not attempt a third write after unknown restoration', async () => {
    const h = harness();
    const original = h.write.getMockImplementation();
    if (!original) throw new Error('Missing synthetic implementation');
    h.write.mockImplementationOnce(original).mockRejectedValue(fixture.responses.unknown);
    await expect(
      runProductPriceMaintenancePlan(
        await parseProductPricePlan(fixture.plans.tiered, proof()),
        proof(),
        h.io
      )
    ).rejects.toThrow('WRITE_OUTCOME_UNKNOWN');
    expect(h.write).toHaveBeenCalledTimes(2);
  });
  it('retains sanitized explicit rejection without compensation', async () => {
    const h = harness();
    h.write.mockImplementation((intent) =>
      Promise.resolve(classifyProductMaintenanceResponse(intent.draft, fixture.responses.rejected))
    );
    await expect(
      runProductPriceMaintenancePlan(
        await parseProductPricePlan(fixture.plans.tiered, proof()),
        proof(),
        h.io
      )
    ).rejects.toThrow('WRITE_NOT_ACCEPTED');
    expect(h.write).toHaveBeenCalledTimes(1);
    expect(h.events.find((e) => e.phase === 'rejected')?.result).toMatchObject({
      errorCode: fixture.responses.rejected.result.msg_code
    });
    expect(JSON.stringify(h.events)).not.toContain(fixture.marker);
  });
  it('limits polls to five minutes, with at least five seconds between reads and no write retry', async () => {
    const h = harness();
    h.write.mockImplementation((intent) =>
      Promise.resolve(classifyProductMaintenanceResponse(intent.draft, fixture.responses.accepted))
    );
    await expect(
      runProductPriceMaintenancePlan(
        await parseProductPricePlan(fixture.plans.tiered, proof()),
        proof(),
        h.io
      )
    ).rejects.toThrow('READBACK_UNRESOLVED');
    expect(h.io.wait).toHaveBeenCalledTimes(PRODUCT_PRICE_VERIFY_MS / PRODUCT_PRICE_POLL_MS);
    expect(h.io.now() - fixture.now).toBe(PRODUCT_PRICE_VERIFY_MS);
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it('blocks drift before the first write and concurrent change before restoration', async () => {
    const plan = await parseProductPricePlan(fixture.plans.tiered, proof());
    const before = harness();
    let reads = 0;
    before.io.readProduct = () =>
      Promise.resolve(structuredClone(++reads === 1 ? fixture.baseline.tiered : fixture.concurrent));
    await expect(runProductPriceMaintenancePlan(plan, proof(), before.io)).rejects.toThrow(
      'BASELINE_CHANGED'
    );
    expect(before.write).not.toHaveBeenCalled();
    const during = harness();
    const original = during.io.readProduct;
    reads = 0;
    during.io.readProduct = (id, timeout) =>
      ++reads === 4 ? Promise.resolve(structuredClone(fixture.concurrent)) : original(id, timeout);
    await expect(runProductPriceMaintenancePlan(plan, proof(), during.io)).rejects.toThrow(
      'CONCURRENT_CHANGE_STOPPED_RESTORATION'
    );
    expect(during.write).toHaveBeenCalledTimes(1);
  });
  it('does not swallow receipt failure as a retryable read error', async () => {
    const h = harness();
    const append = h.io.appendReceipt;
    h.io.appendReceipt = (e) =>
      e.phase === 'readback-confirmed' ? Promise.reject(new Error('Synthetic storage failure')) : append(e);
    await expect(
      runProductPriceMaintenancePlan(
        await parseProductPricePlan(fixture.plans.tiered, proof()),
        proof(),
        h.io
      )
    ).rejects.toThrow('Synthetic storage failure');
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it('rejects raw fields in returned receipts before persisting them', async () => {
    const h = harness();
    h.write.mockImplementation((intent) =>
      Promise.resolve(
        Object.assign(classifyProductMaintenanceResponse(intent.draft, fixture.responses.accepted), {
          message: fixture.marker,
          body: { private: fixture.marker }
        })
      )
    );
    await expect(
      runProductPriceMaintenancePlan(
        await parseProductPricePlan(fixture.plans.tiered, proof()),
        proof(),
        h.io
      )
    ).rejects.toThrow('WRITE_OUTCOME_UNKNOWN');
    expect(JSON.stringify(h.events)).not.toContain(fixture.marker);
    expect(h.write).toHaveBeenCalledTimes(1);
  });
});

describe('strict price-only network boundary with synthetic transport', () => {
  it.each(fixture.transport.forbidden)('cannot arm non-price write %s', (method) => {
    const send = vi.fn(() => Promise.resolve(Response.json(fixture.responses.accepted)));
    const guard = new ProductPriceGuardedTransport({ send });
    expect(() => {
      guard.arm(method, fixture.transport.url, new URLSearchParams(fixture.transport.body));
    }).toThrow('TRANSPORT_SCOPE_DENIED');
    expect(send).not.toHaveBeenCalled();
  });
  it('requires exact armed POST/body and refuses redirects or a third price write', async () => {
    const send = vi.fn(() => Promise.resolve(Response.json(fixture.responses.accepted)));
    const guard = new ProductPriceGuardedTransport({ send });
    const body = () => new URLSearchParams(fixture.transport.body);
    await expect(
      guard.send(fixture.transport.url, { method: 'POST', redirect: 'manual', body: body() })
    ).rejects.toThrow();
    guard.arm('/icbu/product/edit-price', fixture.transport.url, body());
    await expect(
      guard.send(fixture.transport.url, {
        method: 'POST',
        redirect: 'manual',
        body: new URLSearchParams(fixture.transport.changedBody)
      })
    ).rejects.toThrow();
    for (let i = 0; i < 2; i++) {
      guard.arm('/icbu/product/edit-price', fixture.transport.url, body());
      await guard.send(fixture.transport.url, { method: 'POST', redirect: 'manual', body: body() });
    }
    guard.arm('/icbu/product/edit-price', fixture.transport.url, body());
    await expect(
      guard.send(fixture.transport.url, { method: 'POST', redirect: 'manual', body: body() })
    ).rejects.toThrow('WRITE_BUDGET_EXHAUSTED');
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('signs fixed price/get calls through NetworkManager and actual contracts without global fetch', async () => {
    const send = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        Response.json(
          urlText(input).endsWith('/get/v2') ? fixture.responses.read : fixture.responses.accepted
        )
      )
    );
    const client = createProductPriceAcceptanceClient({
      credentials: fixture.credentials as GatewayCredentials,
      proof: proof(),
      transport: { send }
    });
    expect((await client.readProduct(fixture.proof.product.id)).inventory).toBeNull();
    const intent = await createProductMaintenanceIntent(fixture.plans.tiered.price);
    expect((await client.write(intent, fixture.requestId)).status).toBe('accepted');
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      send.mock.calls.every(
        ([url]) => urlText(url).endsWith('/get/v2') || urlText(url).endsWith('/edit-price')
      )
    ).toBe(true);
  });
  it('keeps contract-invalid replies unknown and never retries transport errors', async () => {
    const send = vi.fn(() => Promise.resolve(Response.json(fixture.responses.malformed)));
    const client = createProductPriceAcceptanceClient({
      credentials: fixture.credentials as GatewayCredentials,
      proof: proof(),
      transport: { send }
    });
    await expect(
      client.write(await createProductMaintenanceIntent(fixture.plans.tiered.price), fixture.requestId)
    ).rejects.toThrow('RESPONSE_CONTRACT_INVALID');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('rejects another product and inventory intents before any transport call', async () => {
    const send = vi.fn(() => Promise.resolve(Response.json(fixture.responses.accepted)));
    const client = createProductPriceAcceptanceClient({
      credentials: fixture.credentials as GatewayCredentials,
      proof: proof(),
      transport: { send }
    });
    await expect(client.readProduct(fixture.proof.product.id + '0')).rejects.toThrow(
      'NEW_PRODUCT_ID_REQUIRED'
    );
    const bad = fixture.invalidPlans[0];
    if (!bad || !('inventory' in bad)) throw new Error('Missing scope fixture');
    await expect(
      client.write(await createProductMaintenanceIntent(bad.inventory), fixture.requestId)
    ).rejects.toThrow('PRICE_PLAN_SCOPE_MISMATCH');
    expect(send).not.toHaveBeenCalled();
  });
});
