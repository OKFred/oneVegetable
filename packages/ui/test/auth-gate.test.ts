// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { ALIBABA_GATEWAY } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import type { ControlClient, ControlSession } from '@one-vegetable/core';

import AuthGate from '../src/components/AuthGate.vue';
import { provideServices } from '../src/lib/services';

const session: ControlSession = {
  principal: { actorId: 'user-1', username: 'admin', role: 'admin', source: 'bff' },
  user: {
    id: 'user-1',
    username: 'admin',
    role: 'admin',
    status: 'active',
    lockedUntilUtc: null,
    createTimeUtc: 1,
    updateTimeUtc: 1,
    creatorId: 'system:bootstrap',
    updaterId: 'system:bootstrap',
    revision: 1,
    remark: null
  },
  absoluteExpiresTimeUtc: 10_000,
  idleExpiresTimeUtc: 5_000
};

describe('AuthGate', () => {
  it('logs in through the control client without exposing a registration action', async () => {
    const login = vi.fn(() => Promise.resolve(session));
    const control = controlFixture(login);
    const wrapper = mountAuthGate(control);
    await flushPromises();
    const inputs = wrapper.findAll('input');
    expect(inputs.map((input) => input.attributes('name'))).toEqual(['username', 'password']);
    expect(inputs.every((input) => input.attributes('required') !== undefined)).toBe(true);
    expect(inputs[0]?.attributes('data-feedback-redact')).toBe('');
    expect(inputs[1]?.attributes('type')).toBe('password');
    await inputs[0]?.setValue('admin');
    await inputs[1]?.setValue('correct-password-value');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(login).toHaveBeenCalledWith('admin', 'correct-password-value');
    expect(wrapper.findComponent(AuthGate).emitted('authenticated')?.[0]).toEqual([session]);
    expect(wrapper.text()).not.toContain('注册账号');
    expect(wrapper.text()).not.toContain('初始化管理员');
    expect(wrapper.text()).toContain('不是 Alibaba 国际站登录账号');
  });

  it('offers one-time administrator initialization only before the workspace is initialized', async () => {
    const bootstrap = vi.fn(() => Promise.resolve(session));
    const control = controlFixture(
      () => Promise.resolve(session),
      {
        initialized: false,
        bootstrapTokenConfigured: true,
        bootstrapAvailable: true
      },
      bootstrap
    );
    const wrapper = mountAuthGate(control);
    await flushPromises();
    const initializeButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('初始化管理员'));
    if (!initializeButton) throw new Error('missing administrator initialization action');
    await initializeButton.trigger('click');
    const inputs = wrapper.findAll('input');
    await inputs[0]?.setValue('bootstrap-secret-that-is-long');
    await inputs[1]?.setValue('admin');
    await inputs[2]?.setValue('correct-password-value');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(bootstrap).toHaveBeenCalledWith({
      bootstrapToken: 'bootstrap-secret-that-is-long',
      username: 'admin',
      password: 'correct-password-value',
      remark: '首个本地管理员'
    });
  });
});

function mountAuthGate(control: ControlClient) {
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
      return () => h(AuthGate);
    }
  });
  return mount(Host);
}

function controlFixture(
  login: (username: string, password: string) => Promise<ControlSession>,
  bootstrapStatus = {
    initialized: true,
    bootstrapTokenConfigured: true,
    bootstrapAvailable: false
  },
  bootstrap: ControlClient['bootstrap'] = () => Promise.resolve(session)
): ControlClient {
  return {
    backendMeta: () =>
      Promise.resolve({
        runtime: 'node',
        database: 'sqlite',
        environment: 'test',
        gatewayMode: 'mock',
        apiPrefix: '/api/v1',
        version: '2.0.1'
      }),
    session: () => Promise.resolve(session),
    bootstrapStatus: () => Promise.resolve(bootstrapStatus),
    bootstrap,
    login,
    logout: () => Promise.resolve(),
    listUsers: () => Promise.resolve({ items: [], total: 0 }),
    createUser: () => Promise.resolve(session.user),
    updateUser: () => Promise.resolve(session.user),
    resetPassword: () => Promise.resolve({ user: session.user, temporaryPassword: null }),
    revokeSessions: () => Promise.resolve(),
    listAudit: () => Promise.resolve({ items: [], total: 0 }),
    listRequestEvents: () => Promise.resolve({ items: [], total: 0 }),
    purgeRequestEvents: () => Promise.resolve({ deletedCount: 0, retentionDays: 30, cutoffTimeUtc: 0 }),
    gatewayCredentialStatus: () => Promise.resolve(gatewayCredentialSummary()),
    importGatewayCredential: () => Promise.resolve(gatewayCredentialSummary()),
    refreshGatewayCredential: () => Promise.resolve(gatewayCredentialSummary()),
    clearGatewayCredential: () => Promise.resolve(),
    system: () =>
      Promise.resolve({
        runtime: 'node',
        environment: 'test',
        apiPrefix: '/api/v1',
        database: 'sqlite',
        gatewayMode: 'mock',
        schemaVersion: 3,
        requestEventRetentionDays: 30,
        gatewayStatus: gatewayStatusFixture()
      }),
    policySummary: () => Promise.resolve({}),
    csrfToken: () => null
  };
}

function gatewayCredentialSummary() {
  return {
    configured: false,
    revision: null,
    accessTokenExpiresTimeUtc: null,
    refreshTokenExpiresTimeUtc: null,
    lastRefreshTimeUtc: null,
    lastRefreshErrorCode: null,
    updateTimeUtc: null,
    updaterId: null,
    remark: null
  };
}

function gatewayStatusFixture() {
  return {
    source: 'environment' as const,
    configured: false,
    hasAppKey: false,
    hasAppSecret: false,
    hasAccessToken: false,
    endpointOrigin: 'https://eco.taobao.com',
    signMethod: 'hmac' as const,
    realReadEnabled: false,
    mutationEnabled: false as const
  };
}
