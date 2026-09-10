import { describe, it, expect, vi } from 'vitest';
import fixture from '../../../mock/data/showcase-management.json';
import { ProductShowcaseAdapter } from '../src/product-showcase';
import type { AlibabaClient } from '../src/alibaba-client';

function setup(
  options: { full?: boolean; outcome?: unknown; readbackFailure?: boolean; timeout?: boolean } = {}
) {
  let wrote = false;
  let removed = false;
  const call = vi.fn<AlibabaClient['call']>(async (method, parameters) => {
    await Promise.resolve();
    if (method.endsWith('addproduct') || method.endsWith('deleteproduct')) {
      wrote = true;
      removed = method.endsWith('deleteproduct');
      if (options.timeout) throw new Error('fetch failed');
      return { method, data: options.outcome === undefined ? fixture.acknowledgement : options.outcome };
    }
    if (wrote && options.readbackFailure) throw new Error('Readback failed');
    if (method.endsWith('status'))
      return {
        method,
        data: { ...fixture.status, current_count: options.full ? 2 : wrote ? (removed ? 0 : 2) : 1 }
      };
    if (parameters.to_page !== 1) return { method, data: { results: [] } };
    return {
      method,
      data: options.full || (wrote && !removed) ? fixture.after : wrote ? { results: [] } : fixture.before
    };
  });
  return { adapter: new ProductShowcaseAdapter({ call }), call };
}
describe('dedicated showcase adapter', () => {
  it('adds once with preflight, acknowledgement and complete readback', async () => {
    const { adapter, call } = setup();
    expect(await adapter.mutate('add', { product_id_list: ['10000002'] })).toMatchObject({
      outcome: 'confirmed',
      snapshot: { used: 2 },
      traceId: 'showcase-test-trace'
    });
    expect(call.mock.calls.filter(([method]) => method.endsWith('addproduct'))).toHaveLength(1);
  });
  it('removes by window ID, never by product ID', async () => {
    const { adapter, call } = setup();
    expect(await adapter.mutate('remove', { window_id_list: ['8001'] })).toMatchObject({
      outcome: 'confirmed',
      snapshot: { used: 0 }
    });
    expect(call.mock.calls.find(([method]) => method.endsWith('deleteproduct'))?.[1]).toEqual({
      window_id_list: ['8001']
    });
    await expect(setup().adapter.mutate('remove', { window_id_list: ['10000001'] })).rejects.toThrow(
      'SHOWCASE_BASELINE_CHANGED'
    );
  });
  it('rejects invalid IDs without any network, full quota without writing, and duplicates', async () => {
    const invalid = setup();
    await expect(invalid.adapter.mutate('add', { product_id_list: ['1', '1'] })).rejects.toThrow(
      'REQUEST_CONTRACT_INVALID'
    );
    expect(invalid.call).not.toHaveBeenCalled();
    const full = setup({ full: true });
    await expect(full.adapter.mutate('add', { product_id_list: ['10000003'] })).rejects.toThrow(
      'SHOWCASE_FULL'
    );
    expect(full.call.mock.calls.every(([method]) => !method.endsWith('addproduct'))).toBe(true);
    await expect(setup().adapter.mutate('add', { product_id_list: ['10000001'] })).rejects.toThrow(
      'SHOWCASE_ALREADY_PRESENT'
    );
  });
  it.each([{}, { result: false }, { result: 'true' }])('does not mistake %j for success', async (outcome) => {
    await expect(
      setup({ outcome }).adapter.mutate('add', { product_id_list: ['10000002'] })
    ).rejects.toBeInstanceOf(Error);
  });
  it('keeps acknowledged writes unconfirmed when readback fails; timeouts never resend', async () => {
    expect(
      await setup({ readbackFailure: true }).adapter.mutate('add', { product_id_list: ['10000002'] })
    ).toMatchObject({ outcome: 'unconfirmed', snapshot: null });
    const timeout = setup({ timeout: true });
    await expect(timeout.adapter.mutate('add', { product_id_list: ['10000002'] })).rejects.toThrow(
      'fetch failed'
    );
    expect(timeout.call.mock.calls.filter(([method]) => method.endsWith('addproduct'))).toHaveLength(1);
  });
  it('reads more than a page and detects repeated pages, unsafe IDs and missing rows', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      ...fixture.before.results[0],
      id: index + 1,
      product_id: index + 100
    }));
    let repeat = false;
    const call = vi.fn<AlibabaClient['call']>((method, params) =>
      Promise.resolve({
        method,
        data: method.endsWith('status')
          ? { total_count: 30, current_count: rows.length }
          : { results: repeat || params.to_page === 1 ? rows.slice(0, 20) : rows.slice(20) }
      })
    );
    expect((await new ProductShowcaseAdapter({ call }).get()).entries).toHaveLength(21);
    repeat = true;
    await expect(new ProductShowcaseAdapter({ call }).get()).rejects.toThrow('SHOWCASE_INCOMPLETE');
    const bad = vi
      .fn<AlibabaClient['call']>()
      .mockResolvedValue({ method: 'status', data: { total_count: 2 } });
    await expect(new ProductShowcaseAdapter({ call: bad }).get()).rejects.toThrow('SHOWCASE_INCOMPLETE');
    repeat = false;
    rows[0] = { ...rows[0], id: Number.MAX_SAFE_INTEGER + 1, product_id: 100 };
    await expect(new ProductShowcaseAdapter({ call }).get()).rejects.toThrow('SHOWCASE_INCOMPLETE');
  });
});
