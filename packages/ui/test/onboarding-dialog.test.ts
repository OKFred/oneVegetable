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

    expect(wrapper.text()).toContain('四步连接 Alibaba 开放平台');
    expect(wrapper.findAll('img')).toHaveLength(4);
    expect(wrapper.text()).toContain('注册开发者');
    expect(wrapper.text()).toContain('等待审核');
    expect(wrapper.text()).toContain('创建应用');
    expect(wrapper.text()).toContain('授权并保存');
    expect(wrapper.text()).toContain('不存在官方隶属、合作、认可或背书关系');
    expect(wrapper.get('a[href="https://rulechannel.alibaba.com/icbu"]').attributes('rel')).toBe(
      'noopener noreferrer'
    );
    const startButton = wrapper.findAll('button').find((button) => button.text().includes('开始授权向导'));
    if (!startButton) throw new Error('Missing credential setup action');
    expect(startButton.attributes('disabled')).toBeDefined();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(startButton.attributes('disabled')).toBeUndefined();
    await startButton.trigger('click');
    await flushPromises();

    expect(complete).toHaveBeenCalledOnce();
    expect(wrapper.findComponent(OnboardingDialog).emitted('ready')).toEqual([['credential-acquisition']]);
    expect(wrapper.text()).not.toContain('四步连接 Alibaba 开放平台');
    wrapper.unmount();
  });

  it('guides a self-hosted administrator to cloud or extension authorization without exposing secrets', async () => {
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
            complete: () => Promise.resolve({ version: 1, completedAt: '2026-09-04T00:00:00.000Z' })
          },
          mode: 'bff'
        });
        return () => h(OnboardingDialog);
      }
    });
    const wrapper = mount(Host, { attachTo: globalThis.document.body });
    await flushPromises();

    expect(wrapper.text()).toContain('管理员可以先尝试云端自动连接');
    expect(wrapper.text()).toContain('若平台要求人机验证，流程会停止并引导你改用本机插件');
    expect(wrapper.text()).not.toContain('App Secret:');
    expect(wrapper.text()).not.toContain('Access Token:');
    wrapper.unmount();
  });
});
