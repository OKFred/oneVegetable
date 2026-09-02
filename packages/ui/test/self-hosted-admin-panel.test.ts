// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { ALIBABA_GATEWAY } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import type { ControlClient } from '@one-vegetable/core';

import SelfHostedAdminPanel from '../src/components/SelfHostedAdminPanel.vue';
import { provideServices } from '../src/lib/services';

describe('SelfHostedAdminPanel', () => {
  it('shows encrypted credential state and confirms the emergency pause before mutation', async () => {
    const updateRealMutationPause = vi.fn(() =>
      Promise.resolve({ paused: true, revision: 2, updateTimeUtc: 2, updaterId: 'admin-1', remark: null })
    );
    const control = {
      gatewayCredentialStatus: () =>
        Promise.resolve({
          configured: true,
          revision: 1,
          accessTokenExpiresTimeUtc: 2_000,
          refreshTokenExpiresTimeUtc: null,
          lastRefreshTimeUtc: null,
          lastRefreshErrorCode: null,
          updateTimeUtc: 1,
          updaterId: 'admin-1',
          remark: null
        }),
      realMutationStatus: () =>
        Promise.resolve({ paused: false, revision: 1, updateTimeUtc: 1, updaterId: 'admin-1', remark: null }),
      updateRealMutationPause,
      listPasskeys: () =>
        Promise.resolve([
          {
            id: 'credential-1',
            name: 'Windows Hello',
            deviceType: 'multiDevice' as const,
            backedUp: true,
            rpId: 'example.com',
            createTimeUtc: 1
          }
        ])
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
        return () => h(SelfHostedAdminPanel);
      }
    });
    const wrapper = mount(Host, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.text()).toContain('Alibaba 开放平台凭证');
    expect(wrapper.text()).toContain('一键连接');
    expect(wrapper.text()).toContain('已配置');
    expect(wrapper.text()).toContain('Windows Hello');
    const pause = wrapper.findAll('button').find((button) => button.text().includes('暂停全部真实写入'));
    if (!pause) throw new Error('Missing emergency pause button');
    await pause.trigger('click');
    expect(updateRealMutationPause).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('急停优先于所有 operation flag');
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent.trim() === '确认'
    );
    if (!confirm) throw new Error('Missing pause confirmation');
    confirm.click();
    await flushPromises();
    expect(updateRealMutationPause).toHaveBeenCalledWith(true, 1, '管理员紧急暂停');
    wrapper.unmount();
  });
});
