// @vitest-environment jsdom
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { describe, expect, it, vi } from 'vitest';
import { StaticOperationAvailabilityClient } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import LogisticsView from '../src/views/LogisticsView.vue';
import { provideServices } from '../src/lib/services';
import { provideUnsavedEditing, UnsavedEditingService } from '../src/lib/unsaved-editing';

describe('local packing in the logistics workspace', () => {
  it('works without platform eligibility, suspends platform queries and keeps inputs only within the page', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const availability = new StaticOperationAvailabilityClient(new Set());
    const getAvailability = vi.spyOn(availability, 'get');
    const editing = new UnsavedEditingService();
    const Host = defineComponent({
      setup() {
        provideServices({
          gateway,
          operationAvailability: availability,
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
          mode: 'extension'
        });
        provideUnsavedEditing(editing);
        return () => h(LogisticsView);
      }
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
    const tab = (label: string) => {
      const result = wrapper.findAll('button[aria-pressed]').find((item) => item.text() === label);
      if (!result) throw new Error('Missing workspace ' + label);
      return result;
    };
    await flushPromises();
    await tab('装箱预览').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="packing-workspace"]').exists()).toBe(true);
    });
    expect(wrapper.text()).not.toContain('收发件信息');
    request.mockClear();
    getAvailability.mockClear();
    await queryClient.invalidateQueries();
    await flushPromises();
    expect(request).not.toHaveBeenCalled();
    expect(getAvailability).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="packing-container-length"]').setValue('123.4');
    expect(editing.dirty.value).toBe(false);
    await tab('运费试算').trigger('click');
    await tab('装箱预览').trigger('click');
    expect(wrapper.get('[data-testid="packing-container-length"]').element).toHaveProperty('value', '123.4');
    await tab('运费试算').trigger('click');
    const quoteInput = wrapper
      .findAll('input')
      .find((input) => !input.element.closest('[data-testid="packing-workspace"]'));
    if (!quoteInput) throw new Error('Missing quote input');
    await quoteInput.setValue('modified');
    const changeTab = tab('装箱预览').trigger('click');
    await flushPromises();
    expect(editing.confirmationOpen.value).toBe(true);
    editing.answer(false);
    await changeTab;
    await flushPromises();
    expect(tab('运费试算').attributes('aria-pressed')).toBe('true');
    const retry = tab('装箱预览').trigger('click');
    await flushPromises();
    editing.answer(true);
    await retry;
    await flushPromises();
    expect(tab('装箱预览').attributes('aria-pressed')).toBe('true');
    wrapper.unmount();
    queryClient.clear();
    editing.dispose();
  });
});
