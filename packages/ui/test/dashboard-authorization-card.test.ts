// @vitest-environment jsdom
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BffControlClient,
  type ControlGatewayCredentialSummary,
  type CredentialVaultState,
  type CredentialVaultStatus
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import DashboardAuthorizationCard from '../src/components/DashboardAuthorizationCard.vue';
import DashboardView from '../src/views/DashboardView.vue';
import { provideServices } from '../src/lib/services';
import { GATEWAY_CONFIGURATION_EVENT } from '../src/lib/gateway-configuration-events';
import { VAULT_UNLOCKED_EVENT } from '../src/lib/unsaved-editing';
import { uiI18n } from '../src/i18n';
import fixture from '../../../mock/data/dashboard-authorization.json';

const wrappers: VueWrapper[] = [];
const clients: QueryClient[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => {
    wrapper.unmount();
  });
  clients.splice(0).forEach((client) => {
    client.clear();
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
  uiI18n.global.locale.value = 'zh-CN';
});

async function harness(
  options: {
    mode?: 'bff' | 'extension' | 'mock';
    role?: 'admin' | 'user';
    expiry?: number | null;
    vaultState?: CredentialVaultState;
    summary?: Partial<ControlGatewayCredentialSummary>;
    failed?: boolean;
    dashboard?: boolean;
  } = {}
) {
  const role = options.role ?? 'admin';
  const control = new BffControlClient({ baseUrl: 'http://localhost:8787' });
  const session = vi.spyOn(control, 'session').mockResolvedValue({
    user: { ...fixture.user, role, status: 'active' },
    principal: { actorId: fixture.user.id, username: fixture.user.username, role, source: 'bff' },
    absoluteExpiresTimeUtc: Date.now() + 60000,
    idleExpiresTimeUtc: Date.now() + 60000
  });
  const summary = {
    ...fixture.summary,
    source: 'sqlite-vault' as const,
    accessTokenExpiresTimeUtc: options.expiry ?? null,
    ...options.summary
  };
  const status = vi.spyOn(control, 'gatewayCredentialStatus').mockResolvedValue(summary);
  if (options.failed) status.mockRejectedValue(new Error('OFFLINE'));
  const vaultStatus: CredentialVaultStatus = {
    ...fixture.vault,
    signMethod: 'hmac',
    state: options.vaultState ?? 'unlocked'
  };
  const readVault = vi.fn().mockResolvedValue(vaultStatus);
  const vaultOperation = vi.fn().mockResolvedValue(vaultStatus);
  const loadSettings = vi.fn().mockResolvedValue({
    appKey: fixture.vault.appKey,
    appSecret: '',
    accessToken: '',
    endpoint: fixture.vault.endpoint,
    signMethod: 'hmac',
    accessTokenExpiresTimeUtc: options.expiry ?? null
  });
  const gateway = new MockGatewayClient(0);
  const request = vi.spyOn(gateway, 'request').mockRejectedValue(new Error('AUTHORIZATION_EXPIRED'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const Host = defineComponent({
    setup() {
      provideServices({
        mode: options.mode ?? 'bff',
        control,
        gateway,
        settings: { load: loadSettings, save: vi.fn() },
        vault: {
          status: readVault,
          create: vaultOperation,
          migrate: vaultOperation,
          unlock: vaultOperation,
          lock: vaultOperation,
          rotate: vaultOperation,
          updatePolicy: vaultOperation
        }
      });
      return () => h(options.dashboard ? DashboardView : DashboardAuthorizationCard);
    }
  });
  const wrapper = mount(Host, {
    global: {
      plugins: [[VueQueryPlugin, { queryClient: client }]],
      stubs: { DashboardShopLink: true, LocalTodoList: true, ErrorNotice: true }
    }
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, status, session, readVault, loadSettings, request, summary, vaultStatus };
}

describe('dashboard authorization card', () => {
  it('counts down locally, supports both languages and links to Settings without calling Alibaba', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const view = await harness({ expiry: Date.now() + 120_000 });
    expect(view.wrapper.text()).toContain('剩余约 2 分钟');
    expect(view.wrapper.get('a').attributes('href')).toBe('#/settings');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(view.wrapper.text()).toContain('剩余约 1 分钟');
    uiI18n.global.locale.value = 'en-US';
    await nextTick();
    expect(view.wrapper.text()).toContain('About 1 minutes left');
    expect(view.status).toHaveBeenCalledTimes(1);
    expect(view.request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(view.wrapper.text()).toContain('Expired');
    view.wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not invent an expiry for the current unknown-lifetime authorization', async () => {
    const view = await harness();
    expect(view.wrapper.text()).toContain('授权有效期未知，不代表永久有效');
    expect(view.wrapper.text()).not.toContain('剩余约');
    expect(view.wrapper.text()).not.toContain('fixture-key');
  });

  it('keeps expired startup credentials visible even when configured is false', async () => {
    const view = await harness({ expiry: 1, summary: { configured: false } });
    expect(view.wrapper.text()).toContain('授权已到期');
  });

  it('distinguishes absent credentials, invalid authorization and unreadable status', async () => {
    const empty = await harness({ summary: { configured: false } });
    expect(empty.wrapper.text()).toContain('尚未配置');
    const invalid = await harness({
      expiry: Date.now() + 86_400_000,
      summary: { lastRefreshErrorCode: 'TOKEN_INVALID' }
    });
    expect(invalid.wrapper.text()).toContain('需重新连接');
    expect(invalid.wrapper.text()).not.toContain('剩余约');
    const error = await harness({ failed: true });
    expect(error.wrapper.text()).toContain('暂时无法读取授权状态');
    expect(error.wrapper.text()).not.toContain('有效期未知');
  });

  it('does not invoke the admin endpoint for ordinary users or use mock credentials', async () => {
    const user = await harness({ role: 'user' });
    expect(user.wrapper.text()).toContain('只有管理员');
    expect(user.status).not.toHaveBeenCalled();
    const demo = await harness({ mode: 'mock' });
    expect(demo.wrapper.text()).toContain('演示模式不使用真实 Alibaba 授权');
    expect(demo.session).not.toHaveBeenCalled();
  });

  it('reads extension expiry only after unlock, then updates on configuration changes', async () => {
    const view = await harness({
      mode: 'extension',
      vaultState: 'locked',
      expiry: Date.now() + 2 * 86_400_000
    });
    expect(view.wrapper.text()).toContain('请先到设置解锁');
    expect(view.loadSettings).not.toHaveBeenCalled();
    view.vaultStatus.state = 'unlocked';
    globalThis.dispatchEvent(new Event(VAULT_UNLOCKED_EVENT));
    await flushPromises();
    expect(view.wrapper.text()).toContain('剩余约');
    expect(view.loadSettings).toHaveBeenCalledTimes(1);
    view.vaultStatus.state = 'empty';
    globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
    await flushPromises();
    expect(view.wrapper.text()).toContain('尚未配置');
    expect(view.status).not.toHaveBeenCalled();
  });

  it('ignores a late status response after newer configuration has been read', async () => {
    const view = await harness();
    let resolveOld: ((value: ControlGatewayCredentialSummary) => void) | undefined;
    view.status.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    );
    globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
    await flushPromises();
    view.status.mockResolvedValueOnce({ ...view.summary, configured: false });
    globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
    await flushPromises();
    resolveOld?.({ ...view.summary, accessTokenExpiresTimeUtc: Date.now() + 86_400_000 });
    await flushPromises();
    expect(view.wrapper.text()).toContain('尚未配置');
    expect(view.wrapper.text()).not.toContain('剩余约');
  });

  it('replaces the Images metric and stays visible when the dashboard gateway request fails', async () => {
    const view = await harness({ dashboard: true, expiry: 1 });
    await vi.waitFor(() => {
      expect(view.wrapper.find('error-notice-stub').exists()).toBe(true);
    });
    expect(view.wrapper.get('[data-testid="dashboard-authorization"]').text()).toContain('授权已到期');
    expect(view.wrapper.findAllComponents({ name: 'DashboardMetricCard' })).toHaveLength(3);
    expect(view.wrapper.text()).not.toContain('图片');
    expect(view.wrapper.find('local-todo-list-stub').exists()).toBe(true);
  });
});
