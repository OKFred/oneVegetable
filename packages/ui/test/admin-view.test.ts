// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { ALIBABA_GATEWAY } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import type { ControlClient, ControlSession } from '@one-vegetable/core';

import { provideServices } from '../src/lib/services';
import AdminView from '../src/views/AdminView.vue';
import LogsView from '../src/views/LogsView.vue';

const requestId = '3d7c8523-93cc-48b7-a615-a23d2976c516';

describe('AdminView and LogsView', () => {
  it('does not load or render diagnostic and audit sections in administration', async () => {
    const control = controlFixture(
      vi.fn(() => Promise.resolve({ items: [], total: 0 })),
      vi.fn(() => Promise.resolve({ deletedCount: 0, retentionDays: 30, cutoffTimeUtc: 1 }))
    );
    const requests = vi.spyOn(control, 'listRequestEvents');
    const audit = vi.spyOn(control, 'listAudit');
    const wrapper = mountView(control);
    await flushPromises();
    expect(requests).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="request-events"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="audit-events"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('loads audit only when opened and preserves the requestId filter between tabs', async () => {
    const control = controlFixture(
      vi.fn(() => Promise.resolve({ items: [], total: 0 })),
      vi.fn(() => Promise.resolve({ deletedCount: 0, retentionDays: 30, cutoffTimeUtc: 1 }))
    );
    const requests = vi.spyOn(control, 'listRequestEvents');
    const audit = vi.spyOn(control, 'listAudit');
    const wrapper = mountView(control, true);
    // Logs mounts its lazy panel only after the asynchronous session has resolved.
    await flushPromises();
    await vi.dynamicImportSettled();
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="request-events"]').exists()).toBe(true);
    });
    expect(audit).not.toHaveBeenCalled();
    expect(requests).toHaveBeenCalledOnce();
    const input = wrapper.get('input[placeholder="requestId (UUID v4)"]');
    await input.setValue(requestId);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    globalThis.location.hash = '#/logs/audit';
    globalThis.dispatchEvent(new Event('hashchange'));
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="audit-events"]').exists()).toBe(true);
    });
    expect(audit).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, requestIdFilter: requestId });
    wrapper.unmount();
    globalThis.history.replaceState(null, '', '#/logs');
  });

  it('does not query server logs for ordinary users, including a direct audit URL', async () => {
    const control = controlFixture(
      vi.fn(() => Promise.resolve({ items: [], total: 0 })),
      vi.fn(() => Promise.resolve({ deletedCount: 0, retentionDays: 30, cutoffTimeUtc: 1 }))
    );
    control.session = () =>
      Promise.resolve({ ...sessionFixture(), principal: { ...sessionFixture().principal, role: 'user' } });
    const requests = vi.spyOn(control, 'listRequestEvents');
    const audit = vi.spyOn(control, 'listAudit');
    globalThis.location.hash = '#/logs/audit';
    const wrapper = mountView(control, true);
    await flushPromises();
    expect(requests).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('仅管理员可查看');
    expect(wrapper.find('a[href="#/logs/audit"]').exists()).toBe(false);
    wrapper.unmount();
    globalThis.history.replaceState(null, '', '#/logs');
  });

  it('correlates request diagnostics and confirms retention cleanup in a dialog', async () => {
    const listRequestEvents = vi.fn<ControlClient['listRequestEvents']>(() =>
      Promise.resolve({
        total: 41,
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
    const wrapper = mountView(controlFixture(listRequestEvents, purgeRequestEvents), true);
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="request-events"]').exists()).toBe(true);
    });
    await flushPromises();

    expect(wrapper.get('[data-testid="request-events"]').text()).toContain('admin/system/get');
    expect(wrapper.get('[data-testid="request-events"]').text()).toContain('200 / 12 ms');
    expect(wrapper.get('[data-testid="request-events"]').text()).toContain('第 1 / 3 页');
    expect(wrapper.text()).toContain('请求诊断保留 30 天');

    await wrapper.get('[data-testid="request-events"]').get('button[aria-label="下一页"]').trigger('click');
    await flushPromises();
    expect(listRequestEvents).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 });

    const filter = wrapper.get('input[placeholder="requestId (UUID v4)"]');
    await filter.setValue(requestId);
    filter.element.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(listRequestEvents).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      requestIdFilter: requestId
    });

    const purge = wrapper.get('[data-testid="purge-request-events"]');
    await purge.trigger('click');
    expect(purgeRequestEvents).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('确认清理请求诊断');
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent.trim() === '确认继续'
    );
    expect(confirm).toBeDefined();
    confirm?.click();
    await flushPromises();
    expect(purgeRequestEvents).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('已清理 4 条请求诊断');
    wrapper.unmount();
  });

  it('confirms password reset and shows the temporary password only in a one-time dialog', async () => {
    const control = controlFixture(
      () => Promise.resolve({ items: [], total: 0 }),
      () => Promise.resolve({ deletedCount: 0, retentionDays: 30, cutoffTimeUtc: 1 })
    );
    const resetPassword = vi.fn<ControlClient['resetPassword']>(() =>
      Promise.resolve({ user: sessionFixture().user, temporaryPassword: 'temporary-secret-123' })
    );
    control.resetPassword = resetPassword;
    const wrapper = mountView(control);
    await flushPromises();

    await wrapper.get('tbody button[aria-haspopup="dialog"]').trigger('click');
    await flushPromises();
    const reset = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent.includes('重置密码')
    );
    if (!reset) throw new Error('Missing reset password action');
    reset.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('确认重置密码');
    });
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent.trim() === '确认继续'
    );
    if (!confirm) throw new Error('Missing reset confirmation');
    confirm.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('temporary-secret-123');
    });
    expect(wrapper.text()).not.toContain('temporary-secret-123');
    const close = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent.trim() === '我已保存，关闭'
    );
    if (!close) throw new Error('Missing temporary password close action');
    close.click();
    await flushPromises();
    expect(document.body.textContent).not.toContain('temporary-secret-123');
    wrapper.unmount();
  });
});

function mountView(control: ControlClient, logs = false) {
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
      return () => h(logs ? LogsView : AdminView);
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
    backendMeta: () =>
      Promise.resolve({
        runtime: 'node',
        database: 'sqlite',
        environment: 'local-node',
        gatewayMode: 'mock',
        apiPrefix: '/api/v1',
        version: '2.0.1'
      }),
    session: () => Promise.resolve(sessionFixture()),
    bootstrapStatus: () =>
      Promise.resolve({ initialized: true, bootstrapTokenConfigured: true, bootstrapAvailable: false }),
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
    gatewayCredentialStatus: () => Promise.resolve(gatewayCredentialSummary()),
    importGatewayCredential: () => Promise.resolve(gatewayCredentialSummary()),
    refreshGatewayCredential: () => Promise.resolve(gatewayCredentialSummary()),
    clearGatewayCredential: () => Promise.resolve(),
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
