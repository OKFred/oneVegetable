// @vitest-environment jsdom
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'vue-sonner';
import {
  ALIBABA_GATEWAY,
  type CredentialVaultRepository,
  type CredentialVaultStatus
} from '@one-vegetable/core';
import type { ExtensionAlibabaCredentialAcquisitionRepository } from '@one-vegetable/core';
import fixture from '../../../mock/data/node-gateway-credentials.json';
import AlibabaAuthorizationProtocolDialog from '../src/components/AlibabaAuthorizationProtocolDialog.vue';
import { uiI18n } from '../src/i18n';

const unmount: (() => void)[] = [];
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
afterEach(() => {
  unmount.splice(0).forEach((dispose) => {
    dispose();
  });
  document.body.innerHTML = '';
  document.documentElement.classList.remove('dark');
  uiI18n.global.locale.value = 'zh-CN';
});

async function dialog(
  purpose: 'acquire' | 'renew' = 'acquire',
  vault?: CredentialVaultRepository,
  acquisition?: ExtensionAlibabaCredentialAcquisitionRepository
) {
  const select = vi.fn();
  const wrapper = mount(AlibabaAuthorizationProtocolDialog, {
    props: {
      open: true,
      purpose,
      onSelect: select,
      ...(vault ? { vault } : {}),
      ...(acquisition ? { acquisition } : {})
    },
    attachTo: document.body
  });
  unmount.push(() => {
    wrapper.unmount();
  });
  await flushPromises();
  return { wrapper, select, body: new DOMWrapper(document.body) };
}

describe('Alibaba authorization protocol selection', () => {
  it('previews both protocols and saves a JSON array in one call', async () => {
    const acquisition = {
      ...testAcquisition(),
      importBundles: vi.fn(() => Promise.resolve(testStatus('unlocked')))
    };
    const view = await dialog('acquire', testVault('unlocked'), acquisition);
    await view.body.get('[data-testid="authorization-method-file"]').trigger('click');
    const bundles = [{ ...fixture.oauthBundle, protocol: 'iop' }, fixture.oauthBundle];
    await selectFile(view.body, JSON.stringify(bundles));
    const preview = view.body.get('[data-testid="authorization-file-preview"]').text();
    expect(preview).toContain('TOP');
    expect(preview).toContain('IOP');
    expect(view.body.text()).not.toContain(fixture.oauthBundle.application.appSecret);
    expect(acquisition.importBundles).not.toHaveBeenCalled();
    await view.body.get('[data-testid="confirm-authorization-file-import"]').trigger('click');
    await flushPromises();
    expect(acquisition.importBundles).toHaveBeenCalledExactlyOnceWith(bundles);
    expect(acquisition.importBundle).not.toHaveBeenCalled();
    expect(view.wrapper.emitted('imported')).toHaveLength(1);
  });

  it('rejects duplicate protocols and any invalid array entry before saving', async () => {
    const acquisition = { ...testAcquisition(), importBundles: vi.fn() };
    const view = await dialog('acquire', testVault('unlocked'), acquisition);
    await view.body.get('[data-testid="authorization-method-file"]').trigger('click');
    for (const entries of [[], [fixture.oauthBundle, fixture.oauthBundle], [fixture.oauthBundle, {}]]) {
      await selectFile(view.body, JSON.stringify(entries));
      expect(view.body.find('[data-testid="authorization-file-preview"]').exists()).toBe(false);
      expect(
        view.body.get('[data-testid="confirm-authorization-file-import"]').attributes('disabled')
      ).toBeDefined();
    }
    expect(acquisition.importBundle).not.toHaveBeenCalled();
    expect(acquisition.importBundles).not.toHaveBeenCalled();
  });

  it('routes a file selected in Settings into the same batch preview without saving', async () => {
    const acquisition = { ...testAcquisition(), importBundles: vi.fn() };
    const view = await dialog('acquire', testVault('unlocked'), acquisition);
    const source = JSON.stringify([fixture.oauthBundle, { ...fixture.oauthBundle, protocol: 'iop' }]);
    const file = new File([source], 'dual.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(source) });
    await view.wrapper.setProps({ initialFile: file });
    await flushPromises();
    expect(view.body.get('[data-testid="authorization-file-preview"]').text()).toContain('TOP');
    expect(view.body.get('[data-testid="authorization-file-preview"]').text()).toContain('IOP');
    expect(acquisition.importBundles).not.toHaveBeenCalled();
    await view.body.get('[data-testid="cancel-authorization-protocol"]').trigger('click');
    expect(acquisition.importBundles).not.toHaveBeenCalled();
  });

  it('offers file import and online acquisition without automatically opening either', async () => {
    const acquisition = testAcquisition();
    const view = await dialog('acquire', testVault('unlocked'), acquisition);
    expect(view.body.find('[data-testid="authorization-method-choices"]').exists()).toBe(true);
    expect(view.body.find('[data-testid="choose-authorization-iop"]').exists()).toBe(false);
    expect(acquisition.openTool).not.toHaveBeenCalled();
    expect(acquisition.importBundle).not.toHaveBeenCalled();
    await view.body.get('[data-testid="authorization-method-online"]').trigger('click');
    expect(acquisition.openTool).not.toHaveBeenCalled();
    await view.body.get('[data-testid="choose-authorization-top"]').trigger('click');
    expect(view.select).toHaveBeenCalledExactlyOnceWith('top');
  });

  it.each(['top', 'iop', undefined] as const)(
    // Historical bundles without protocol must remain TOP; never infer from an AppKey.
    'imports %s locally only after explicit save',
    async (protocol) => {
      const acquisition = testAcquisition();
      const view = await dialog('acquire', testVault('unlocked'), acquisition);
      await view.body.get('[data-testid="authorization-method-file"]').trigger('click');
      const bundle = { ...fixture.oauthBundle, ...(protocol ? { protocol } : {}) };
      await selectFile(view.body, JSON.stringify(bundle));
      expect(view.body.get('[data-testid="authorization-file-preview"]').text()).toContain(
        (protocol ?? 'top').toUpperCase()
      );
      expect(view.body.text()).not.toContain(bundle.oauth.accessToken);
      expect(view.body.text()).not.toContain(bundle.application.appSecret);
      expect(acquisition.importBundle).not.toHaveBeenCalled();
      await view.body.get('[data-testid="confirm-authorization-file-import"]').trigger('click');
      await flushPromises();
      expect(acquisition.importBundle).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ oauth: bundle.oauth })
      );
      expect(acquisition.openTool).not.toHaveBeenCalled();
      expect(view.wrapper.emitted('imported')).toHaveLength(1);
      expect(view.wrapper.emitted('update:open')).toEqual([[false]]);
    }
  );

  it('keeps a failed import local and allows retry without opening online authorization', async () => {
    const acquisition = testAcquisition();
    acquisition.importBundle.mockRejectedValueOnce(new Error('private failure'));
    const view = await dialog('acquire', testVault('unlocked'), acquisition);
    await view.body.get('[data-testid="authorization-method-file"]').trigger('click');
    await selectFile(view.body, JSON.stringify(fixture.oauthBundle));
    await view.body.get('[data-testid="confirm-authorization-file-import"]').trigger('click');
    await flushPromises();
    expect(view.wrapper.emitted('update:open')).toBeUndefined();
    expect(view.body.find('[data-testid="authorization-file-preview"]').exists()).toBe(true);
    expect(view.body.text()).not.toContain('private failure');
    expect(acquisition.openTool).not.toHaveBeenCalled();
    await view.body.get('[data-testid="confirm-authorization-file-import"]').trigger('click');
    await flushPromises();
    expect(view.wrapper.emitted('imported')).toHaveLength(1);
  });

  it('honors unsaved-edit cancellation before importing', async () => {
    const acquisition = testAcquisition();
    const view = await dialog('acquire', testVault('unlocked'), acquisition);
    const beforeImport = vi.fn(() => Promise.resolve(false));
    await view.wrapper.setProps({ beforeImport });
    await view.body.get('[data-testid="authorization-method-file"]').trigger('click');
    await selectFile(view.body, JSON.stringify(fixture.oauthBundle));
    await view.body.get('[data-testid="confirm-authorization-file-import"]').trigger('click');
    await flushPromises();
    expect(beforeImport).toHaveBeenCalledOnce();
    expect(acquisition.importBundle).not.toHaveBeenCalled();
    expect(view.wrapper.emitted('update:open')).toBeUndefined();
  });

  it('keeps the choice neutral in English and dark mode', async () => {
    uiI18n.global.locale.value = 'en-US';
    document.documentElement.classList.add('dark');
    const acquisition = testAcquisition();
    const view = await dialog('acquire', testVault('unlocked'), acquisition);
    expect(view.body.text()).toContain('Import an existing authorization file');
    expect(view.body.text()).toContain('Get a new authorization online');
    expect(view.select).not.toHaveBeenCalled();
    expect(acquisition.openTool).not.toHaveBeenCalled();
    expect(acquisition.importBundle).not.toHaveBeenCalled();
  });

  it('blocks invalid/oversized files and cancels without saving', async () => {
    const acquisition = testAcquisition();
    const view = await dialog('acquire', testVault('unlocked'), acquisition);
    await view.body.get('[data-testid="authorization-method-file"]').trigger('click');
    for (const text of ['bad-json', '{}', ' '.repeat(256 * 1024 + 1)]) {
      await selectFile(view.body, text);
      expect(
        view.body.get('[data-testid="confirm-authorization-file-import"]').attributes('disabled')
      ).toBeDefined();
    }
    await selectFile(view.body, JSON.stringify(fixture.oauthBundle));
    await view.body.get('[data-testid="cancel-authorization-protocol"]').trigger('click');
    expect(acquisition.importBundle).not.toHaveBeenCalled();
    expect(view.wrapper.emitted('imported')).toBeUndefined();
  });
  it.each(['iop', 'top'] as const)('only starts %s on the direct choice click stack', async (protocol) => {
    const view = await dialog();
    expect(view.body.text()).toContain('连接新版应用（推荐）');
    expect(view.body.text()).toContain('连接已有旧版应用');
    expect(view.body.text()).toContain('不会互相覆盖');
    expect(view.select).not.toHaveBeenCalled();
    let clicking = false;
    view.select.mockImplementation(() => {
      expect(clicking).toBe(true);
    });
    clicking = true;
    (view.body.get(`[data-testid="choose-authorization-${protocol}"]`).element as HTMLButtonElement).click();
    clicking = false;
    expect(view.select.mock.calls).toEqual([[protocol]]);
    expect(view.wrapper.emitted('update:open')).toEqual([[false]]);
  });

  it.each(['cancel', 'close', 'overlay', 'escape'] as const)(
    'dismisses with %s without selecting a protocol',
    async (action) => {
      const view = await dialog();
      if (action === 'cancel')
        await view.body.get('[data-testid="cancel-authorization-protocol"]').trigger('click');
      if (action === 'close') await view.body.get('[aria-label="关闭连接 Alibaba 账号"]').trigger('click');
      if (action === 'overlay') await view.body.get('.ov-dialog-overlay').trigger('click');
      if (action === 'escape') await view.body.get('[role="dialog"]').trigger('keydown', { key: 'Escape' });
      await flushPromises();
      expect(view.wrapper.emitted('update:open')).toContainEqual([false]);
      expect(view.select).not.toHaveBeenCalled();
    }
  );

  it('supports the renewal purpose, English, and dark mode without an automatic selection', async () => {
    uiI18n.global.locale.value = 'en-US';
    document.documentElement.classList.add('dark');
    const view = await dialog('renew');
    expect(view.body.get('[role="dialog"]').text()).toContain('Which authorization do you want to renew?');
    expect(view.body.text()).toContain('Connect a new app (recommended)');
    expect(view.body.text()).toContain('Connect an existing legacy app');
    expect(view.body.text()).toContain('never replace each other');
    expect(view.select).not.toHaveBeenCalled();
  });

  it.each(['', 'test-passphrase'])(
    'prepares optional protection %j before a separate synchronous protocol click',
    async (passphrase) => {
      const vault = testVault();
      const view = await dialog('acquire', vault);
      expect(view.body.find('[data-testid="choose-authorization-iop"]').exists()).toBe(false);
      expect(view.body.text()).toContain('可选');
      expect(view.body.text()).toContain('选择导入文件或在线获取');
      expect(view.body.text()).toContain('浏览器配置');
      expect(vault.prepareAuthorization).not.toHaveBeenCalled();
      await view.body.get('input').setValue(passphrase);
      await view.body.get('form').trigger('submit');
      await flushPromises();
      expect(vault.prepareAuthorization).toHaveBeenCalledExactlyOnceWith(passphrase);
      expect(view.select).not.toHaveBeenCalled();
      let clicking = false;
      view.select.mockImplementation(() => {
        expect(clicking).toBe(true);
      });
      clicking = true;
      (view.body.get('[data-testid="choose-authorization-iop"]').element as HTMLButtonElement).click();
      clicking = false;
      expect(view.select).toHaveBeenCalledExactlyOnceWith('iop');
    }
  );

  it('reuses unlocked protection without asking again or preparing another key', async () => {
    const vault = testVault('unlocked');
    const view = await dialog('renew', vault);
    expect(view.body.find('form').exists()).toBe(false);
    expect(view.body.find('[data-testid="choose-authorization-top"]').exists()).toBe(true);
    expect(vault.prepareAuthorization).not.toHaveBeenCalled();
    expect(vault.unlock).not.toHaveBeenCalled();
  });

  it('requires the original locked passphrase, never creating or replacing protection', async () => {
    const vault = testVault('locked');
    const view = await dialog('acquire', vault);
    expect(view.body.get('input').attributes('required')).toBeDefined();
    expect(view.body.get('[type="submit"]').attributes('disabled')).toBeDefined();
    await view.body.get('form').trigger('submit');
    expect(vault.unlock).not.toHaveBeenCalled();
    await view.body.get('input').setValue('original');
    await view.body.get('form').trigger('submit');
    await flushPromises();
    expect(vault.unlock).toHaveBeenCalledExactlyOnceWith('original');
    expect(vault.prepareAuthorization).not.toHaveBeenCalled();
    expect(vault.create).not.toHaveBeenCalled();
  });

  it('unlocks device protection only after an explicit Continue click with no password input', async () => {
    const vault = testVault('locked', true);
    const view = await dialog('acquire', vault);
    expect(view.body.find('input').exists()).toBe(false);
    expect(vault.unlock).not.toHaveBeenCalled();
    await view.body.get('form').trigger('submit');
    await flushPromises();
    expect(vault.unlock).toHaveBeenCalledExactlyOnceWith('');
    expect(vault.prepareAuthorization).not.toHaveBeenCalled();
  });

  it('keeps failures generic and blocks protocol selection for short or rejected passphrases', async () => {
    const vault = testVault();
    const view = await dialog('acquire', vault);
    await view.body.get('input').setValue('short');
    await view.body.get('form').trigger('submit');
    await flushPromises();
    expect(vault.prepareAuthorization).not.toHaveBeenCalled();
    vault.prepareAuthorization.mockRejectedValueOnce(new Error('private backend detail'));
    await view.body.get('input').setValue('long-enough');
    await view.body.get('form').trigger('submit');
    await flushPromises();
    expect(view.body.find('[data-testid="choose-authorization-top"]').exists()).toBe(false);
    expect(view.body.text()).not.toContain('private backend detail');
    expect(toast.error).not.toHaveBeenCalledWith('private backend detail');
  });

  it('clears a cancelled passphrase and ignores a prepare response arriving after close', async () => {
    const vault = testVault();
    const view = await dialog('acquire', vault);
    await view.body.get('input').setValue('cancel-me');
    await view.body.get('[data-testid="cancel-authorization-protocol"]').trigger('click');
    await view.wrapper.setProps({ open: false });
    await view.wrapper.setProps({ open: true });
    await flushPromises();
    expect((view.body.get('input').element as HTMLInputElement).value).toBe('');
    let finish: ((status: CredentialVaultStatus) => void) | undefined;
    vault.prepareAuthorization.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await view.body.get('form').trigger('submit');
    await view.wrapper.setProps({ open: false });
    finish?.(testStatus('unlocked'));
    await flushPromises();
    expect(view.wrapper.emitted('prepared')).toBeUndefined();
    expect(view.select).not.toHaveBeenCalled();
  });
});

async function selectFile(body: DOMWrapper<Element>, text: string): Promise<void> {
  const file = new File([text], 'credentialInfo.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
  const input = body.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
  await input.trigger('change');
  await flushPromises();
}

function testAcquisition() {
  return {
    start: vi.fn(),
    continue: vi.fn(),
    status: vi.fn(),
    cancel: vi.fn(),
    saveToVault: vi.fn(),
    exportBundle: vi.fn(),
    readPrerequisite: vi.fn(),
    locatePrerequisiteField: vi.fn(),
    focusPrerequisitePage: vi.fn(),
    openTool: vi.fn(),
    importBundle: vi.fn(() => Promise.resolve(testStatus('unlocked')))
  } satisfies ExtensionAlibabaCredentialAcquisitionRepository;
}

function testStatus(state: CredentialVaultStatus['state'], deviceProtected = false): CredentialVaultStatus {
  return {
    state,
    deviceProtected,
    hasAppKey: false,
    hasAppSecret: false,
    hasAccessToken: false,
    appKey: '',
    endpoint: ALIBABA_GATEWAY,
    signMethod: 'hmac',
    idleTimeoutMinutes: null,
    lastActivityAt: null,
    idleRemainingSeconds: null,
    lockReason: state === 'locked' ? 'manual' : null
  };
}

function testVault(state: CredentialVaultStatus['state'] = 'empty', deviceProtected = false) {
  return {
    status: vi.fn(() => Promise.resolve(testStatus(state, deviceProtected))),
    prepareAuthorization: vi.fn((_passphrase: string) =>
      Promise.resolve(testStatus('unlocked', deviceProtected))
    ),
    unlock: vi.fn((_passphrase: string) => Promise.resolve(testStatus('unlocked', deviceProtected))),
    create: vi.fn(),
    migrate: vi.fn(),
    lock: vi.fn(),
    rotate: vi.fn(),
    updatePolicy: vi.fn()
  } satisfies CredentialVaultRepository;
}
