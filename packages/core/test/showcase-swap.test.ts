import { describe, expect, it } from 'vitest';
import { runShowcaseSwap } from '../../../scripts/lib/showcase-swap';
import type { ShowcaseEntry } from '../../../scripts/lib/showcase-smoke';
import { unwrapShowcaseResponse, mutationConfirmed } from '../../../scripts/lib/showcase-smoke';

const original = { windowId: '1', productId: '11' };
const retained = { windowId: '2', productId: '22' };
function harness(
  fault?: 'vacate-reject' | 'add-reject' | 'add-unknown' | 'delete-unknown' | 'restore-reject'
) {
  let rows: ShowcaseEntry[] = [original, retained];
  const calls: string[] = [];
  const stages: string[] = [];
  return {
    calls,
    stages,
    rows: () => rows,
    run: () =>
      runShowcaseSwap({
        before: [original, retained],
        original,
        targetId: '33',
        list: () => Promise.resolve(rows.map((row) => ({ ...row }))),
        checkpoint: (stage) => {
          stages.push(stage);
          return Promise.resolve();
        },
        mutate: (method, parameters) => {
          const sequence = calls.length;
          calls.push(`${method}:${JSON.stringify(parameters)}`);
          if (sequence === 0 && fault === 'vacate-reject') return Promise.resolve(false);
          if (method.endsWith('deleteproduct')) {
            const ids = parameters.window_id_list;
            if (!Array.isArray(ids)) throw new Error('BAD_TEST_REQUEST');
            rows = rows.filter((row) => !ids.includes(row.windowId));
            return Promise.resolve(!(sequence === 2 && fault === 'delete-unknown'));
          }
          const ids = parameters.product_id_list;
          if (!Array.isArray(ids) || typeof ids[0] !== 'string') throw new Error('BAD_TEST_REQUEST');
          if ((ids[0] === '33' && fault === 'add-reject') || (ids[0] === '11' && fault === 'restore-reject'))
            return Promise.resolve(false);
          rows.push({ windowId: ids[0] === '33' ? '3' : '4', productId: ids[0] });
          return Promise.resolve(!(sequence === 1 && fault === 'add-unknown'));
        }
      })
  };
}

describe('authorized one-slot showcase swap', () => {
  it('accepts both TOP simplified and wrapped receipts without accepting missing success', () => {
    const method = 'alibaba.scbp.showcase.addproduct';
    expect(mutationConfirmed(unwrapShowcaseResponse({ result: true }, method))).toBe(true);
    expect(
      mutationConfirmed(
        unwrapShowcaseResponse({ alibaba_scbp_showcase_addproduct_response: { result: true } }, method)
      )
    ).toBe(true);
    expect(
      mutationConfirmed(
        unwrapShowcaseResponse({ alibaba_scbp_showcase_addproduct_response: null, result: true }, method)
      )
    ).toBe(false);
    expect(mutationConfirmed(unwrapShowcaseResponse({}, method))).toBe(false);
  });
  it('makes exactly four mutations and restores original products with a new window ID', async () => {
    const test = harness();
    await test.run();
    expect(test.calls).toHaveLength(4);
    expect(test.rows()).toEqual([retained, { windowId: '4', productId: '11' }]);
    expect(test.stages.at(-1)).toBe('swap-restored');
    expect(test.calls.some((call) => call.includes('window_id_list":["2"]'))).toBe(false);
  });
  it('stops after a rejected vacancy without touching other entries', async () => {
    const test = harness('vacate-reject');
    await expect(test.run()).rejects.toThrow();
    expect(test.calls).toHaveLength(1);
    expect(test.rows()).toEqual([original, retained]);
  });
  it('restores the original after a failed test add, without retrying the add', async () => {
    const test = harness('add-reject');
    await expect(test.run()).rejects.toThrow();
    expect(test.calls).toHaveLength(3);
    expect(test.rows()).toEqual([retained, { windowId: '4', productId: '11' }]);
  });
  it('does not guess ownership or delete a target when its add receipt is unknown', async () => {
    const test = harness('add-unknown');
    await expect(test.run()).rejects.toThrow('MANUAL_RECOVERY');
    expect(test.calls).toHaveLength(2);
  });
  it('restores the original after readback proves target removal, but reports an uncertain receipt', async () => {
    const test = harness('delete-unknown');
    await expect(test.run()).rejects.toThrow('RECEIPT_UNKNOWN');
    expect(test.calls).toHaveLength(4);
    expect(test.rows()).toEqual([retained, { windowId: '4', productId: '11' }]);
  });
  it('never retries a rejected restoration', async () => {
    const test = harness('restore-reject');
    await expect(test.run()).rejects.toThrow();
    expect(test.calls).toHaveLength(4);
  });
});
