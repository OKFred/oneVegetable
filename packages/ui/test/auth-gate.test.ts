// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { ALIBABA_GATEWAY, MockGatewayClient } from '@one-vegetable/core';
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
    const wrapper = mount(Host);
    const inputs = wrapper.findAll('input');
    await inputs[0]?.setValue('admin');
    await inputs[1]?.setValue('correct-password-value');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(login).toHaveBeenCalledWith('admin', 'correct-password-value');
    expect(wrapper.findComponent(AuthGate).emitted('authenticated')?.[0]).toEqual([session]);
    expect(wrapper.text()).not.toContain('注册账号');
  });
});

function controlFixture(
  login: (username: string, password: string) => Promise<ControlSession>
): ControlClient {
  return {
    session: () => Promise.resolve(session),
    bootstrap: () => Promise.resolve(session),
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
    system: () =>
      Promise.resolve({
        runtime: 'node',
        environment: 'test',
        apiPrefix: '/api/v1',
        database: 'sqlite',
        gatewayMode: 'mock',
        schemaVersion: 3,
        requestEventRetentionDays: 30
      }),
    policySummary: () => Promise.resolve({}),
    csrfToken: () => null
  };
}
