// @vitest-environment jsdom
import { effectScope, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseProductSchemaXml } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import fixture from '../../../mock/data/product-quality.json';
import { productQualityFieldReferences } from '../src/lib/product-quality';
import { useProductQuality } from '../src/composables/use-product-quality';
import { invalidatePageDetailCache, requestPageDetail } from '../src/lib/page-details';
import ProductQualityReview from '../src/components/ProductQualityReview.vue';
import { uiI18n } from '../src/i18n';

afterEach(() => {
  vi.restoreAllMocks();
  uiI18n.global.locale.value = 'zh-CN';
});
describe('quality field navigation', () => {
  const model = parseProductSchemaXml(fixture.schemaXml);
  const titleField = model.fields[0];
  if (!titleField) throw new Error('Missing fixture title');
  it('only matches a single real field, with exact token boundaries', () => {
    expect(productQualityFieldReferences(model, 'Improve productTitle')).toEqual([titleField.key]);
    expect(productQualityFieldReferences(model, 'Improve Product title')).toEqual([titleField.key]);
    expect(productQualityFieldReferences(model, 'wrongproductTitle')).toEqual([]);
    expect(productQualityFieldReferences(model, 'productTitle and material')).toEqual([]);
    expect(productQualityFieldReferences(model, 'Check image quality')).toEqual([]);
  });
  it.each(['zh-CN', 'en-US'] as const)(
    'distinguishes missing platform details from local checks in %s',
    (locale) => {
      uiI18n.global.locale.value = locale;
      const wrapper = mount(ProductQualityReview, {
        props: { model, score: fixture.empty, stale: false, pending: false, issues: [] }
      });
      expect(wrapper.text()).toContain('0');
      expect(wrapper.text()).toContain(
        locale === 'zh-CN' ? '平台未返回问题明细' : 'did not return issue details'
      );
      expect(wrapper.text()).toContain(
        locale === 'zh-CN' ? '不代表平台审核通过' : 'does not imply platform approval'
      );
      wrapper.unmount();
    }
  );
  it('renders only sanitized text and never inserts platform HTML', () => {
    const wrapper = mount(ProductQualityReview, {
      props: { model, score: fixture.unsafe, stale: true, pending: false, issues: [] }
    });
    expect(wrapper.find('img, script, b').exists()).toBe(false);
    expect(wrapper.text()).toContain('Improve productTitle');
    expect(wrapper.text()).not.toContain('alert(1)');
    wrapper.unmount();
  });
  it('emits a real field reference without changing the Schema', async () => {
    const source = model.sourceXml;
    const wrapper = mount(ProductQualityReview, {
      props: { model, score: fixture.score, stale: false, pending: false, issues: [] }
    });
    const locate = wrapper.findAll('button').find((button) => button.text() === '定位字段');
    if (!locate) throw new Error('Missing locate button');
    await locate.trigger('click');
    expect(wrapper.emitted('locate')?.[0]).toEqual([[titleField.key]]);
    expect(model.sourceXml).toBe(source);
    wrapper.unmount();
  });
});
describe('assessment reads', () => {
  async function prepare() {
    const scope = effectScope();
    const gateway = new MockGatewayClient(0);
    const rows = (await gateway.request('listProducts', { page: 1, pageSize: 20 })).items;
    const account = ref('account-a');
    const active = ref(true);
    const quality = scope.run(() => useProductQuality(gateway, 'mock', ref('en_US'), account, active));
    if (!quality) throw new Error('Missing quality scope');
    const request = vi.spyOn(gateway, 'request');
    quality.open(rows);
    await nextTick();
    return { scope, gateway, rows, account, active, quality, request };
  }
  it('freezes selection without requests, uses plaintext IDs, shares cached reads and supports explicit rechecks', async () => {
    const { scope, gateway, rows, quality, request } = await prepare();
    expect(request).not.toHaveBeenCalled();
    const first = rows[0];
    if (!first) throw new Error('Missing fixture product');
    const id = first.id;
    first.subject = 'mutated outside snapshot';
    expect(quality.products.value[0]?.subject).not.toBe(first.subject);
    await quality.run();
    const scores = () => request.mock.calls.filter(([op]) => op === 'getProductScore');
    expect(scores()).toHaveLength(rows.length);
    expect(scores()[0]?.[1]).toEqual({ productId: id });
    const calls = scores().length;
    await requestPageDetail(gateway, 'mock', 'en_US', { kind: 'score', id });
    expect(scores()).toHaveLength(calls);
    quality.invalidate(id);
    expect(quality.results.value[id]?.stale).toBe(true);
    await quality.run(true);
    expect(scores()).toHaveLength(calls * 2);
    expect(quality.results.value[id]?.stale).toBe(false);
    scope.stop();
  });
  it('stops subsequent scheduling after leaving and requires manual restart', async () => {
    const { scope, quality, active, request } = await prepare();
    request.mockImplementationOnce(() => {
      active.value = false;
      return Promise.resolve(fixture.score);
    });
    await quality.run();
    expect(request.mock.calls.filter(([op]) => op === 'getProductScore')).toHaveLength(1);
    active.value = true;
    await flushPromises();
    expect(request.mock.calls.filter(([op]) => op === 'getProductScore')).toHaveLength(1);
    scope.stop();
  });
  it('clears account data and discards in-flight results after identity changes', async () => {
    const { scope, quality, account, request } = await prepare();
    request.mockImplementationOnce(async () => {
      account.value = 'account-b';
      await nextTick();
      return fixture.score;
    });
    await quality.run();
    expect(quality.products.value).toEqual([]);
    expect(quality.results.value).toEqual({});
    scope.stop();
  });
  it('invalidates pre-save cached results without replaying a write', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const input = { kind: 'score', id: '10000001' } as const;
    await requestPageDetail(gateway, 'mock', 'en_US', input);
    invalidatePageDetailCache(gateway);
    await requestPageDetail(gateway, 'mock', 'en_US', input);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.every(([op]) => op === 'getProductScore')).toBe(true);
  });
  it('does not let an in-flight pre-save response refill the post-save cache', async () => {
    const gateway = new MockGatewayClient(0);
    const waiting = Promise.withResolvers<typeof fixture.score>();
    const request = vi
      .spyOn(gateway, 'request')
      .mockImplementationOnce(() => waiting.promise)
      .mockImplementationOnce(() => Promise.resolve(fixture.changed));
    const input = { kind: 'score', id: '10000001' } as const;
    const old = requestPageDetail(gateway, 'mock', 'en_US', input);
    await flushPromises();
    invalidatePageDetailCache(gateway);
    await requestPageDetail(gateway, 'mock', 'en_US', input);
    waiting.resolve(fixture.score);
    await old;
    expect(await requestPageDetail(gateway, 'mock', 'en_US', input)).toEqual(fixture.changed);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
