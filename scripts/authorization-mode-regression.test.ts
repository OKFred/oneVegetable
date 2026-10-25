import { describe, expect, it, vi } from 'vitest';
import fixture from '../mock/data/authorization-mode-regression.json';
import { GatewayException } from '../packages/core/src/errors';
import {
  AUTHORIZATION_MODES,
  classify,
  expectation,
  profiles,
  readRule
} from './lib/authorization-mode-regression';
import { ReadWireGuard } from './lib/authorization-mode-wire';

describe('authorization-mode regression safety', () => {
  it('keeps four independent mode/default combinations', () => {
    expect(AUTHORIZATION_MODES.map(profiles)).toEqual([['top'], ['iop'], ['top', 'iop'], ['iop', 'top']]);
  });
  it.each(['dual-top', 'dual-iop'] as const)('does not borrow the default/upload context in %s', (mode) => {
    for (const operation of [
      'getProductShowcase',
      'listPhotos',
      'getTradeOrderAggregate',
      'listVideoRelatedProducts'
    ] as const)
      expect(expectation(mode, operation, {}).protocol).toBe('top');
    expect(expectation(mode, 'getProductInventory', { source: 'sku' }).protocol).toBe('top');
    expect(expectation(mode, 'getProductInventory', { source: 'product' }).protocol).toBe('iop');
    expect(expectation(mode, 'listProducts', {}).protocol).toBe('iop');
  });
  it('separates unsupported scopes from unavailable permission and expired credentials', () => {
    const error = (name: keyof typeof fixture.errors) => new GatewayException(fixture.errors[name]);
    expect(classify(error('permission'), true).status).toBe('permission-unavailable');
    expect(classify(error('expired'), true).status).toBe('credential-blocked');
    expect(classify(error('unknown27'), true).status).toBe('failed');
    expect(classify(error('scope'), true).status).toBe('scope-protected');
    expect(classify(error('unsupported'), false).status).toBe('unsupported');
    expect(classify(error('unsupported'), true).status).toBe('failed');
  });
  it('denies writes and unknown generic calls before network access', () => {
    expect(() => readRule('publishProduct', {})).toThrow('READ_ONLY_OPERATION_DENIED');
    expect(() => readRule('callCapability', { method: 'alibaba.icbu.product.inventory.update' })).toThrow(
      'READ_ONLY_OPERATION_DENIED'
    );
  });
  it('blocks an unarmed request without invoking transport', async () => {
    const guard = new ReadWireGuard(),
      next = vi.fn(() => Promise.resolve(Response.json(fixture.accepted)));
    await expect(
      guard.send(new Request('https://eco.taobao.com/router/rest', { method: 'POST' }), next)
    ).rejects.toThrow();
    expect(next).not.toHaveBeenCalled();
  });
  it('does not retry a semantic request or switch protocol after provider failure', async () => {
    const guard = new ReadWireGuard(),
      next = vi.fn(() => Promise.resolve(new Response(null, { status: 503 })));
    guard.arm('read-id', readRule('listProducts', {}), 'top');
    const input = () =>
      new Request('https://eco.taobao.com/router/rest', {
        method: 'POST',
        headers: { 'X-Request-ID': 'read-id' },
        body: new URLSearchParams({ method: 'alibaba.icbu.product.list', current_page: '1' })
      });
    expect((await guard.send(input(), next)).status).toBe(503);
    await expect(guard.send(input(), next)).rejects.toThrow('READ_ONLY_NETWORK_DENIED');
    await expect(
      guard.send(
        new Request('https://openapi-api.alibaba.com/rest/alibaba/icbu/product/list', {
          method: 'POST',
          headers: { 'X-Request-ID': 'read-id' }
        }),
        next
      )
    ).rejects.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
    expect(guard.snapshot().events).toHaveLength(1);
    expect(guard.snapshot().blocked).toBe(2);
  });
  it('does not expose provider credentials in receipts', async () => {
    const guard = new ReadWireGuard();
    guard.arm('read-id', readRule('listProducts', {}), 'top');
    await guard.send(
      new Request('https://eco.taobao.com/router/rest', {
        method: 'POST',
        headers: { 'X-Request-ID': 'read-id' },
        body: new URLSearchParams({
          method: 'alibaba.icbu.product.list',
          app_key: 'fixture-key',
          session: 'fixture-token',
          sign: 'fixture-signature'
        })
      }),
      () => Promise.resolve(Response.json(fixture.accepted))
    );
    const receipt = JSON.stringify(guard.snapshot());
    for (const secret of ['fixture-key', 'fixture-token', 'fixture-signature'])
      expect(receipt).not.toContain(secret);
  });
});
