// @vitest-environment jsdom
import { defineComponent, h } from 'vue';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { describe, expect, it, vi } from 'vitest';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import ProductsView from '../src/views/ProductsView.vue';
import { provideServices } from '../src/lib/services';
import { translateUi, uiI18n } from '../src/i18n';

describe('product reference row-action placement', () => {
  it('keeps the real ProductsView action inside the compact automatic table menu until opened', async () => {
    const previousHash = globalThis.location.hash;
    const previousLocale = uiI18n.global.locale.value;
    globalThis.history.replaceState(null, '', '#/products');
    uiI18n.global.locale.value = 'en-US';
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      }
    );
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Host = defineComponent({
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
          },
          operationAvailability: {
            get: (operations) =>
              Promise.resolve({
                items: operations.map((operation) => ({
                  operation,
                  allowed: true,
                  reasonCode: 'TEST_ALLOWED'
                }))
              })
          }
        });
        return () => h(ProductsView);
      }
    });
    const wrapper = mount(Host, {
      attachTo: globalThis.document.body,
      global: {
        plugins: [[VueQueryPlugin, { queryClient }]],
        stubs: {
          ProductVisibleRegion: { template: '<div><slot /></div>' },
          ProductReferenceDrawer: {
            props: ['productId'],
            template: '<section data-product-reference-drawer :data-product-id="productId" />'
          }
        }
      }
    });
    try {
      await vi.waitFor(() => {
        expect(wrapper.find('tbody tr td:last-child button').exists()).toBe(true);
      });
      expect(
        wrapper.findAll('tbody button').some((item) => item.text() === translateUi('productReference.view'))
      ).toBe(false);
      expect(wrapper.find('[data-product-reference-drawer]').exists()).toBe(false);
      expect(request.mock.calls.some(([operation]) => operation === 'callCapability')).toBe(false);
      const trigger = wrapper.get('tbody tr td:last-child button');
      expect(trigger.classes()).toContain('size-8');
      await trigger.trigger('click');
      await flushPromises();
      const body = new DOMWrapper(globalThis.document.body);
      const reference = body
        .findAll('[data-row-actions] button')
        .find((item) => item.text() === translateUi('productReference.view'));
      expect(body.findAll('[data-row-actions] button').map((item) => item.text())).toContain(
        translateUi('productReference.view')
      );
      expect(reference?.classes()).toContain('bg-transparent');
      expect(reference?.classes()).toContain('w-full');
      expect(request.mock.calls.some(([operation]) => operation === 'callCapability')).toBe(false);
      await reference?.trigger('click');
      await flushPromises();
      await vi.waitFor(() => {
        expect(wrapper.find('[data-product-reference-drawer]').exists()).toBe(true);
      });
      expect(wrapper.get('[data-product-reference-drawer]').attributes('data-product-id')).toMatch(
        /^[1-9][0-9]*$/
      );
      expect(body.find('[data-row-actions]').exists()).toBe(false);
    } finally {
      wrapper.unmount();
      queryClient.clear();
      globalThis.document.body.innerHTML = '';
      globalThis.history.replaceState(null, '', previousHash);
      uiI18n.global.locale.value = previousLocale;
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
