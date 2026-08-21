// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ALIBABA_GATEWAY } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import OnboardingDialog from '../src/components/OnboardingDialog.vue';
import { provideServices } from '../src/lib/services';

afterEach(() => {
  globalThis.document.body.innerHTML = '';
});

describe('OnboardingDialog', () => {
  it('requires affirmative acknowledgement before storing completion', async () => {
    const complete = vi.fn(() =>
      Promise.resolve({ version: 1 as const, completedAt: '2026-08-13T08:00:00.000Z' })
    );
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
          onboarding: {
            load: () => Promise.resolve({ version: 1, completedAt: null }),
            complete
          },
          mode: 'extension'
        });
        return () => h(OnboardingDialog);
      }
    });
    const wrapper = mount(Host, { attachTo: globalThis.document.body });
    await flushPromises();

    expect(wrapper.text()).toContain('先确认数据与调用边界');
    const button = wrapper.get('button');
    expect(button.attributes('disabled')).toBeDefined();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(button.attributes('disabled')).toBeUndefined();
    await button.trigger('click');
    await flushPromises();

    expect(complete).toHaveBeenCalledOnce();
    expect(wrapper.text()).not.toContain('先确认数据与调用边界');
    wrapper.unmount();
  });
});
