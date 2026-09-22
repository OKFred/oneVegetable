import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  authorize,
  planRead,
  collectContext,
  safeId,
  losslessOrderWireParameters,
  responseShape,
  assess,
  assessError,
  diagnosticCode,
  SequentialCalls,
  WriteReceipts,
  inventoryCells,
  inventoryRoundTrip,
  type InventoryCell,
  type Assessment
} from '../lib/free-api-real-smoke';

describe('free API real smoke independent safety boundary', () => {
  it('requires mode AND exact reviewed method; rejects global bypass and opposite risk', () => {
    const method = 'alibaba.dropshipping.token.create';
    expect(() => {
      authorize(method, 'write', { read: true, write: false, allow: new Set([method]) });
    }).toThrow();
    expect(() => {
      authorize(method, 'write', { read: true, write: true, allow: new Set(['*']) });
    }).toThrow();
    expect(() => {
      authorize(method, 'read', { read: true, write: true, allow: new Set([method]) });
    }).toThrow();
    expect(() => {
      authorize('unreviewed.write', 'write', {
        read: true,
        write: true,
        allow: new Set(['unreviewed.write'])
      });
    }).toThrow();
    expect(() => {
      authorize(method, 'write', { read: true, write: true, allow: new Set([method]) });
    }).not.toThrow();
  });
  it('never falls back to example business IDs or optional-but-required-in-practice queries', () => {
    for (const method of [
      'alibaba.icbu.product.id.encrypt',
      'alibaba.icbu.topic.products',
      'alibaba.icbu.distribution.product.get',
      'alibaba.order.pay.result.query',
      'alibaba.seller.vendor.service.process',
      'alibaba.icbu.text.recognize',
      'arbitrary.get'
    ]) {
      expect(planRead(method, {}).kind).toBe('skip');
    }
    expect(planRead('alibaba.icbu.product.id.encrypt', { productId: 123456 })).toEqual({
      kind: 'call',
      parameters: { product_id: 123456, language: 'en_US' }
    });
    expect(planRead('alibaba.icbu.trade.assurance.account.get', {})).toEqual({
      kind: 'call',
      parameters: {}
    });
  });
  it('collects only source-bound identities, never nested unrelated IDs or numeric truncation', () => {
    expect(safeId('9007199254740993')).toBeUndefined();
    expect(collectContext('alibaba.icbu.product.list', { unrelated: { id: 777 } }, {})).toEqual({});
    expect(collectContext('alibaba.icbu.product.list', { products: [{ id: 4321 }] }, {})).toEqual({
      productId: 4321
    });
    expect(
      collectContext(
        'alibaba.seller.order.list',
        { result: { value: { order_list: [{ trade_id: '4321' }] } } },
        {}
      )
    ).toEqual({ tradeId: 4321 });
    expect(
      collectContext('alibaba.icbu.distribution.product.query', { products: [{ secret_id: 'opaque' }] }, {})
    ).toEqual({ distributionSecretId: 'opaque' });
  });
  it('preserves exact long order IDs only on two reviewed read-only TOP scalar fields', () => {
    const id = '9007199254740993';
    expect(losslessOrderWireParameters('alibaba.order.pay.result.query', { trade_id: id })).toBe(true);
    expect(losslessOrderWireParameters('alibaba.dropshipping.order.pay', { trade_id: id })).toBe(false);
    expect(losslessOrderWireParameters('alibaba.order.pay.result.query', { trade_id: Number(id) })).toBe(
      false
    );
    expect(
      losslessOrderWireParameters('alibaba.order.pay.result.query', { trade_id: id, session: 'secret' })
    ).toBe(false);
    expect(losslessOrderWireParameters('alibaba.order.pay.result.query', { trade_id: '9e20' })).toBe(false);
    expect(
      collectContext(
        'alibaba.seller.order.list',
        { result: { value: { order_list: [{ trade_id: id }] } } },
        {}
      )
    ).toEqual({ tradeId: id });
  });
  it('passes a per-call UUID through AlibabaClient to the real transport header', async () => {
    const { AlibabaClient } = await import('../../packages/core/src/alibaba-client');
    const { NetworkManager } = await import('../../packages/core/src/network');
    const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
    const observed: (string | null)[] = [];
    const network = new NetworkManager({
      policies: { alibaba: { allowedOrigins: ['https://eco.taobao.com'] } },
      transport: {
        send: (_input, init) => {
          observed.push(new Headers(init.headers).get('X-Request-ID'));
          return Promise.resolve(
            new Response(JSON.stringify({ value: true }), { headers: { 'content-type': 'application/json' } })
          );
        }
      }
    });
    for (const requestId of ids) {
      const client = new AlibabaClient(
        {
          appKey: 'test-key',
          appSecret: 'test-secret',
          accessToken: 'test-token',
          endpoint: 'https://eco.taobao.com/router/rest',
          signMethod: 'hmac'
        },
        network,
        { maxAttempts: 1, requestId }
      );
      await client.call('alibaba.order.pay.result.query', { trade_id: '9007199254740993' });
    }
    expect(observed).toEqual(ids);
  });
  it('distinguishes empty inventory, zero inventory, malformed success and business rejection', () => {
    const m = 'alibaba.icbu.product.sku.inventory.get';
    expect(assess(m, { result: { success: true, data_list: [] } }, true).status).toBe('no-data');
    expect(assess(m, { result: { success: true, data_list: [{ inventory: 0 }] } }, true).status).toBe(
      'passed'
    );
    expect(assess(m, {}, true).status).toBe('contract-drift');
    expect(assess(m, { result: { success: false, data_list: [] } }, true).status).toBe('provider-error');
    expect(assess(m, { result: { success: true, data_list: [] } }, false).status).toBe('contract-drift');
    expect(assess('alibaba.icbu.industry.topic.list', { record_count: 0 }, true).status).toBe('no-data');
    expect(assess('alibaba.icbu.industry.topic.list', { record_count: 5 }, true).status).toBe(
      'contract-drift'
    );
  });
  it('checks nested errors instead of treating HTTP success as acceptance', () => {
    expect(
      assess(
        'alibaba.icbu.trade.assurance.account.get',
        { assurance_account_result: { success: false, error_code: 'isv.permission-api-package-limit' } },
        true
      ).status
    ).toBe('permission-denied');
    expect(assess('alibaba.icbu.text.recognize.trans', { result: [{ success: false }] }, true).status).toBe(
      'provider-error'
    );
    expect(assess('alibaba.dropshipping.token.create', {}, true, true).status).toBe('result-unknown');
    expect(
      assess('alibaba.dropshipping.token.create', { ecology_token: 'TOKEN_MUST_NOT_LEAK' }, true, true).status
    ).toBe('passed');
    for (const result of [{ success: true }, { data: 'true' }, { success: true, data: 'false' }, {}]) {
      expect(assess('alibaba.icbu.product.inventory.update', { result }, true, true).status).toBe(
        'result-unknown'
      );
    }
    expect(
      assess('alibaba.icbu.product.inventory.update', { result: { success: true, data: 'true' } }, true, true)
        .status
    ).toBe('passed');
  });
  it('keeps all scalar content, provider messages and opaque error codes out of diagnostics', () => {
    const secret = 'TOKEN_MUST_NOT_LEAK';
    expect(
      JSON.stringify(
        responseShape({
          access_token: secret,
          nested: { ecology_token: secret },
          url: `https://host/?token=${secret}`
        })
      )
    ).not.toContain(secret);
    expect(diagnosticCode(secret)).toBe('REDACTED_PROVIDER_CODE');
    const error = { gatewayError: { code: 'REQUEST_TIMEOUT', message: secret, traceId: secret } };
    expect(assessError(error, true).status).toBe('result-unknown');
    expect(assessError(error, false).status).toBe('provider-error');
    expect(assessError({ gatewayError: { code: '50' } }, true).status).toBe('result-unknown');
    expect(JSON.stringify(assessError(error, true))).not.toContain(secret);
    expect(
      assessError({ gatewayError: { code: '11', subCode: 'isv.permission-api-package-limit' } }, true).status
    ).toBe('permission-denied');
  });
  it('serializes even concurrent callers and spaces every completion by at least 350ms', async () => {
    let clock = 1000;
    let active = 0;
    let maximum = 0;
    const waits: number[] = [];
    const calls = new SequentialCalls(
      350,
      (ms: number) => {
        waits.push(ms);
        clock += ms;
        return Promise.resolve();
      },
      () => clock
    );
    const fn = async () => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      clock += 2;
      active--;
    };
    await Promise.all([calls.run(fn), calls.run(fn), calls.run(fn)]);
    expect(maximum).toBe(1);
    expect(waits).toEqual([350, 350]);
    expect(() => new SequentialCalls(349)).toThrow();
  });
  it('does not retry failures and still spaces the next method', async () => {
    let clock = 1000;
    const wait = vi.fn((ms: number) => {
      clock += ms;
      return Promise.resolve();
    });
    const calls = new SequentialCalls(350, wait, () => clock);
    const fail = vi.fn(() => Promise.reject(new Error('timeout')));
    await expect(calls.run(fail)).rejects.toThrow();
    await calls.run(() => Promise.resolve('next'));
    expect(fail).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(350);
  });
  it('creates durable intent before dispatch and refuses replay across instances or runs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'onevegetable-free-api-receipt-'));
    try {
      const ledger = new WriteReceipts(dir);
      const receipt = await ledger.begin('alibaba.dropshipping.token.create', 'stable-account');
      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      expect(await readFile(join(dir, files[0] ?? ''), 'utf8')).toContain('intent-before-dispatch');
      await expect(
        new WriteReceipts(dir).begin('alibaba.dropshipping.token.create', 'stable-account')
      ).rejects.toMatchObject({ code: 'EEXIST' });
      await receipt.record('result', { status: 'result-unknown', reason: 'NO_RETRY' });
      await expect(ledger.begin('alibaba.dropshipping.token.create', 'stable-account')).rejects.toMatchObject(
        { code: 'EEXIST' }
      );
      expect((await readdir(dir)).length).toBe(2);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
  it('requires recoverable inventory baseline and retains an unknown-write stop across restarts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'onevegetable-free-api-recovery-'));
    try {
      const ledger = new WriteReceipts(dir);
      const method = 'alibaba.icbu.product.inventory.update';
      await expect(ledger.begin(method, 'target')).rejects.toThrow('INVENTORY_RECOVERY_BASELINE_REQUIRED');
      const recovery = { productId: 123, baseline: [{ skuId: 456, code: 'W', quantity: 222 }] };
      const receipt = await ledger.begin(method, 'target', recovery);
      const file = (await readdir(dir)).find((f) => f.endsWith('.intent.json')) ?? '';
      expect(JSON.parse(await readFile(join(dir, file), 'utf8'))).toMatchObject({ recovery });
      expect(await new WriteReceipts(dir).unresolved()).toHaveLength(1);
      await receipt.record('cycle-result', { status: 'result-unknown', reason: 'NO_BLIND_SUB' });
      expect(await new WriteReceipts(dir).unresolved()).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe('inventory plus1/readback/sub1 safety', () => {
  const cell: InventoryCell = { skuId: 8765, code: 'ACTUAL_WAREHOUSE', quantity: 0 };
  const baseline: InventoryCell[] = [cell];
  const passed: Assessment = { status: 'passed', reason: 'ACK' };
  it('refuses null, implicit-zero, unsafe IDs and duplicate inventory baselines', () => {
    expect(inventoryCells({ result: { success: true, data_list: [] } })).toEqual([]);
    expect(
      inventoryCells({ result: { success: true, data_list: [{ sku_id: 123, inventory_code: 'W' }] } })
    ).toBeNull();
    const row = { sku_id: 123, inventory_code: 'W', inventory: 0 };
    expect(inventoryCells({ result: { success: true, data_list: [row, row] } })).toBeNull();
    expect(inventoryCells({ result: { success: true, data_list: [row] } })).toEqual([
      { skuId: 123, code: 'W', quantity: 0 }
    ]);
  });
  it('requires two baseline reads and records intent before each mutation', async () => {
    const events: string[] = [];
    const values = [baseline, [{ ...cell, quantity: 1 }], baseline];
    const result = await inventoryRoundTrip({
      baseline,
      read: () => {
        events.push('read');
        return Promise.resolve(values.shift() ?? null);
      },
      write: (op) => {
        events.push(op);
        return Promise.resolve(passed);
      },
      record: (phase) => {
        events.push(phase);
        return Promise.resolve();
      }
    });
    expect(result.status).toBe('passed');
    expect(events).toEqual([
      'read',
      'baseline-verified',
      'plus-intent',
      'plus',
      'plus-result',
      'read',
      'plus-readback',
      'sub-intent',
      'sub',
      'sub-result',
      'read',
      'sub-readback'
    ]);
  });
  it('does not write when the baseline changed', async () => {
    const write = vi.fn(() => Promise.resolve(passed));
    const result = await inventoryRoundTrip({
      baseline,
      read: () => Promise.resolve([]),
      write,
      record: () => Promise.resolve()
    });
    expect(result.status).toBe('skipped-prerequisite');
    expect(write).not.toHaveBeenCalled();
  });
  it('does not subtract after an unknown increment or mismatched readback', async () => {
    for (const unknown of [true, false]) {
      const reads = [baseline, [{ ...cell, quantity: 3 }]];
      const write = vi.fn((): Promise<Assessment> =>
        Promise.resolve(unknown ? { status: 'result-unknown', reason: 'TIMEOUT' } : passed)
      );
      const result = await inventoryRoundTrip({
        baseline,
        read: () => Promise.resolve(reads.shift() ?? null),
        write,
        record: () => Promise.resolve()
      });
      expect(result.status).toBe('result-unknown');
      expect(write).toHaveBeenCalledTimes(1);
    }
  });
  it('flags unresolved restoration even if subtraction receives a definite denial', async () => {
    const reads = [baseline, [{ ...cell, quantity: 1 }]];
    const result = await inventoryRoundTrip({
      baseline,
      read: () => Promise.resolve(reads.shift() ?? null),
      write: (op) =>
        Promise.resolve(op === 'plus' ? passed : { status: 'permission-denied', reason: 'DENIED' }),
      record: () => Promise.resolve()
    });
    expect(result.status).toBe('result-unknown');
  });
});
