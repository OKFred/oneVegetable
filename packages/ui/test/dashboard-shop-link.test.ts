// @vitest-environment jsdom
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'vue-sonner';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { provideServices } from '../src/lib/services';
import { uiI18n } from '../src/i18n';
import DashboardShopLink from '../src/components/DashboardShopLink.vue';
import {
  dashboardShopScope,
  loadDashboardShopUrl,
  saveDashboardShopUrl
} from '../src/lib/dashboard-shop-url';

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), dismiss: vi.fn() }
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  uiI18n.global.locale.value = 'zh-CN';
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  uiI18n.global.locale.value = 'zh-CN';
});

async function setup() {
  const gateway = new MockGatewayClient(0);
  const context = await gateway.galleryTransferContext();
  const readContext = vi
    .spyOn(gateway, 'galleryTransferContext')
    .mockImplementation(() => Promise.resolve({ ...context }));
  const request = vi.spyOn(gateway, 'request');
  const wrapper = mount(
    defineComponent({
      setup() {
        provideServices({ gateway, mode: 'mock', settings: { load: vi.fn(), save: vi.fn() } });
        return () => h(DashboardShopLink);
      }
    }),
    { attachTo: document.body }
  );
  await flushPromises();
  return { wrapper, context, readContext, request };
}

function getInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('[data-testid="dashboard-shop-url"]');
  if (!input) throw new Error('Missing shop URL input');
  return input;
}
async function enterUrl(value: string) {
  const input = getInput();
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await flushPromises();
}
async function clickTestId(id: string) {
  const element = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`Missing ${id}`);
  element.click();
  await flushPromises();
}

describe('dashboard shop link', () => {
  it('validates, saves, safely links, edits and clears only a local preference', async () => {
    const item = await setup();
    await clickTestId('dashboard-shop-edit');
    await enterUrl('https://evil.test');
    expect(document.querySelector<HTMLButtonElement>('[data-testid="dashboard-shop-save"]')?.disabled).toBe(
      true
    );
    await enterUrl('https://shop.en.alibaba.com');
    await clickTestId('dashboard-shop-save');
    const link = item.wrapper.get('[data-testid="dashboard-shop-visit"]');
    expect(link.attributes()).toMatchObject({
      href: 'https://shop.en.alibaba.com/',
      target: '_blank',
      rel: 'noopener noreferrer'
    });
    expect(loadDashboardShopUrl(localStorage, dashboardShopScope('mock', item.context))).toBe(
      'https://shop.en.alibaba.com/'
    );
    await clickTestId('dashboard-shop-edit');
    expect(getInput().value).toBe('https://shop.en.alibaba.com/');
    await clickTestId('dashboard-shop-clear');
    expect(item.wrapper.find('[data-testid="dashboard-shop-visit"]').exists()).toBe(false);
    expect(loadDashboardShopUrl(localStorage, dashboardShopScope('mock', item.context))).toBeNull();
    expect(item.request).not.toHaveBeenCalled();
    item.wrapper.unmount();
  });

  it('discards cancelled changes and switches language without a network request', async () => {
    const item = await setup();
    await clickTestId('dashboard-shop-edit');
    await enterUrl('https://shop.en.alibaba.com');
    const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
      (button) => button.textContent.trim() === '取消'
    );
    if (!cancel) throw new Error('Missing cancel button');
    cancel.click();
    await flushPromises();
    expect(localStorage.length).toBe(0);
    const requests = item.readContext.mock.calls.length;
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(item.wrapper.text()).toContain('Set shop link');
    expect(item.readContext).toHaveBeenCalledTimes(requests);
    item.wrapper.unmount();
  });

  it('rejects a save after account switch and reloads the newly scoped link', async () => {
    const item = await setup();
    await clickTestId('dashboard-shop-edit');
    await enterUrl('https://first.en.alibaba.com');
    const originalScope = dashboardShopScope('mock', item.context);
    item.context.gateway = 'other-account';
    saveDashboardShopUrl(
      localStorage,
      dashboardShopScope('mock', item.context),
      'https://second.en.alibaba.com'
    );
    await clickTestId('dashboard-shop-save');
    expect(loadDashboardShopUrl(localStorage, originalScope)).toBeNull();
    expect(item.wrapper.get('[data-testid="dashboard-shop-visit"]').attributes('href')).toBe(
      'https://second.en.alibaba.com/'
    );
    item.wrapper.unmount();
  });

  it('does not show a stale shop link after context failures and can retry', async () => {
    const item = await setup();
    item.readContext.mockRejectedValueOnce(new Error('VAULT_LOCKED'));
    await clickTestId('dashboard-shop-edit');
    expect(item.wrapper.text()).not.toContain('暂时无法确认当前账号');
    expect(toast.warning).toHaveBeenCalledWith(
      '暂时无法确认当前账号或读取本地设置，请解锁凭据或重新登录后再试。',
      expect.objectContaining({ id: 'dashboard-shop-context-unavailable', duration: 4_000 })
    );
    expect(document.querySelector('[data-testid="dashboard-shop-url"]')).toBeNull();
    await clickTestId('dashboard-shop-edit');
    expect(getInput()).toBeDefined();
    expect(toast.dismiss).toHaveBeenCalledWith('dashboard-shop-context-unavailable');
    item.wrapper.unmount();
  });

  it('keeps the editor open and reports a storage failure without claiming success', async () => {
    const item = await setup();
    await clickTestId('dashboard-shop-edit');
    await enterUrl('https://shop.en.alibaba.com');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await clickTestId('dashboard-shop-save');
    expect(document.body.textContent).not.toContain('无法保存店铺链接');
    expect(toast.error).toHaveBeenCalledWith(
      '无法保存店铺链接，请确认登录和凭据状态，以及浏览器本地存储是否可用。',
      expect.objectContaining({ id: 'dashboard-shop-save-failed', duration: 4_000 })
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(getInput().value).toBe('https://shop.en.alibaba.com');
    expect(item.wrapper.find('[data-testid="dashboard-shop-visit"]').exists()).toBe(false);
    item.wrapper.unmount();
  });

  it('warns once per unavailable episode on focus, but lets an explicit retry show feedback again', async () => {
    const item = await setup();
    item.readContext.mockRejectedValue(new Error('VAULT_LOCKED'));
    globalThis.dispatchEvent(new Event('focus'));
    await flushPromises();
    globalThis.dispatchEvent(new Event('focus'));
    await flushPromises();
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(item.wrapper.find('[role="status"]').exists()).toBe(false);
    await clickTestId('dashboard-shop-edit');
    expect(toast.warning).toHaveBeenCalledTimes(2);
    item.readContext.mockResolvedValue({ ...item.context });
    globalThis.dispatchEvent(new Event('focus'));
    await flushPromises();
    item.readContext.mockRejectedValue(new Error('VAULT_LOCKED'));
    globalThis.dispatchEvent(new Event('focus'));
    await flushPromises();
    expect(toast.warning).toHaveBeenCalledTimes(3);
    item.wrapper.unmount();
  });

  it('uses the current UI language and provides a Settings action without permanently displaying the warning', async () => {
    const item = await setup();
    uiI18n.global.locale.value = 'en-US';
    item.readContext.mockRejectedValueOnce(new Error('VAULT_LOCKED'));
    await clickTestId('dashboard-shop-edit');
    expect(toast.warning).toHaveBeenCalledWith(
      'Unable to identify the current account or read local settings. Unlock credentials or sign in again, then retry.',
      expect.objectContaining({ id: 'dashboard-shop-context-unavailable', duration: 4_000 })
    );
    const action = vi.mocked(toast.warning).mock.calls.at(-1)?.[1]?.action;
    expect(action).toMatchObject({ label: 'Settings' });
    expect(action && 'onClick' in action ? typeof action.onClick : null).toBe('function');
    expect(item.wrapper.text()).not.toContain('Unable to identify');
    item.wrapper.unmount();
  });

  it('does not emit a late warning after leaving the page', async () => {
    const item = await setup();
    let rejectRead: ((reason: Error) => void) | undefined;
    item.readContext.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRead = reject;
        })
    );
    globalThis.dispatchEvent(new Event('focus'));
    item.wrapper.unmount();
    rejectRead?.(new Error('VAULT_LOCKED'));
    await flushPromises();
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
