// @vitest-environment jsdom
import { defineComponent, h } from 'vue';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BffControlClient,
  type ControlGatewayCredentialSummary,
  type ControlSession
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import fixture from '../../../mock/data/dashboard-authorization.json';
import AccountMenu from '../src/components/AccountMenu.vue';
import DashboardAuthorizationAction from '../src/components/DashboardAuthorizationAction.vue';
import { provideServices, type AppServices } from '../src/lib/services';
import { uiI18n } from '../src/i18n';
import { GATEWAY_CONFIGURATION_EVENT } from '../src/lib/gateway-configuration-events';

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  uiI18n.global.locale.value = 'zh-CN';
});

describe('account menu', () => {
  it('only reveals sign-out after opening the avatar and emits it on selection', async () => {
    const wrapper = mount(AccountMenu, {
      props: { name: fixture.session.user.username, initials: 'FA', canLogout: true },
      attachTo: document.body
    });
    const body = new DOMWrapper(document.body);
    expect(body.find('[role="menu"]').exists()).toBe(false);
    await wrapper.get('[data-testid="account-menu-trigger"]').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    const logout = body.findAll('[role="menuitem"]').find((item) => item.text() === '退出');
    expect(logout).toBeDefined();
    expect(wrapper.emitted('logout')).toBeUndefined();
    await logout?.trigger('click');
    await flushPromises();
    expect(wrapper.emitted('logout')).toHaveLength(1);
    wrapper.unmount();
  });

  it('closes using Escape and does not invent a sign-out action for a local extension', async () => {
    uiI18n.global.locale.value = 'en-US';
    const wrapper = mount(AccountMenu, {
      props: { name: 'Local', initials: 'LO', canLogout: false },
      attachTo: document.body
    });
    await wrapper.get('button').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    const body = new DOMWrapper(document.body);
    expect(body.get('[role="menu"]').text()).toContain('Settings');
    expect(body.get('[role="menu"]').text()).not.toContain('Sign out');
    await body.get('[role="menu"]').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(body.find('[role="menu"]').exists()).toBe(false);
    expect(wrapper.emitted('logout')).toBeUndefined();
    wrapper.unmount();
  });
});

async function harness(
  options: {
    mode?: AppServices['mode'];
    role?: 'admin' | 'user';
    canRefresh?: boolean;
    cloudflare?: boolean;
  } = {}
) {
  const client = new BffControlClient({ baseUrl: 'http://localhost:8787' });
  const session = fixture.session as ControlSession;
  const readSession = vi.spyOn(client, 'session').mockResolvedValue({
    ...session,
    principal: { ...session.principal, role: options.role ?? 'admin' }
  });
  const summary: ControlGatewayCredentialSummary = {
    ...(fixture.credential as ControlGatewayCredentialSummary),
    canRefresh: options.canRefresh ?? true
  };
  const status = vi.spyOn(client, 'gatewayCredentialStatus').mockResolvedValue(summary);
  const refresh = vi.spyOn(client, 'refreshGatewayCredential').mockResolvedValue(summary);
  const acquire = vi.fn();
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway: new MockGatewayClient(0),
        settings: { load: vi.fn(), save: vi.fn() },
        control: client,
        mode: options.mode ?? 'bff',
        openCredentialAcquisition: acquire,
        runtime: {
          metaStatus: 'ready',
          backendMeta: {
            runtime: options.cloudflare ? 'cloudflare' : 'node',
            environment: options.cloudflare ? 'self-hosted' : 'local-node',
            database: options.cloudflare ? 'd1' : 'sqlite',
            gatewayMode: 'real',
            apiPrefix: '/api/v1',
            version: '2.15.0'
          }
        }
      });
      return () => h(DashboardAuthorizationAction);
    }
  });
  const wrapper = mount(Host, { attachTo: document.body });
  await flushPromises();
  const body = new DOMWrapper(document.body);
  return { wrapper, body, readSession, status, refresh, acquire };
}

describe('dashboard authorization renewal', () => {
  it('does not fetch or renew on mount or a language switch; refresh is an explicit action', async () => {
    const h = await harness();
    expect(h.readSession).not.toHaveBeenCalled();
    expect(h.status).not.toHaveBeenCalled();
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(h.readSession).not.toHaveBeenCalled();
    await h.wrapper.get('button').trigger('click');
    await flushPromises();
    expect(h.readSession).toHaveBeenCalledOnce();
    expect(h.status).toHaveBeenCalledOnce();
    expect(h.refresh).not.toHaveBeenCalled();
    const changed = vi.fn();
    globalThis.addEventListener(GATEWAY_CONFIGURATION_EVENT, changed);
    try {
      const refreshButton = h.body.findAll('button').find((button) => button.text() === 'Refresh Token');
      expect(refreshButton).toBeDefined();
      await refreshButton?.trigger('click');
      await flushPromises();
      expect(h.refresh).toHaveBeenCalledOnce();
      expect(changed).toHaveBeenCalledOnce();
      expect(h.body.find('[role="dialog"]').exists()).toBe(false);
    } finally {
      globalThis.removeEventListener(GATEWAY_CONFIGURATION_EVENT, changed);
      h.wrapper.unmount();
    }
  });

  it('routes extension renewal to the existing authorization assistant without BFF calls', async () => {
    const h = await harness({ mode: 'extension' });
    await h.wrapper.get('button').trigger('click');
    expect(h.acquire).toHaveBeenCalledOnce();
    expect(h.readSession).not.toHaveBeenCalled();
    expect(h.status).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
    h.wrapper.unmount();
  });

  it('does not expose credential management to a non-admin', async () => {
    const h = await harness({ role: 'user' });
    await h.wrapper.get('button').trigger('click');
    await flushPromises();
    expect(h.body.get('[role="dialog"]').text()).toContain('只有管理员');
    expect(h.status).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.body.find('[role="dialog"] a').exists()).toBe(false);
    h.wrapper.unmount();
  });

  it.each([false, true])(
    'guides a non-refreshable %s backend to its existing credential settings',
    async (cloudflare) => {
      const h = await harness({ canRefresh: false, cloudflare });
      await h.wrapper.get('button').trigger('click');
      await flushPromises();
      expect(h.body.get('[role="dialog"] a').attributes('href')).toBe(cloudflare ? '#/admin' : '#/settings');
      expect(h.body.get('[role="dialog"]').text()).toContain('重新授权');
      expect(h.body.findAll('button').some((button) => button.text() === '刷新 Token')).toBe(false);
      expect(h.refresh).not.toHaveBeenCalled();
      h.wrapper.unmount();
    }
  );

  it('keeps refresh failure visible without retrying or changing credentials', async () => {
    const h = await harness();
    h.refresh.mockRejectedValue(new Error('Authorization denied'));
    const changed = vi.fn();
    globalThis.addEventListener(GATEWAY_CONFIGURATION_EVENT, changed);
    await h.wrapper.get('button').trigger('click');
    await flushPromises();
    const refreshButton = h.body.findAll('button').find((button) => button.text() === '刷新 Token');
    await refreshButton?.trigger('click');
    await flushPromises();
    expect(h.refresh).toHaveBeenCalledOnce();
    expect(changed).not.toHaveBeenCalled();
    expect(h.status).toHaveBeenCalledTimes(2);
    expect(h.body.get('[role="dialog"]').text()).toContain('Authorization denied');
    expect(h.body.get('[role="dialog"] a').attributes('href')).toBe('#/settings');
    globalThis.removeEventListener(GATEWAY_CONFIGURATION_EVENT, changed);
    h.wrapper.unmount();
  });

  it('removes the refresh action after a confirmed expiry, while keeping reauthorization and the error visible', async () => {
    const h = await harness();
    h.refresh.mockRejectedValue(new Error('Refresh Token 已过期，请重新授权'));
    h.status
      .mockResolvedValueOnce({ ...(fixture.credential as ControlGatewayCredentialSummary), canRefresh: true })
      .mockResolvedValueOnce({
        ...(fixture.credential as ControlGatewayCredentialSummary),
        canRefresh: false,
        lastRefreshErrorCode: 'ALIBABA_REFRESH_TOKEN_EXPIRED'
      });
    await h.wrapper.get('button').trigger('click');
    await flushPromises();
    await h.body
      .findAll('button')
      .find((button) => button.text() === '刷新 Token')
      ?.trigger('click');
    await flushPromises();
    expect(h.body.get('[role="dialog"]').text()).toContain('重新授权');
    expect(h.body.get('[role="dialog"] a').attributes('href')).toBe('#/settings');
    expect(h.body.findAll('button').some((button) => button.text() === '刷新 Token')).toBe(false);
    expect(h.refresh).toHaveBeenCalledOnce();
    h.wrapper.unmount();
  });

  it('shows a previous refresh failure as a warning without attempting it on open', async () => {
    const h = await harness();
    h.status.mockResolvedValueOnce({
      ...(fixture.credential as ControlGatewayCredentialSummary),
      lastRefreshErrorCode: 'ALIBABA_TOKEN_REFRESH_FAILED'
    });
    await h.wrapper.get('button').trigger('click');
    await flushPromises();
    expect(h.body.get('[role="dialog"]').text()).toContain('续期失败，请测试连接或重新授权');
    expect(h.refresh).not.toHaveBeenCalled();
    h.wrapper.unmount();
  });

  it('does not offer live renewal in the Mock demo', async () => {
    const h = await harness({ mode: 'mock' });
    expect(h.wrapper.find('button').exists()).toBe(false);
    expect(h.readSession).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
    h.wrapper.unmount();
  });
});
