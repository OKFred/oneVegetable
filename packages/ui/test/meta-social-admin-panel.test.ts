// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { ALIBABA_GATEWAY, type ControlClient } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import configurationFixture from '../../../mock/data/social-meta/configuration.json';
import connectionsFixture from '../../../mock/data/social-meta/connections.json';
import destinationsFixture from '../../../mock/data/social-meta/destinations.json';
import MetaSocialAdminPanel from '../src/components/MetaSocialAdminPanel.vue';
import { provideServices } from '../src/lib/services';

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }
}));

describe('MetaSocialAdminPanel', () => {
  it('shows connected destinations and confirms before disconnecting an account', async () => {
    const disconnectMetaConnection = vi.fn(() => Promise.resolve());
    const control = {
      metaAppConfiguration: () => Promise.resolve(configurationFixture),
      updateMetaAppConfiguration: vi.fn(),
      listMetaConnections: () => Promise.resolve(connectionsFixture),
      listSocialDestinations: () => Promise.resolve(destinationsFixture),
      disconnectMetaConnection
    } as unknown as ControlClient;
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
                signMethod: 'hmac'
              }),
            save: () => Promise.resolve()
          },
          control,
          mode: 'bff'
        });
        return () => h(MetaSocialAdminPanel);
      }
    });
    const wrapper = mount(Host, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.text()).toContain('已配置 ···6789');
    expect(wrapper.text()).toContain('oneVegetable Test');
    expect(wrapper.text()).toContain('INSTAGRAM_PERMISSION_MISSING');
    const disconnect = wrapper.find('button[aria-label="断开 oneVegetable Tester"]');
    await disconnect.trigger('click');
    expect(disconnectMetaConnection).not.toHaveBeenCalled();
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent.trim() === '确认'
    );
    if (!confirm) throw new Error('Missing disconnect confirmation');
    confirm.click();
    await flushPromises();
    expect(disconnectMetaConnection).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 1);
    wrapper.unmount();
  });
});
