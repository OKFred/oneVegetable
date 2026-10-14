// @vitest-environment jsdom
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BffControlClient,
  type ControlGatewayCredentialSummary,
  type ControlSession
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import fixture from '../../../mock/data/dashboard-authorization.json';
import DashboardAuthorizationCard from '../src/components/DashboardAuthorizationCard.vue';
import { provideServices } from '../src/lib/services';
import { uiI18n } from '../src/i18n';
import { GATEWAY_CONFIGURATION_EVENT } from '../src/lib/gateway-configuration-events';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  uiI18n.global.locale.value = 'zh-CN';
});

async function harness(
  options: {
    status?: Partial<ControlGatewayCredentialSummary>;
    role?: 'admin' | 'user';
    extension?: boolean;
    locked?: boolean;
  } = {}
) {
  const client = new BffControlClient({ baseUrl: 'http://localhost:8787' });
  // This harness models the legacy optional-API surface, not the new live endpoint.
  Object.defineProperty(client, 'gatewayAuthorizations', { value: undefined });
  const session = fixture.session as ControlSession;
  const readSession = vi
    .spyOn(client, 'session')
    .mockResolvedValue({ ...session, principal: { ...session.principal, role: options.role ?? 'admin' } });
  const read = vi.spyOn(client, 'gatewayCredentialStatus').mockResolvedValue({
    ...(fixture.credential as ControlGatewayCredentialSummary),
    systemApiPermission: 'unknown',
    ...options.status
  });
  const refresh = vi.spyOn(client, 'refreshGatewayCredential');
  const load = vi.fn().mockResolvedValue({
    accessTokenExpiresTimeUtc: null,
    systemApiPermission: 'active',
    ...options.status
  });
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway: new MockGatewayClient(0),
        control: client,
        mode: options.extension ? 'extension' : 'bff',
        settings: { load, save: vi.fn() },
        ...(options.extension
          ? {
              vault: {
                status: vi
                  .fn()
                  .mockResolvedValue({ state: options.locked ? 'locked' : 'unlocked', hasAccessToken: true }),
                create: vi.fn(),
                migrate: vi.fn(),
                unlock: vi.fn(),
                lock: vi.fn(),
                rotate: vi.fn(),
                updatePolicy: vi.fn()
              }
            }
          : {})
      });
      return () => h(DashboardAuthorizationCard);
    }
  });
  const wrapper = mount(Host);
  await flushPromises();
  return { wrapper, readSession, read, refresh, load };
}

describe('overview authorization card', () => {
  it.each([false, true])(
    'uses the current token lifetime in %s extension mode with dark-mode colors',
    async (extension) => {
      vi.useFakeTimers();
      vi.setSystemTime(1_800_000_000_000);
      const day = 86_400_000;
      const view = await harness({
        extension,
        status: {
          accessTokenCapturedTimeUtc: Date.now() - 76 * day,
          accessTokenExpiresTimeUtc: Date.now() + 24 * day,
          permissionCapturedTimeUtc: Date.now()
        }
      });
      const value = view.wrapper.get('[role="status"]');
      expect(value.attributes('data-tone')).toBe('danger');
      expect(value.classes()).toContain('text-red-700');
      expect(value.classes()).toContain('dark:text-red-300');
      expect(view.wrapper.text()).toContain('剩余约 24 天');
      uiI18n.global.locale.value = 'en-US';
      await flushPromises();
      expect(view.wrapper.text()).toContain('About 24 days left');
      expect(view.refresh).not.toHaveBeenCalled();
      view.wrapper.unmount();
    }
  );
  it('crosses half and quarter thresholds locally and resets only when a renewed lifetime is loaded', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const view = await harness({
      status: {
        accessTokenCapturedTimeUtc: Date.now() - 6 * 60_000,
        accessTokenExpiresTimeUtc: Date.now() + 6 * 60_000
      }
    });
    const tone = () => view.wrapper.get('[role="status"]').attributes('data-tone');
    expect(tone()).toBe('normal');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tone()).toBe('warning');
    expect(view.wrapper.get('[role="status"]').classes()).toContain('dark:text-amber-300');
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(tone()).toBe('danger');
    expect(view.read).toHaveBeenCalledOnce();
    view.read.mockResolvedValueOnce({
      ...(fixture.credential as ControlGatewayCredentialSummary),
      accessTokenCapturedTimeUtc: Date.now(),
      accessTokenExpiresTimeUtc: Date.now() + 12 * 60_000
    });
    globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
    await flushPromises();
    expect(tone()).toBe('normal');
    expect(view.read).toHaveBeenCalledTimes(2);
    expect(view.refresh).not.toHaveBeenCalled();
    view.wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not substitute permission-check time for an unknown token baseline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const view = await harness({
      status: {
        accessTokenExpiresTimeUtc: Date.now() + 24 * 86_400_000,
        permissionCapturedTimeUtc: Date.now() - 76 * 86_400_000
      }
    });
    expect(view.wrapper.get('[role="status"]').attributes('data-tone')).toBe('normal');
    view.wrapper.unmount();
  });
  it('counts down recorded expiry even with legacy/unknown permissions, without renewing or refetching on locale change', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const view = await harness({ status: { accessTokenExpiresTimeUtc: Date.now() + 120_000 } });
    expect(view.wrapper.text()).toContain('剩余约 2 分钟');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(view.wrapper.text()).toContain('剩余约 1 分钟');
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(view.wrapper.text()).toContain('About 1 minutes left');
    expect(view.read).toHaveBeenCalledOnce();
    expect(view.refresh).not.toHaveBeenCalled();
    view.wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    ['active', '有效期未返回'],
    ['inactive', 'System API 未启用'],
    ['not-recorded', '未记录 System API'],
    ['unknown', '权限未确认']
  ] as const)('keeps unknown expiry honest for %s permission evidence', async (permission, expected) => {
    const view = await harness({
      status: { accessTokenExpiresTimeUtc: null, systemApiPermission: permission }
    });
    expect(view.wrapper.text()).toContain(expected);
    expect(view.wrapper.text()).not.toContain('剩余约');
    expect(view.wrapper.get('button').attributes('aria-label')).toContain('非实时查询');
    expect(view.refresh).not.toHaveBeenCalled();
    view.wrapper.unmount();
  });
  it('does not request administrator metadata for regular users', async () => {
    const view = await harness({ role: 'user' });
    expect(view.wrapper.text()).toContain('只有管理员');
    expect(view.read).not.toHaveBeenCalled();
    view.wrapper.unmount();
  });
  it.each([null, 120_000])(
    'does not label a failed refresh as revoked access (%s expiry)',
    async (lifetime) => {
      vi.useFakeTimers();
      vi.setSystemTime(1_800_000_000_000);
      const view = await harness({
        status: {
          accessTokenExpiresTimeUtc: lifetime === null ? null : Date.now() + lifetime,
          lastRefreshErrorCode: 'ALIBABA_TOKEN_REFRESH_FAILED'
        }
      });
      expect(view.wrapper.text()).toContain('续期失败，请测试连接或重新授权');
      expect(view.wrapper.text()).not.toContain('授权已失效');
      expect(view.wrapper.text()).toContain(lifetime === null ? '未知' : '剩余约 2 分钟');
      expect(view.refresh).not.toHaveBeenCalled();
      view.wrapper.unmount();
    }
  );
  it('reads only safe extension settings; a locked vault is not a missing permission', async () => {
    const view = await harness({ extension: true, locked: true });
    expect(view.wrapper.text()).toContain('解锁凭据');
    expect(view.load).not.toHaveBeenCalled();
    expect(view.read).not.toHaveBeenCalled();
    view.wrapper.unmount();
  });
  it('reads unlocked extension metadata and reloads when credentials change, never replaying refresh', async () => {
    const view = await harness({ extension: true });
    expect(view.wrapper.text()).toContain('有效期未返回');
    view.load.mockResolvedValueOnce({ accessTokenExpiresTimeUtc: Date.now() + 2 * 86_400_000 });
    globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
    await flushPromises();
    expect(view.wrapper.text()).toContain('剩余约');
    expect(view.load).toHaveBeenCalledTimes(2);
    expect(view.readSession).not.toHaveBeenCalled();
    expect(view.refresh).not.toHaveBeenCalled();
    view.wrapper.unmount();
  });
});
