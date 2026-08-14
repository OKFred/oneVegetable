// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { ALIBABA_GATEWAY, MockGatewayClient } from '@one-vegetable/core';
import type { ControlClient, ControlSession } from '@one-vegetable/core';

import { provideServices } from '../src/lib/services';
import AdminView from '../src/views/AdminView.vue';

const requestId = '3d7c8523-93cc-48b7-a615-a23d2976c516';

describe('AdminView', () => {
  it('correlates request diagnostics and requires a second click before retention cleanup', async () => {
    const listRequestEvents = vi.fn<ControlClient['listRequestEvents']>(() =>
      Promise.resolve({
        total: 1,
        items: [
          {
            id: 'request-event-1',
            eventTimeUtc: 1_723_630_000_000,
            requestId,
            environment: 'local-node',
            runtime: 'node',
            route: '/api/v1/admin/system/get',
            operation: 'admin/system/get',
            actorId: 'user-1',
            outcome: 'success',
            statusCode: 200,
            durationMilliseconds: 12
          }
        ]
      })
    );
    const purgeRequestEvents = vi.fn<ControlClient['purgeRequestEvents']>(() =>
      Promise.resolve({ deletedCount: 4, retentionDays: 30, cutoffTimeUtc: 1 })
    );
    const wrapper = mountView(controlFixture(listRequestEvents, purgeRequestEvents));
    await flushPromises();

    expect(wrapper.get('[data-testid="request-events"]').text()).toContain('admin/system/get');
    expect(wrapper.get('[data-testid="request-events"]').text()).toContain('200 / 12 ms');
    expect(wrapper.text()).toContain('请求诊断保留 30 天');

    const filter = wrapper.get('input[placeholder="requestId（UUID v4）"]');
    await filter.setValue(requestId);
    filter.element.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(listRequestEvents).toHaveBeenLastCalledWith({ requestIdFilter: requestId });

    const purge = wrapper.get('[data-testid="purge-request-events"]');
    await purge.trigger('click');
    expect(purgeRequestEvents).not.toHaveBeenCalled();
    expect(purge.text()).toContain('确认清理');
    await purge.trigger('click');
    await flushPromises();
    expect(purgeRequestEvents).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('已清理 4 条请求诊断');
    wrapper.unmount();
  });
});

function mountView(control: ControlClient) {
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
      return () => h(AdminView);
    }
  });
  return mount(Host, { attachTo: document.body });
}

function controlFixture(
  listRequestEvents: ControlClient['listRequestEvents'],
  purgeRequestEvents: ControlClient['purgeRequestEvents']
): ControlClient {
  const user = sessionFixture().user;
  return {
    session: () => Promise.resolve(sessionFixture()),
    bootstrap: () => Promise.resolve(sessionFixture()),
    login: () => Promise.resolve(sessionFixture()),
    logout: () => Promise.resolve(),
    listUsers: () => Promise.resolve({ items: [user], total: 1 }),
    createUser: () => Promise.resolve(user),
    updateUser: () => Promise.resolve(user),
    resetPassword: () => Promise.resolve({ user, temporaryPassword: null }),
    revokeSessions: () => Promise.resolve(),
    listAudit: () => Promise.resolve({ items: [], total: 0 }),
    listRequestEvents,
    purgeRequestEvents,
    system: () =>
      Promise.resolve({
        runtime: 'node',
        environment: 'local-node',
        apiPrefix: '/api/v1',
        database: 'sqlite',
        gatewayMode: 'mock',
        schemaVersion: 3,
        requestEventRetentionDays: 30,
        gatewayStatus: {
          source: 'environment',
          configured: false,
          hasAppKey: false,
          hasAppSecret: false,
          hasAccessToken: false,
          endpointOrigin: 'https://eco.taobao.com',
          signMethod: 'hmac',
          realReadEnabled: false,
          mutationEnabled: false
        }
      }),
    policySummary: () => Promise.resolve({ admin: ['system.read'] }),
    csrfToken: () => 'csrf-token'
  };
}

function sessionFixture(): ControlSession {
  return {
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
}
