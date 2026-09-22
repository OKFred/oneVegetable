// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CredentialVaultRepository, CredentialVaultStatus } from '@one-vegetable/core';
import WorkbenchStartupDialogs from '../src/components/WorkbenchStartupDialogs.vue';
import { uiI18n } from '../src/i18n';

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn() } }));
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  uiI18n.global.locale.value = 'zh-CN';
  document.documentElement.classList.remove('dark');
});

function status(state: CredentialVaultStatus['state']): CredentialVaultStatus {
  return {
    state,
    hasAppKey: true,
    hasAppSecret: true,
    hasAccessToken: true,
    appKey: '',
    endpoint: '',
    signMethod: 'hmac',
    idleTimeoutMinutes: 0,
    lastActivityAt: null,
    idleRemainingSeconds: null,
    lockReason: 'session-ended'
  };
}
function vault(state: CredentialVaultStatus['state']) {
  return {
    status: vi.fn(() => Promise.resolve(status(state))),
    unlock: vi.fn(() => Promise.resolve(status('unlocked'))),
    create: vi.fn(() => Promise.resolve(status('unlocked'))),
    migrate: vi.fn(() => Promise.resolve(status('unlocked'))),
    lock: vi.fn(() => Promise.resolve(status('locked'))),
    rotate: vi.fn(() => Promise.resolve(status('unlocked'))),
    updatePolicy: vi.fn(() => Promise.resolve(status('unlocked')))
  } satisfies CredentialVaultRepository;
}
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}

describe('workbench startup dialogs', () => {
  it('notices another tab unlocking on focus without collecting a passphrase', async () => {
    const repository = vault('locked');
    const wrapper = mount(WorkbenchStartupDialogs, {
      props: { vault: repository, extension: true },
      attachTo: document.body
    });
    await flushPromises();
    repository.status.mockResolvedValue(status('unlocked'));
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    expect(repository.unlock).not.toHaveBeenCalled();
    expect(wrapper.emitted('unlocked')).toHaveLength(1);
    expect(wrapper.emitted('ready')).toHaveLength(1);
    wrapper.unmount();
  });
  it('provides readable English actions and semantic dark-mode surfaces', async () => {
    uiI18n.global.locale.value = 'en-US';
    document.documentElement.classList.add('dark');
    const wrapper = mount(WorkbenchStartupDialogs, {
      props: { vault: vault('locked'), extension: true },
      attachTo: document.body
    });
    await flushPromises();
    expect(document.body.textContent).toContain('not your Alibaba website password');
    expect(document.querySelector('[role="dialog"]')?.classList.contains('bg-background')).toBe(true);
    button('Unlock later').click();
    await flushPromises();
    expect(wrapper.emitted('ready')).toHaveLength(1);
    wrapper.unmount();
  });
  it.each(['empty', 'legacy', 'invalid', 'unlocked'] as const)(
    'does not prompt for %s vaults',
    async (state) => {
      const wrapper = mount(WorkbenchStartupDialogs, {
        props: { vault: vault(state), extension: true },
        attachTo: document.body
      });
      await flushPromises();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(wrapper.emitted('ready')).toHaveLength(1);
      wrapper.unmount();
    }
  );
  it('never requests vault state outside extension mode', async () => {
    const repository = vault('locked');
    const wrapper = mount(WorkbenchStartupDialogs, { props: { vault: repository, extension: false } });
    await flushPromises();
    expect(repository.status).not.toHaveBeenCalled();
    expect(wrapper.emitted('ready')).toHaveLength(1);
    wrapper.unmount();
  });
  it('allows later immediately without offering legacy cleanup or modifying old drafts', async () => {
    localStorage.setItem('one-vegetable-product-editor-drafts-v3', 'private draft');
    localStorage.setItem('one-vegetable:rfq-draft:1', 'private draft');
    localStorage.setItem('one-vegetable:batch-queue', 'keep');
    const repository = vault('locked');
    const wrapper = mount(WorkbenchStartupDialogs, {
      props: { vault: repository, extension: true },
      attachTo: document.body
    });
    await flushPromises();
    expect(document.body.textContent).toContain('不是 Alibaba 网站密码');
    expect(document.body.textContent).not.toContain('清理旧版本地编辑草稿');
    button('稍后解锁').click();
    await flushPromises();
    expect(wrapper.emitted('ready')).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(repository.unlock).not.toHaveBeenCalled();
    expect(localStorage.getItem('one-vegetable-product-editor-drafts-v3')).toBe('private draft');
    expect(localStorage.getItem('one-vegetable:rfq-draft:1')).toBe('private draft');
    expect(localStorage.getItem('one-vegetable:batch-queue')).toBe('keep');
    expect(localStorage.getItem('one-vegetable:legacy-editor-drafts:notice:v1')).toBeNull();
    wrapper.unmount();
  });
  it('never inspects or changes local drafts, queues, tasks or preferences at startup', async () => {
    const old = [
      'one-vegetable-product-schema-draft',
      'one-vegetable-product-editor-drafts-v2',
      'one-vegetable-product-editor-drafts-v3',
      'one-vegetable:rfq-draft:42'
    ];
    const keep = ['one-vegetable:batch-queue', 'one-vegetable:columns:v2:products', 'one-vegetable:tasks'];
    [...old, ...keep].forEach((key) => {
      localStorage.setItem(key, '{}');
    });
    const storageMethods = ['getItem', 'key', 'setItem', 'removeItem', 'clear'] as const;
    const spies = storageMethods.map((method) => vi.spyOn(Storage.prototype, method));
    const wrapper = mount(WorkbenchStartupDialogs, {
      props: { vault: vault('unlocked'), extension: true },
      attachTo: document.body
    });
    await flushPromises();
    expect(wrapper.emitted('ready')).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
    [...old, ...keep].forEach((key) => {
      expect(localStorage.getItem(key)).toBe('{}');
    });
    wrapper.unmount();
  });
  it('keeps unlock failure local and removes the password after each attempt', async () => {
    const repository = vault('locked');
    vi.mocked(repository.unlock).mockRejectedValueOnce(new Error('private failure'));
    const wrapper = mount(WorkbenchStartupDialogs, {
      props: { vault: repository, extension: true },
      attachTo: document.body
    });
    await flushPromises();
    const input = document.querySelector<HTMLInputElement>('input[type="password"]');
    if (!input) throw new Error('Missing passphrase input');
    input.value = 'test-only';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    button('解锁').click();
    await flushPromises();
    expect(input.value).toBe('');
    expect(document.body.textContent).not.toContain('private failure');
    expect(wrapper.emitted('unlocked')).toBeUndefined();
    expect(wrapper.emitted('ready')).toBeUndefined();
    input.value = 'test-only';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    button('解锁').click();
    await flushPromises();
    expect(wrapper.emitted('unlocked')).toHaveLength(1);
    expect(wrapper.emitted('ready')).toHaveLength(1);
    expect(localStorage.length).toBe(0);
    wrapper.unmount();
  });
  it.each(['overlay', 'escape', 'close'] as const)('can dismiss with %s', async (kind) => {
    const wrapper = mount(WorkbenchStartupDialogs, {
      props: { vault: vault('locked'), extension: true },
      attachTo: document.body
    });
    await flushPromises();
    if (kind === 'overlay') document.querySelector<HTMLElement>('.ov-dialog-overlay')?.click();
    else if (kind === 'escape')
      document.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
      );
    else document.querySelector<HTMLButtonElement>('button[aria-label]')?.click();
    await flushPromises();
    expect(wrapper.emitted('ready')).toHaveLength(1);
    wrapper.unmount();
  });
});
