// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import {
  ALIBABA_GATEWAY,
  type ControlClient,
  type MetaAppConfigurationUpdateRequest
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import configurationFixture from '../../../mock/data/social-meta/configuration.json';
import connectionsFixture from '../../../mock/data/social-meta/connections.json';
import destinationsFixture from '../../../mock/data/social-meta/destinations.json';
import devicesFixture from '../../../mock/data/social-meta/devices.json';
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
    expect(wrapper.text()).toContain('Cloudflare Worker · R2 私有素材库');
    expect(wrapper.text()).toContain('发布组件就绪');
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

  it('approves a pairing code and confirms before revoking an extension device', async () => {
    const approveExtensionSocialPairing = vi.fn(() =>
      Promise.resolve({
        pairingId: '88888888-8888-4888-8888-888888888888',
        status: 'approved' as const,
        expiresTimeUtc: 1_790_784_000_000,
        device: null,
        deviceToken: null
      })
    );
    const revokeExtensionSocialDevice = vi.fn(() => Promise.resolve());
    const control = {
      metaAppConfiguration: () => Promise.resolve(configurationFixture),
      updateMetaAppConfiguration: vi.fn(),
      listMetaConnections: () => Promise.resolve(connectionsFixture),
      listSocialDestinations: () => Promise.resolve(destinationsFixture),
      approveExtensionSocialPairing,
      listExtensionSocialDevices: () => Promise.resolve(devicesFixture),
      revokeExtensionSocialDevice
    } as unknown as ControlClient;
    const wrapper = mountPanel(control);
    await flushPromises();

    expect(wrapper.text()).toContain('Windows Chrome');
    const pairingInput = wrapper.find('input[placeholder="ABCD-EFGH-JKLM-NPQR"]');
    await pairingInput.setValue('ABCDEFGHJKLMNPQR');
    await findButton(wrapper, '批准配对').trigger('click');
    await clickBodyButton('确认');
    expect(approveExtensionSocialPairing).toHaveBeenCalledWith('ABCDEFGHJKLMNPQR');

    const revoke = wrapper.find('button[aria-label="撤销 Windows Chrome"]');
    await revoke.trigger('click');
    await clickBodyButton('确认');
    expect(revokeExtensionSocialDevice).toHaveBeenCalledWith('77777777-7777-4777-8777-777777777777', 1);
    wrapper.unmount();
  });

  it('preserves the existing App Secret when the password field is blank', async () => {
    const updateMetaAppConfiguration = vi.fn((input: Omit<MetaAppConfigurationUpdateRequest, 'requestId'>) =>
      Promise.resolve({
        ...configurationFixture,
        publicOrigin: input.publicOrigin,
        callbackUrl: `${input.publicOrigin}/api/v1/social/meta/oauth/callback`,
        revision: 3
      })
    );
    const control = {
      metaAppConfiguration: () => Promise.resolve(configurationFixture),
      updateMetaAppConfiguration,
      listMetaConnections: () => Promise.resolve([]),
      listSocialDestinations: () => Promise.resolve([])
    } as unknown as ControlClient;
    const wrapper = mountPanel(control);
    await flushPromises();

    await wrapper.find('input[placeholder="Meta App ID"]').setValue('123456789012345');
    await findButton(wrapper, '保存配置').trigger('click');
    await clickBodyButton('确认');

    expect(updateMetaAppConfiguration).toHaveBeenCalledWith({
      appId: '123456789012345',
      appSecret: null,
      publicOrigin: configurationFixture.publicOrigin,
      revision: configurationFixture.revision,
      remark: configurationFixture.remark
    });
    wrapper.unmount();
  });

  it('offers Facebook-only OAuth separately from the Instagram flow', async () => {
    const startMetaOAuth = vi.fn(() => Promise.reject(new Error('stop before navigation')));
    const control = {
      metaAppConfiguration: () => Promise.resolve(configurationFixture),
      updateMetaAppConfiguration: vi.fn(),
      startMetaOAuth,
      listMetaConnections: () => Promise.resolve([]),
      listSocialDestinations: () => Promise.resolve([])
    } as unknown as ControlClient;
    const wrapper = mountPanel(control);
    await flushPromises();

    await findButton(wrapper, '连接 Facebook Page').trigger('click');
    await flushPromises();
    await findButton(wrapper, 'Facebook + Instagram').trigger('click');
    await flushPromises();

    expect(startMetaOAuth).toHaveBeenNthCalledWith(1, ['facebook']);
    expect(startMetaOAuth).toHaveBeenNthCalledWith(2, ['facebook', 'instagram']);
    wrapper.unmount();
  });
});

function mountPanel(control: ControlClient) {
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
  return mount(Host, { attachTo: document.body });
}

function findButton(wrapper: ReturnType<typeof mountPanel>, label: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().trim() === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}

async function clickBodyButton(label: string): Promise<void> {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent.trim() === label
  );
  if (!button) throw new Error(`Missing body button: ${label}`);
  button.click();
  await flushPromises();
}
