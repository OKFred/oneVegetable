// @vitest-environment jsdom
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { provideServices } from '../src/lib/services';
import { uiI18n } from '../src/i18n';
import DashboardShopLink from '../src/components/DashboardShopLink.vue';
import {
  dashboardShopScope,
  loadDashboardShopUrl,
  saveDashboardShopUrl
} from '../src/lib/dashboard-shop-url';

beforeEach(() => {
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
    expect(item.wrapper.text()).toContain('暂时无法确认当前账号');
    expect(document.querySelector('[data-testid="dashboard-shop-url"]')).toBeNull();
    await clickTestId('dashboard-shop-edit');
    expect(getInput()).toBeDefined();
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
    expect(document.body.textContent).toContain('无法保存店铺链接');
    expect(getInput().value).toBe('https://shop.en.alibaba.com');
    expect(item.wrapper.find('[data-testid="dashboard-shop-visit"]').exists()).toBe(false);
    item.wrapper.unmount();
  });
});
