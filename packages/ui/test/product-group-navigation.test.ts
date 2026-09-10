// @vitest-environment jsdom
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { describe, expect, it, vi } from 'vitest';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { provideServices } from '../src/lib/services';
import ProductGroupNavigation from '../src/components/ProductGroupNavigation.vue';

describe('ProductGroupNavigation recovery', () => {
  it('offers a root-only retry and does not describe an error as an empty group list', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request').mockRejectedValueOnce(new Error('GATEWAY_ERROR'));
    const host = defineComponent({
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
                signMethod: 'hmac'
              }),
            save: () => Promise.resolve()
          }
        });
        return () => h(ProductGroupNavigation, { modelValue: null });
      }
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = mount(host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('GATEWAY_ERROR');
    });
    expect(wrapper.text()).not.toContain('当前账号暂无商品分组');
    const retry = wrapper.findAll('button').find((button) => button.text() === '重新加载分组');
    expect(retry).toBeDefined();
    await retry?.trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Energy storage');
    });
    expect(wrapper.text()).not.toContain('GATEWAY_ERROR');
    expect(request.mock.calls.map(([operation]) => operation)).toEqual([
      'listProductGroups',
      'listProductGroups'
    ]);
    wrapper.unmount();
    queryClient.clear();
  });
});
