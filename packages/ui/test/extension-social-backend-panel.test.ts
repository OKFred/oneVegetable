// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import {
  ALIBABA_GATEWAY,
  type ExtensionSocialBackendRepository,
  type ExtensionSocialBackendStatus,
  type ExtensionSocialDevice,
  type SocialPublishingClient
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import devicesFixture from '../../../mock/data/social-meta/devices.json';
import ExtensionSocialBackendPanel from '../src/components/ExtensionSocialBackendPanel.vue';
import { provideServices } from '../src/lib/services';

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }
}));

const extensionId = 'aepfdoldflokikbbcpnfifkacpfakmjc';

describe('ExtensionSocialBackendPanel', () => {
  it('does not show actionable controls before the stored status has loaded', async () => {
    let resolveStatus: ((status: ExtensionSocialBackendStatus) => void) | undefined;
    const backend = {
      status: () =>
        new Promise<ExtensionSocialBackendStatus>((resolve) => {
          resolveStatus = resolve;
        }),
      start: vi.fn(),
      refresh: vi.fn(),
      disconnect: vi.fn()
    } satisfies ExtensionSocialBackendRepository;
    const wrapper = mountPanel(backend);

    expect(wrapper.text()).toContain('正在读取');
    expect(wrapper.text()).not.toContain('开始配对');
    expect(wrapper.text()).not.toContain('断开');

    resolveStatus?.(unconfiguredStatus());
    await flushPromises();
    expect(wrapper.text()).toContain('开始配对');
    expect(wrapper.text()).not.toContain('断开');
    wrapper.unmount();
  });

  it('guides pairing and does not expose the device token', async () => {
    const start = vi.fn(() => Promise.resolve(pendingStatus()));
    const refresh = vi.fn(() => Promise.resolve(pairedStatus()));
    const disconnect = vi.fn(() => Promise.resolve(unconfiguredStatus()));
    const backend = {
      status: () => Promise.resolve(unconfiguredStatus()),
      start,
      refresh,
      disconnect
    } satisfies ExtensionSocialBackendRepository;
    const wrapper = mountPanel(backend);
    await flushPromises();

    const inputs = wrapper.findAll('input');
    await inputs[0]?.setValue('https://social.example.com');
    await inputs[1]?.setValue('Windows Chrome');
    await clickButton(wrapper, '开始配对');
    expect(start).toHaveBeenCalledWith('https://social.example.com', 'Windows Chrome');
    expect(wrapper.text()).toContain('ABCD-EFGH-JKLM-NPQR');

    await clickButton(wrapper, '检查批准结果');
    expect(refresh).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('已配对');
    expect(wrapper.text()).not.toContain('ovd_');

    await clickButton(wrapper, '断开');
    expect(disconnect).not.toHaveBeenCalled();
    await clickBodyButton('确认断开');
    expect(disconnect).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it('checks the paired BFF with a read-only destination request', async () => {
    const listSocialDestinations = vi.fn(() =>
      Promise.resolve([
        {
          id: '22222222-2222-4222-8222-222222222222',
          connectionId: '11111111-1111-4111-8111-111111111111',
          platform: 'facebook' as const,
          externalId: 'page-1',
          pageExternalId: 'page-1',
          pageName: 'oneVegetable Test',
          name: 'oneVegetable Test',
          canPublish: true,
          unavailableReasonCode: null,
          tasks: ['CREATE_CONTENT'],
          createTimeUtc: 1_790_000_000_000,
          updateTimeUtc: 1_790_000_000_000
        }
      ])
    );
    const publishing = {
      listSocialDestinations,
      prepareSocialPost: vi.fn(),
      publishSocialPost: vi.fn(),
      advanceSocialPost: vi.fn(),
      getSocialPost: vi.fn(),
      listSocialPosts: vi.fn(),
      cancelSocialPost: vi.fn()
    } satisfies SocialPublishingClient;
    const backend = {
      status: () => Promise.resolve(pairedStatus()),
      start: vi.fn(),
      refresh: vi.fn(),
      disconnect: vi.fn()
    } satisfies ExtensionSocialBackendRepository;
    const wrapper = mountPanel(backend, publishing);
    await flushPromises();

    await clickButton(wrapper, '检查连接');
    expect(listSocialDestinations).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
});

function mountPanel(backend: ExtensionSocialBackendRepository, socialPublishing?: SocialPublishingClient) {
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
        extensionSocialBackend: backend,
        ...(socialPublishing ? { socialPublishing } : {}),
        mode: 'extension'
      });
      return () => h(ExtensionSocialBackendPanel);
    }
  });
  return mount(Host, { attachTo: document.body });
}

async function clickButton(wrapper: ReturnType<typeof mountPanel>, label: string): Promise<void> {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().trim() === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await button.trigger('click');
  await flushPromises();
}

async function clickBodyButton(label: string): Promise<void> {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent.trim() === label
  );
  if (!button) throw new Error(`Missing body button: ${label}`);
  button.click();
  await flushPromises();
}

function unconfiguredStatus(): ExtensionSocialBackendStatus {
  return {
    state: 'unconfigured',
    baseUrl: null,
    extensionId,
    deviceName: null,
    pairingCode: null,
    pairingExpiresTimeUtc: null,
    device: null
  };
}

function pendingStatus(): ExtensionSocialBackendStatus {
  return {
    state: 'pending',
    baseUrl: 'https://social.example.com',
    extensionId,
    deviceName: 'Windows Chrome',
    pairingCode: 'ABCDEFGHJKLMNPQR',
    pairingExpiresTimeUtc: 1_790_784_000_000,
    device: null
  };
}

function pairedStatus(): ExtensionSocialBackendStatus {
  return {
    ...pendingStatus(),
    state: 'paired',
    pairingCode: null,
    pairingExpiresTimeUtc: null,
    device: (devicesFixture[0] as ExtensionSocialDevice | undefined) ?? null
  };
}
