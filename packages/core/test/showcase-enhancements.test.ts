import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/showcase-management.json';
import products from '../../../mock/data/showcase-enhancements.json';
import sortFixture from '../../../mock/data/showcase-sort.json';
import replaceFixture from '../../../mock/data/showcase-replace.json';
import { ProductShowcaseAdapter, showcaseBaseline } from '../src/product-showcase';
import {
  findCapability,
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../src/capability-registry';
import type { AlibabaClient } from '../src/alibaba-client';

function setup(
  options: {
    timeout?: boolean;
    drift?: boolean;
    readFailure?: boolean;
    offline?: boolean;
    acknowledge?: unknown;
  } = {}
) {
  let rows = structuredClone(fixture.after.results);
  let wrote = false;
  const call = vi.fn<AlibabaClient['call']>(async (method, params) => {
    await Promise.resolve();
    if (method === 'alibaba.icbu.product.list')
      return { method, data: options.offline ? products.offlineProduct : products.onlineProduct };
    if (method.endsWith('.sort') || method.endsWith('.updateproduct')) {
      wrote = true;
      if (options.timeout) throw new Error('timeout');
      if (method.endsWith('.sort')) rows = rows.toReversed();
      else
        rows = rows.map((row) =>
          String(row.id) === params.window_id ? { ...row, product_id: Number(params.new_product_id) } : row
        );
      return { method, data: options.acknowledge ?? fixture.acknowledgement };
    }
    if (wrote && options.readFailure) throw new Error('readback failed');
    if (method.endsWith('.status')) return { method, data: { total_count: 2, current_count: rows.length } };
    return { method, data: { results: wrote && options.drift ? rows.toReversed() : rows } };
  });
  const adapter = new ProductShowcaseAdapter({ call });
  return { adapter, call };
}

describe('showcase sort and replace', () => {
  it.each([sortFixture, replaceFixture])(
    'keeps $method typed and unavailable to generic real mutations',
    async (sample) => {
      expect(findCapability(sample.method)).toMatchObject({ risk: 'mutation', realCallEnabled: false });
      expect(await validateCapabilityRequest(sample.method, sample.request)).toEqual([]);
      expect(await validateCapabilityResponse(sample.method, sample.response)).toEqual([]);
      expect(
        await validateCapabilityRequest(sample.method, { ...sample.request, window_id: 1.5 })
      ).not.toEqual([]);
    }
  );
  it('moves one entry using 1-based positions and verifies the entire ordered baseline', async () => {
    const { adapter, call } = setup();
    const expectedEntries = showcaseBaseline(await adapter.get());
    const result = await adapter.sort({ windowId: '8001', sourceOrder: 1, targetOrder: 2, expectedEntries });
    expect(result.outcome).toBe('confirmed');
    expect(result.snapshot?.entries.map((row) => row.windowId)).toEqual(['8002', '8001']);
    expect(call.mock.calls.filter(([method]) => method.endsWith('.sort'))).toEqual([
      ['alibaba.scbp.showcase.sort', { window_id: '8001', source_order: 1, target_order: 2 }]
    ]);
  });
  it('rejects invalid sorting before any reads and rejects stale or duplicated baselines without writes', async () => {
    const { adapter, call } = setup();
    await expect(
      adapter.sort({ windowId: '8001', sourceOrder: 0, targetOrder: 2, expectedEntries: [] })
    ).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
    const baseline = showcaseBaseline(await adapter.get());
    await expect(
      adapter.sort({
        windowId: '8002',
        sourceOrder: 1,
        targetOrder: 2,
        expectedEntries: baseline.toReversed()
      })
    ).rejects.toThrow('SHOWCASE_BASELINE_CHANGED');
    await expect(
      adapter.sort({
        windowId: '8001',
        sourceOrder: 1,
        targetOrder: 2,
        expectedEntries: baseline.slice(0, 1).concat(baseline.slice(0, 1))
      })
    ).rejects.toThrow('SHOWCASE_BASELINE_CHANGED');
    expect(call.mock.calls.some(([method]) => method.endsWith('.sort'))).toBe(false);
  });
  it('replaces a full slot directly, verifies online status and never deletes or adds slots', async () => {
    const { adapter, call } = setup();
    const result = await adapter.replace({
      windowId: '8001',
      newProductId: '10000003',
      expectedEntries: showcaseBaseline(await adapter.get())
    });
    expect(result.outcome).toBe('confirmed');
    expect(result.snapshot?.entries[0]).toMatchObject({ windowId: '8001', productId: '10000003' });
    expect(
      call.mock.calls.filter(([method]) => /sort|updateproduct|addproduct|deleteproduct/.test(method))
    ).toEqual([['alibaba.scbp.showcase.updateproduct', { window_id: '8001', new_product_id: '10000003' }]]);
  });
  it('rejects offline or already included replacement products without writes', async () => {
    const { adapter, call } = setup({ offline: true });
    const expectedEntries = showcaseBaseline(await adapter.get());
    await expect(
      adapter.replace({ windowId: '8001', newProductId: '10000003', expectedEntries })
    ).rejects.toThrow('SHOWCASE_PRODUCT_NOT_ONLINE');
    await expect(
      adapter.replace({ windowId: '8001', newProductId: '10000002', expectedEntries })
    ).rejects.toThrow('SHOWCASE_ALREADY_PRESENT');
    expect(call.mock.calls.some(([method]) => method.endsWith('.updateproduct'))).toBe(false);
  });
  it.each([{ drift: true }, { readFailure: true }])(
    'keeps acknowledgement unconfirmed on readback problems %j',
    async (options) => {
      const { adapter } = setup(options);
      expect(
        (
          await adapter.sort({
            windowId: '8001',
            sourceOrder: 1,
            targetOrder: 2,
            expectedEntries: showcaseBaseline(await adapter.get())
          })
        ).outcome
      ).toBe('unconfirmed');
    }
  );
  it.each([{ timeout: true }, { acknowledge: {} }, { acknowledge: { result: false } }])(
    'does not resend uncertain or rejected writes %j',
    async (options) => {
      const { adapter, call } = setup(options);
      const expectedEntries = showcaseBaseline(await adapter.get());
      await expect(
        adapter.sort({ windowId: '8001', sourceOrder: 1, targetOrder: 2, expectedEntries })
      ).rejects.toThrow();
      expect(call.mock.calls.filter(([method]) => method.endsWith('.sort'))).toHaveLength(1);
    }
  );
});
