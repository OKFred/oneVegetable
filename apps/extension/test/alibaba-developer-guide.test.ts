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
import { showAlibabaDeveloperGuide } from '../lib/alibaba-credential-page-driver';

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
  document.body.replaceChildren();
});

describe('Alibaba page guide storage isolation', () => {
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
