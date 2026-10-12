import { describe, expect, it } from 'vitest';
import { parseBaseline, parseOptions, readonlyTransport } from '../check-product-batch-restoration-real';
import type { NetworkTransport } from '../../packages/core/src/network';

describe('read-only batch restoration reconciliation', () => {
  const baseline = {
    productId: '123456789',
    categoryId: 703,
    rootIds: ['productGroup', 'productKeywords'],
    fingerprint: 'a'.repeat(64)
  };
  it('requires exact positive identity and original target roots', () => {
    expect(parseBaseline(baseline)).toEqual(baseline);
    for (const invalid of [
      { ...baseline, productId: '9007199254740993' },
      { ...baseline, categoryId: 0 },
      { ...baseline, rootIds: ['productGroup', 'productGroup'] },
      { ...baseline, rootIds: ['subject', 'productKeywords'] },
      { ...baseline, fingerprint: '' }
    ])
      expect(() => parseBaseline(invalid)).toThrow('BASELINE_INVALID');
  });
  it('requires read-only consent and rejects any write/restore argument', () => {
    const args = ['--credential=ignored.json', '--baseline=baseline.json', '--confirm-readonly'];
    expect(parseOptions(args)).toEqual({ credential: 'ignored.json', baseline: 'baseline.json' });
    for (const invalid of [args.slice(0, 2), [...args, '--confirm-restore'], [...args, '--credential=other']])
      expect(() => parseOptions(invalid)).toThrow('READ_ONLY_ARGUMENTS_REQUIRED');
  });
  it.each(['top', 'iop'] as const)('allows only two unique targeted %s reads', async (protocol) => {
    let calls = 0;
    const delegate: NetworkTransport = {
      send() {
        calls += 1;
        return Promise.resolve(new Response('{}'));
      }
    };
    const guard = readonlyTransport(protocol, baseline.productId, delegate);
    const url =
      protocol === 'top'
        ? 'https://eco.taobao.com/router/rest'
        : 'https://openapi-api.alibaba.com/rest/alibaba/icbu/product/list';
    const body = new URLSearchParams({
      method: 'alibaba.icbu.product.list',
      id: baseline.productId,
      page_size: '1'
    });
    await guard.send(url, { method: 'POST', body });
    await expect(guard.send(url, { method: 'POST', body })).rejects.toThrow('READ_ONLY_GUARD');
    const renderBody = new URLSearchParams({ method: 'alibaba.icbu.product.schema.render' });
    renderBody.set(
      protocol === 'top' ? 'param_product_top_publish_request' : 'render_request',
      JSON.stringify({ product_id: Number(baseline.productId) })
    );
    await guard.send(
      protocol === 'top' ? url : 'https://openapi-api.alibaba.com/rest/icbu/product/schema/render',
      { method: 'POST', body: renderBody }
    );
    expect(calls).toBe(2);
    for (const invalid of [
      'https://example.com/rest/icbu/product/schema/update',
      'https://openapi-api.alibaba.com/rest/auth/token/refresh'
    ])
      await expect(guard.send(invalid, { method: 'POST', body })).rejects.toThrow('READ_ONLY_GUARD');
    expect(calls).toBe(2);
  });
  it('rejects untargeted/scanning reads before dispatch', async () => {
    const guard = readonlyTransport('top', baseline.productId, {
      send() {
        throw new Error('MUST_NOT_DISPATCH');
      }
    });
    for (const parameters of [
      { method: 'alibaba.icbu.product.list', id: '999', page_size: '1' },
      { method: 'alibaba.icbu.product.list', id: baseline.productId, page_size: '30' },
      { method: 'alibaba.icbu.product.schema.update', id: baseline.productId, page_size: '1' }
    ])
      await expect(
        guard.send('https://eco.taobao.com/router/rest', {
          method: 'POST',
          body: new URLSearchParams(parameters)
        })
      ).rejects.toThrow(/READ_ONLY_/u);
  });
});
