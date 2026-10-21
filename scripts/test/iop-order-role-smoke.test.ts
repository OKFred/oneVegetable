import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../mock/data/iop-order-roles/transport.json';
import {
  installReadOnlyGuard,
  parseOptions,
  READ_PATHS,
  runReadPlan,
  type WorkerGuard
} from '../smoke-iop-workbench-real';

afterEach(() => {
  delete (globalThis as typeof globalThis & { __iopReadSmokeGuard?: WorkerGuard }).__iopReadSmokeGuard;
  vi.unstubAllGlobals();
});

describe('IOP role-specific real acceptance boundaries', () => {
  it('requires an explicit valid role with orders-only and rejects duplicate selectors', () => {
    const args = ['--confirm-readonly', '--credential=artifacts/input.json'];
    expect(parseOptions([...args, '--orders-only', '--order-role=buyer'])).toMatchObject({
      orderRole: 'buyer',
      ordersOnly: true
    });
    for (const extra of [
      ['--order-role=buyer'],
      ['--orders-only', '--order-role=other'],
      ['--orders-only', '--order-role=buyer', '--order-role=seller']
    ])
      expect(() => parseOptions([...args, ...extra])).toThrow();
  });
  it('binds dependent reads to the requested role and preceding live order', async () => {
    const source = fixture.list.value.order_list[0];
    if (!source) throw new Error('Missing fixture order');
    const row = {
      ...source,
      id: source.trade_id,
      role: 'buyer'
    };
    const call = vi
      .fn()
      .mockImplementation((operation: string) =>
        Promise.resolve(operation === 'listTradeOrders' ? { items: [row] } : {})
      );
    await runReadPlan(call, vi.fn(), undefined, undefined, true, false, 'buyer');
    expect(call.mock.calls).toEqual([
      ['listTradeOrders', { page: 1, pageSize: 1, role: 'buyer' }],
      ['getTradeOrderAggregate', { order: row, language: 'zh_CN' }]
    ]);
    call.mockReset().mockResolvedValue({ items: [{ ...row, role: 'seller' }] });
    await expect(runReadPlan(call, vi.fn(), undefined, undefined, true, false, 'buyer')).rejects.toThrow(
      'ORDER_ROLE_NOT_CONFIRMED'
    );
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('rejects a wire role mismatch without reaching the platform', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture.empty));
    vi.stubGlobal('fetch', send);
    installReadOnlyGuard({
      origin: 'https://openapi-api.alibaba.com',
      paths: READ_PATHS,
      intervalMs: 0,
      orderRole: 'buyer'
    });
    const guard = (globalThis as typeof globalThis & { __iopReadSmokeGuard: WorkerGuard })
      .__iopReadSmokeGuard;
    guard.arm('listTradeOrders', 'fixture-request');
    await expect(
      fetch('https://openapi-api.alibaba.com' + READ_PATHS.listTradeOrders, {
        method: 'POST',
        headers: { 'X-Request-ID': 'fixture-request' },
        body: new URLSearchParams({
          role: 'seller',
          access_token: 'fixture-token',
          sign_method: 'sha256',
          sign: 'fixture-sign'
        })
      })
    ).rejects.toThrow('READ_ONLY_NETWORK_DENIED');
    expect(send).not.toHaveBeenCalled();
  });
});
