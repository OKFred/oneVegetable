// @vitest-environment jsdom
import { defineComponent, h, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/product-type-available.json';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { provideServices } from '../src/lib/services';
import { uiI18n } from '../src/i18n';
import ProductPostingTypePicker from '../src/components/ProductPostingTypePicker.vue';

afterEach(() => {
  vi.restoreAllMocks();
  uiI18n.global.locale.value = 'zh-CN';
});
function setup(locked = false) {
  const gateway = new MockGatewayClient(0);
  const response = {
    method: fixture.method,
    traceId: null,
    data: structuredClone(fixture.response),
    contractValid: true,
    contractIssues: []
  };
  const request = vi.spyOn(gateway, 'request').mockResolvedValue(response);
  const market = ref<'wholesale' | 'sourcing'>('wholesale');
  const language = ref<'zh_CN' | 'en_US'>('zh_CN');
  const wrapper = mount(
    defineComponent({
      setup() {
        provideServices({
          gateway,
          mode: 'mock',
          settings: {
            load: () =>
              Promise.resolve({
                appKey: '',
                appSecret: '',
                accessToken: '',
                endpoint: 'https://eco.taobao.com/router/rest',
                signMethod: 'hmac' as const
              }),
            save: () => Promise.resolve()
          }
        });
        return () =>
          h(ProductPostingTypePicker, {
            modelValue: market.value,
            'onUpdate:modelValue': (value: 'wholesale' | 'sourcing') => {
              market.value = value;
            },
            locked,
            categoryId: 201712702,
            language: language.value
          });
      }
    })
  );
  return { wrapper, gateway, request, response, market, language };
}
describe('posting type guidance', () => {
  it('uses API language only and keeps both available choices', async () => {
    const { wrapper, request, language, market } = setup();
    await flushPromises();
    expect(request).toHaveBeenCalledWith(
      'callCapability',
      expect.objectContaining({ parameters: { type_request: { cat_id: 201712702, language: 'zh_cn' } } }),
      expect.anything()
    );
    expect(wrapper.findAll('input:disabled')).toHaveLength(0);
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Ready-to-order product');
    language.value = 'en_US';
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(2);
    expect(market.value).toBe('wholesale');
    wrapper.unmount();
  });
  it('selects the sole supported type only for a fresh form', async () => {
    const item = setup();
    item.response.data.data.support_post_whole_sale = false;
    await flushPromises();
    expect(item.market.value).toBe('sourcing');
    expect(item.wrapper.get('input[value="wholesale"]').attributes('disabled')).toBeDefined();
    item.wrapper.unmount();
    const loaded = setup(true);
    loaded.response.data.data.support_post_whole_sale = false;
    await flushPromises();
    expect(loaded.market.value).toBe('wholesale');
    expect(loaded.wrapper.getComponent(ProductPostingTypePicker).emitted('blocked')?.at(-1)).toEqual([false]);
    loaded.wrapper.unmount();
  });
  it('keeps drift unknown, offers retry and does not mistake missing values for unsupported', async () => {
    const item = setup();
    item.response.contractValid = false;
    await flushPromises();
    expect(item.wrapper.text()).toContain('尚未取得');
    expect(item.wrapper.findAll('input:disabled')).toHaveLength(0);
    expect(item.wrapper.getComponent(ProductPostingTypePicker).emitted('blocked')?.at(-1)).toEqual([false]);
    item.response.contractValid = true;
    const retry = item.wrapper.findAll('button').find((button) => button.text() === '重新查询');
    if (!retry) throw new Error('Missing retry');
    await retry.trigger('click');
    await flushPromises();
    expect(item.request).toHaveBeenCalledTimes(2);
    expect(item.wrapper.text()).not.toContain('尚未取得');
    item.wrapper.unmount();
  });
  it('blocks neither-supported and ignores results from a different identity', async () => {
    const item = setup();
    item.response.data.data.support_post_whole_sale = false;
    item.response.data.data.support_post_sourcing = false;
    await flushPromises();
    expect(item.wrapper.getComponent(ProductPostingTypePicker).emitted('blocked')?.at(-1)).toEqual([true]);
    item.wrapper.unmount();
    const changed = setup();
    const context = await changed.gateway.galleryTransferContext();
    vi.spyOn(changed.gateway, 'galleryTransferContext').mockResolvedValue({
      ...context,
      identity: `${context.identity}-changed`
    });
    await flushPromises();
    expect(changed.wrapper.text()).toContain('尚未取得');
    changed.wrapper.unmount();
  });
});
