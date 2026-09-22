import { describe, expect, it, vi } from 'vitest';
import { fingerprint, type InventoryCell } from '../lib/free-api-real-smoke';
import { createAlibabaRequest } from '../../packages/core/src/signing';
import { validateCapabilityRequest } from '../../packages/core/src/capability-validation-lazy';
import {
  assertInventoryRebaseline,
  INVENTORY_UPDATE_METHOD,
  observeInventoryTransition,
  restoreDelayedInventory
} from '../lib/inventory-rebaseline';

const cell: InventoryCell = { skuId: 2, code: 'W', quantity: 10 };
const baseline: InventoryCell[] = [cell];
const expected = [{ ...cell, quantity: 11 }];
const prior = fingerprint([INVENTORY_UPDATE_METHOD, ['account', 1, [[2, 'W']]]]);
const unresolved = [{ key: prior, method: INVENTORY_UPDATE_METHOD }];

describe('explicit fresh inventory baseline', () => {
  it('restores once only when the complete delayed plus snapshot matches', async () => {
    const values = [expected, expected, baseline];
    const write = vi.fn(() => Promise.resolve({ status: 'passed' as const, reason: 'ACK' }));
    const result = await restoreDelayedInventory({
      baseline,
      read: () => Promise.resolve(values.shift() ?? null),
      write,
      record: () => Promise.resolve(),
      wait: () => Promise.resolve()
    });
    expect(result.status).toBe('passed');
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('never subtracts from changed stock or when durable sub intent already exists', async () => {
    const write = vi.fn(() => Promise.resolve({ status: 'passed' as const, reason: 'ACK' }));
    expect(
      (
        await restoreDelayedInventory({
          baseline,
          read: () => Promise.resolve(baseline),
          write,
          record: () => Promise.resolve(),
          wait: () => Promise.resolve()
        })
      ).status
    ).toBe('skipped-prerequisite');
    await expect(
      restoreDelayedInventory({
        baseline,
        read: () => Promise.resolve(expected),
        write,
        record: () => Promise.reject(new Error('EEXIST')),
        wait: () => Promise.resolve()
      })
    ).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
  it('serializes the documented delta inside request_param and retains session authorization', async () => {
    const parameters = {
      request_param: {
        product_id: 1,
        inventory_list: [{ sku_id: 2, inventory_code: 'W', inventory: 1, operate: 'plus' }]
      }
    };
    expect(await validateCapabilityRequest(INVENTORY_UPDATE_METHOD, parameters)).toEqual([]);
    const wire = createAlibabaRequest(
      {
        appKey: 'test-key',
        appSecret: 'test-secret',
        accessToken: 'test-token',
        endpoint: 'https://eco.taobao.com/router/rest',
        signMethod: 'hmac-sha256'
      },
      INVENTORY_UPDATE_METHOD,
      parameters
    );
    const encoded = new URLSearchParams(wire);
    expect(JSON.parse(encoded.get('request_param') ?? '')).toEqual(parameters.request_param);
    expect(encoded.get('session')).toBe('test-token');
    expect(encoded.get('simplify')).toBe('true');
    expect(encoded.get('sign')).toMatch(/^[A-F0-9]{64}$/);
  });
  it('accepts only the exact historical target; never clears its unresolved record', () => {
    const snapshot = JSON.stringify(unresolved);
    expect(() => {
      assertInventoryRebaseline(prior, unresolved, 'account', 1, baseline);
    }).not.toThrow();
    expect(JSON.stringify(unresolved)).toBe(snapshot);
    for (const [account, product] of [
      ['different', 1],
      ['account', 3]
    ] as const) {
      expect(() => {
        assertInventoryRebaseline(prior, unresolved, account, product, baseline);
      }).toThrow();
    }
    expect(() => {
      assertInventoryRebaseline(prior, [...unresolved, ...unresolved], 'account', 1, baseline);
    }).toThrow();
    expect(() => {
      assertInventoryRebaseline(prior, [], 'account', 1, baseline);
    }).toThrow();
  });
  it('allows delayed read propagation without resending mutations', async () => {
    const read = vi.fn().mockResolvedValueOnce(baseline).mockResolvedValueOnce(expected);
    const wait = vi.fn(() => Promise.resolve());
    expect(await observeInventoryTransition({ before: baseline, expected, read, wait })).toEqual(expected);
    expect(read).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });
  it('stops on errors or unexpected/concurrent stock changes', async () => {
    for (const result of [null, [{ ...cell, quantity: 13 }], []]) {
      const read = vi.fn(() => Promise.resolve(result));
      const wait = vi.fn(() => Promise.resolve());
      expect(await observeInventoryTransition({ before: baseline, expected, read, wait })).toEqual(result);
      expect(read).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    }
  });
  it('limits unchanged readbacks and returns observed stock, never assumed success', async () => {
    const read = vi.fn(() => Promise.resolve(baseline));
    expect(
      await observeInventoryTransition({ before: baseline, expected, read, wait: () => Promise.resolve() })
    ).toEqual(baseline);
    expect(read).toHaveBeenCalledTimes(4);
  });
});
