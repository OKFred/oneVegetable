// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_PREFERENCES_STORAGE_KEY } from '@one-vegetable/core';

const mocks = vi.hoisted(() => ({
  listeners: new Set<(message: unknown) => void>(),
  get: vi.fn<() => Promise<Record<string, unknown>>>(),
  executeScript: vi.fn(),
  sendTabMessage: vi.fn(),
  sendMessage: vi.fn(),
  openOptionsPage: vi.fn()
}));
vi.mock('wxt/browser', () => ({
  browser: {
    storage: { local: { get: mocks.get } },
    scripting: { executeScript: mocks.executeScript },
    tabs: { sendMessage: mocks.sendTabMessage },
    runtime: {
      sendMessage: mocks.sendMessage,
      openOptionsPage: mocks.openOptionsPage,
      onMessage: {
        addListener: (listener: (message: unknown) => void) => {
          mocks.listeners.add(listener);
        },
        removeListener: (listener: (message: unknown) => void) => {
          mocks.listeners.delete(listener);
        }
      }
    }
  }
}));
vi.mock('wxt/utils/define-unlisted-script', () => ({
  defineUnlistedScript: (main: () => void) => ({ main })
}));
import mountGuide from '../entrypoints/alibaba-developer-guide';
import {
  showAlibabaDeveloperGuide,
  showAlibabaAuthorizationGuide
} from '../lib/alibaba-credential-page-driver';

const prerequisite = {
  status: 'prerequisite-required',
  reasonCode: 'developer-registration-under-review',
  checkedAtUtc: 1
} as const;
function notify(message: unknown): void {
  for (const listener of mocks.listeners) listener(message);
}
function panel(): ShadowRoot {
  const root = document.getElementById('one-vegetable-alibaba-developer-guide')?.shadowRoot;
  if (!root) throw new Error('Missing guide');
  return root;
}
function control(label: string): HTMLButtonElement {
  const button = panel().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw new Error(`Missing guide control ${label}`);
  return button;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.get.mockRejectedValue(new Error('Access to storage is not allowed from this context.'));
  mocks.sendMessage.mockResolvedValue({ ok: true, data: null });
  mocks.openOptionsPage.mockResolvedValue(undefined);
  mocks.executeScript.mockResolvedValue([]);
  mocks.sendTabMessage.mockResolvedValue(undefined);
});
afterEach(() => {
  notify({ kind: 'one-vegetable-alibaba-developer-guide-remove' });
  document.body.replaceChildren();
});

describe('Alibaba page guide storage isolation', () => {
  it('replaces an orphaned guide after extension Reload and reconnects messages', () => {
    const staleHost = document.createElement('div');
    staleHost.id = 'one-vegetable-alibaba-developer-guide';
    document.documentElement.append(staleHost);
    mountGuide.main();
    expect(staleHost.isConnected).toBe(false);
    expect(mocks.listeners.size).toBe(1);
    notify({
      kind: 'one-vegetable-alibaba-developer-guide-update',
      uiLocale: 'zh-CN',
      authorization: { protocol: 'iop', phase: 'application' }
    });
    expect(panel().querySelector('h2')?.textContent).toContain('正在读取当前应用');
  });
  it('reuses a live guide and replaces detached instances without duplicate listeners', () => {
    mountGuide.main();
    const first = panel();
    mountGuide.main();
    expect(panel()).toBe(first);
    expect(mocks.listeners.size).toBe(1);
    first.host.remove();
    mountGuide.main();
    expect(panel()).not.toBe(first);
    expect(mocks.listeners.size).toBe(1);
    notify({ kind: 'one-vegetable-alibaba-developer-guide-remove' });
    expect(mocks.listeners.size).toBe(0);
    mountGuide.main();
    expect(mocks.listeners.size).toBe(1);
  });
  it('shows a concrete localized failure without echoing untrusted error strings', () => {
    mountGuide.main();
    notify({
      kind: 'one-vegetable-alibaba-developer-guide-update',
      uiLocale: 'zh-CN',
      authorization: { protocol: 'iop', phase: 'blocked', reasonCode: 'IOP_APP_SECRET_CONTROL_UNAVAILABLE' }
    });
    expect(panel().querySelector('h2')?.textContent).toContain('请手动点击 App Secret 旁的 View');
    notify({
      kind: 'one-vegetable-alibaba-developer-guide-update',
      uiLocale: 'en-US',
      authorization: { protocol: 'iop', phase: 'blocked', reasonCode: 'IOP_APP_SECURITY_CHECK' }
    });
    expect(panel().querySelector('h2')?.textContent).toContain('Complete the CAPTCHA');
    notify({
      kind: 'one-vegetable-alibaba-developer-guide-update',
      authorization: { protocol: 'iop', phase: 'blocked', reasonCode: '<script>secret-token</script>' }
    });
    expect(panel().querySelector('h2')?.textContent).toContain('Automatic reading stopped');
    expect(panel().textContent).not.toContain('secret-token');
  });
  it('passes only a whitelisted reason code to the page guide', async () => {
    await showAlibabaAuthorizationGuide(7, 'iop', 'blocked', 'IOP_APP_LOGIN_REQUIRED');
    expect(mocks.sendTabMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        authorization: { protocol: 'iop', phase: 'blocked', reasonCode: 'IOP_APP_LOGIN_REQUIRED' }
      })
    );
  });
  it('shows safe progress before Application center has been clicked', () => {
    mountGuide.main();
    notify({
      kind: 'one-vegetable-alibaba-developer-guide-update',
      uiLocale: 'zh-CN',
      authorization: { protocol: 'iop', phase: 'opening' }
    });
    expect(panel().querySelector('h2')?.textContent).toContain('准备进入应用中心');
    expect(panel().textContent).toContain('IOP');
    expect(control('打开 IOP 授权工具').hidden).toBe(true);
    expect(mocks.get).not.toHaveBeenCalled();
    notify({
      kind: 'one-vegetable-alibaba-developer-guide-update',
      uiLocale: 'en-US',
      authorization: { protocol: 'iop', phase: 'secret' }
    });
    expect(panel().querySelector('h2')?.textContent).toContain('Reading App Secret');
  });
  it('explains IOP versus legacy TOP and only opens the local IOP tool, never acquires credentials', async () => {
    mountGuide.main();
    notify({
      kind: 'one-vegetable-alibaba-developer-guide-update',
      uiLocale: 'zh-CN',
      state: {
        status: 'failed',
        error: { code: 'TOP_APPLICATION_REQUIRED', message: 'fixture', retryable: false }
      }
    });
    expect(panel().textContent).toContain('TOP 与 IOP 是两套独立授权');
    expect(panel().textContent).toContain('旧 TOP 应用不是这里的另一个页签');
    expect(panel().querySelector('h2')?.textContent).toBe('请使用新版 IOP 授权工具');
    expect(control('重新检查').hidden).toBe(true);
    control('打开 IOP 授权工具').click();
    await vi.waitFor(() => {
      expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ operation: 'open-iop-tool' })
      );
    });
    expect(mocks.get).not.toHaveBeenCalled();
    notify({
      kind: 'one-vegetable-alibaba-developer-guide-update',
      uiLocale: 'en-US',
      state: {
        status: 'failed',
        error: { code: 'TOP_APPLICATION_REQUIRED', message: 'fixture', retryable: false }
      }
    });
    expect(panel().textContent).toContain('TOP and IOP are separate authorizations');
    expect(control('Open IOP authorization tool')).toBeDefined();
  });

  it('mounts with storage denied and accepts only the locale passed by the worker', () => {
    mountGuide.main();
    notify({ kind: 'one-vegetable-alibaba-developer-guide-update', state: prerequisite, uiLocale: 'zh-CN' });
    expect(panel().textContent).toContain('注册资料正在审核');
    expect(control('重新检查')).toBeDefined();
    expect(mocks.get).not.toHaveBeenCalled();
    notify({ kind: 'one-vegetable-alibaba-developer-guide-update', state: prerequisite, uiLocale: 'en-US' });
    expect(panel().textContent).toContain('Registration is under review');
    expect(control('Check again')).toBeDefined();
    mountGuide.main();
    expect(mocks.listeners.size).toBe(1);
    notify({ kind: 'one-vegetable-alibaba-developer-guide-remove' });
    expect(mocks.listeners.size).toBe(0);
  });

  it('rechecks once without starting OAuth or polling and catches a disconnected worker', async () => {
    mountGuide.main();
    notify({ kind: 'one-vegetable-alibaba-developer-guide-update', state: prerequisite, uiLocale: 'en-US' });
    control('Check again').click();
    await vi.waitFor(() => {
      expect(mocks.sendMessage).toHaveBeenCalledOnce();
    });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'read-prerequisite' })
    );
    await vi.waitFor(() => {
      expect(panel().textContent).toContain('The prerequisite changed');
    });
    mocks.openOptionsPage.mockRejectedValue(new Error('Extension context invalidated'));
    control('Return to oneVegetable').click();
    await vi.waitFor(() => {
      expect(panel().textContent).toContain('The check failed');
    });
  });

  it('reads UI preferences only in the trusted driver and passes no stored secrets to the page', async () => {
    mocks.get.mockResolvedValue({
      [APP_PREFERENCES_STORAGE_KEY]: { uiLocale: 'zh-CN' },
      secret: 'not-for-content'
    });
    await showAlibabaDeveloperGuide(7, prerequisite);
    expect(mocks.get).toHaveBeenCalledWith(APP_PREFERENCES_STORAGE_KEY);
    expect(mocks.sendTabMessage).toHaveBeenCalledExactlyOnceWith(7, {
      kind: 'one-vegetable-alibaba-developer-guide-update',
      state: prerequisite,
      uiLocale: 'zh-CN'
    });
  });
});
