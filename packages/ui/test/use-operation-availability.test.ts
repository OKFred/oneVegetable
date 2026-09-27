// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */

import { defineComponent, h, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { onlineManager, QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ALIBABA_GATEWAY, StaticOperationAvailabilityClient } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import { useOperationAvailability } from '../src/composables/use-operation-availability';
import { provideServices } from '../src/lib/services';

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('useOperationAvailability', () => {
  it('supports reactive opt-out while preserving the pending and unavailable fallback contracts', async () => {
    const enabled = ref(false);
    const Consumer = defineComponent({
      setup() {
        const availability = useOperationAvailability(['publishProduct'], { enabled });
        return () =>
          h('div', [
            h('span', { 'data-testid': 'reason' }, availability.reasonCode('publishProduct') ?? ''),
            h('span', { 'data-testid': 'allowed' }, String(availability.isAllowed('publishProduct')))
          ]);
      }
    });
    const Host = defineComponent({
      setup() {
        provideServices({
          gateway: new MockGatewayClient(0),
          settings: { load: vi.fn(), save: vi.fn() },
          mode: 'extension'
        });
        return () => h(Consumer);
      }
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
    await flushPromises();
    expect(wrapper.get('[data-testid="reason"]').text()).toBe('OPERATION_AVAILABILITY_PENDING');
    expect(queryClient.getQueryState(['operation-availability', 'publishProduct'])?.fetchStatus).toBe('idle');
    enabled.value = true;
    await flushPromises();
    expect(wrapper.get('[data-testid="reason"]').text()).toBe('OPERATION_AVAILABILITY_UNAVAILABLE');
    expect(wrapper.get('[data-testid="allowed"]').text()).toBe('false');
    wrapper.unmount();
    queryClient.clear();
  });

  it('resolves extension-local policy even when the browser reports offline', async () => {
    onlineManager.setOnline(false);
    const get = vi.fn((operations: readonly ['publishProduct']) =>
      new StaticOperationAvailabilityClient(new Set()).get(operations)
    );
    const Consumer = defineComponent({
      setup() {
        const availability = useOperationAvailability(['publishProduct']);
        return () =>
          h('div', [
            h('span', { 'data-testid': 'status' }, availability.isPending.value ? 'pending' : 'settled'),
            h('span', { 'data-testid': 'reason' }, availability.reasonCode('publishProduct') ?? '')
          ]);
      }
    });
    const Host = defineComponent({
      setup() {
        provideServices({
          gateway: new MockGatewayClient(0),
          settings: {
            load: () =>
              Promise.resolve({
                appKey: '',
                appSecret: '',
                accessToken: '',
                endpoint: ALIBABA_GATEWAY,
                signMethod: 'hmac' as const
              }),
            save: () => Promise.resolve()
          },
          operationAvailability: { get },
          mode: 'extension'
        });
        return () => h(Consumer);
      }
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = mount(Host, {
      global: { plugins: [[VueQueryPlugin, { queryClient }]] }
    });

    await vi.waitFor(() => {
      expect(wrapper.get('[data-testid="status"]').text()).toBe('settled');
    });
    expect(wrapper.get('[data-testid="reason"]').text()).toBe('STATIC_DISABLED');
    expect(get).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
});
