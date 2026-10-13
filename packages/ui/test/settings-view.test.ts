// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'vue-sonner';

import {
  ALIBABA_GATEWAY,
  APP_PREFERENCES_STORAGE_KEY,
  type CredentialVaultLockReason,
  type CredentialVaultState,
  type CredentialVaultStatus,
  type GatewaySettings,
  type ExtensionAlibabaCredentialAcquisitionRepository
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { IOP_BUSINESS_ENDPOINT } from '@one-vegetable/core/alibaba-iop';
import credentialFixtures from '../../../mock/data/node-gateway-credentials.json';

import SettingsView from '../src/views/SettingsView.vue';
import LocalDiagnosticsPanel from '../src/components/LocalDiagnosticsPanel.vue';
import { provideServices } from '../src/lib/services';
import { provideUnsavedEditing, UnsavedEditingService } from '../src/lib/unsaved-editing';

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}));

const anchorClick = vi.fn();
const createObjectUrl = vi.fn(() => 'blob:diagnostics');
const revokeObjectUrl = vi.fn();
const clearAllLocalData = vi.fn(() => Promise.resolve());
const unlockVault = vi.fn((_passphrase: string) => Promise.resolve(vaultStatus('unlocked')));
const migrateVault = vi.fn((_passphrase: string) => Promise.resolve(vaultStatus('unlocked')));
const createVault = vi.fn((_passphrase: string, _settings: GatewaySettings) =>
  Promise.resolve(vaultStatus('unlocked'))
);
const updateVaultPolicy = vi.fn((idleTimeoutMinutes: number) =>
  Promise.resolve(vaultStatus('unlocked', idleTimeoutMinutes))
);

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.theme;
});

function mountView(
  mode: 'mock' | 'extension' | 'bff' = 'mock',
  initialVaultState?: CredentialVaultState,
  initialLockReason: CredentialVaultLockReason = 'manual',
  backendRuntime: 'node' | 'cloudflare' = 'node',
  options: {
    editing?: UnsavedEditingService;
    beforeInspect?: () => Promise<void>;
    logs?: boolean;
    initialSettings?: Partial<GatewaySettings>;
    save?: (settings: GatewaySettings) => Promise<void>;
    acquisition?: ExtensionAlibabaCredentialAcquisitionRepository;
  } = {}
) {
  let grantedHosts = ['https://images.example.com/*'];
  let currentVaultState = initialVaultState;
  const Host = defineComponent({
    setup() {
      if (options.editing) provideUnsavedEditing(options.editing);
      provideServices({
        gateway: new MockGatewayClient(0),
        settings: {
          load: () =>
            Promise.resolve({
              appKey: currentVaultState === 'unlocked' ? 'configured-key' : '',
              appSecret: '',
              accessToken: '',
              endpoint: ALIBABA_GATEWAY,
              signMethod: 'hmac' as const,
              ...options.initialSettings
            }),
          save: options.save ?? (() => Promise.resolve())
        },
        permissions: {
          list: () => Promise.resolve(grantedHosts),
          revoke: (origin) => {
            const hadPermission = grantedHosts.includes(origin);
            grantedHosts = grantedHosts.filter((item) => item !== origin);
            return Promise.resolve(hadPermission);
          }
        },
        localData: {
          inspect: async () => {
            await options.beforeInspect?.();
            return {
              generatedAt: '2026-08-13T08:00:00.000Z',
              totalApproximateBytes: 512,
              categories: [
                {
                  id: 'credentials',
                  label: '加密开放平台凭证与网关设置',
                  storage: 'chrome.storage.local',
                  itemCount: 1,
                  approximateBytes: 512,
                  sensitive: true,
                  retention: '保留到用户清除'
                }
              ]
            };
          },
          clearAll: clearAllLocalData
        },
        ...(initialVaultState
          ? {
              vault: {
                status: () =>
                  Promise.resolve(vaultStatus(currentVaultState ?? 'empty', 0, initialLockReason)),
                create: createVault,
                migrate: migrateVault,
                unlock: async (passphrase) => {
                  currentVaultState = 'unlocked';
                  return unlockVault(passphrase);
                },
                lock: () => {
                  currentVaultState = 'locked';
                  return Promise.resolve(vaultStatus('locked'));
                },
                rotate: () => Promise.resolve(vaultStatus('unlocked')),
                updatePolicy: updateVaultPolicy
              }
            }
          : {}),
        runtime: {
          metaStatus: 'ready',
          backendMeta: {
            runtime: backendRuntime,
            database: backendRuntime === 'node' ? 'sqlite' : 'd1',
            environment: backendRuntime === 'node' ? 'local-node' : 'self-hosted',
            gatewayMode: 'real',
            apiPrefix: '/api/v1',
            version: '2.6.0'
          }
        },
        mode,
        ...(options.acquisition ? { alibabaCredentialAcquisition: options.acquisition } : {})
      });
      return () => h(options.logs ? LocalDiagnosticsPanel : SettingsView);
    }
  });
  return mount(Host, { attachTo: globalThis.document.body });
}

async function confirmSettingsAction(title: string): Promise<void> {
  await vi.waitFor(() => {
    expect(document.body.textContent).toContain(title);
  });
  const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent.trim() === '确认继续'
  );
  if (!confirm) throw new Error(`Missing settings confirmation: ${title}`);
  confirm.click();
  await flushPromises();
}

afterEach(() => {
  vi.restoreAllMocks();
  anchorClick.mockClear();
  createObjectUrl.mockClear();
  revokeObjectUrl.mockClear();
  clearAllLocalData.mockClear();
  unlockVault.mockClear();
  migrateVault.mockClear();
  createVault.mockClear();
  updateVaultPolicy.mockClear();
});

describe('SettingsView diagnostics', () => {
  it('makes independent IOP acquisition primary and disables the labelled TOP acquisition', async () => {
    const openIopTool = vi.fn().mockResolvedValue(undefined);
    const acquisition = {
      openIopTool,
      start: vi.fn(),
      continue: vi.fn(),
      status: vi.fn(),
      cancel: vi.fn(),
      saveToVault: vi.fn(),
      exportBundle: vi.fn(),
      readPrerequisite: vi.fn(),
      locatePrerequisiteField: vi.fn(),
      focusPrerequisitePage: vi.fn()
    };
    const wrapper = mountView('extension', 'empty', 'manual', 'node', { acquisition });
    await flushPromises();
    const top = wrapper.findAll('button').find((button) => button.text() === '获取 TOP 开放平台凭证');
    expect(top?.attributes('disabled')).toBeUndefined();
    await wrapper.get('select[aria-label="网关协议"]').setValue('iop');
    expect(top?.attributes('disabled')).toBeDefined();
    const iop = wrapper.findAll('button').find((button) => button.text() === '打开独立 IOP 授权工具');
    expect(iop?.classes()).toContain('bg-primary');
    await iop?.trigger('click');
    expect(openIopTool).toHaveBeenCalledOnce();
    expect(acquisition.start).not.toHaveBeenCalled();
    expect(createVault).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('shows legacy TOP without changing or saving existing endpoint/signing', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountView('extension', 'unlocked', 'manual', 'node', {
      initialSettings: { endpoint: 'https://gateway.example.test/router', signMethod: 'md5' },
      save
    });
    await flushPromises();
    expect((wrapper.get('select[aria-label="网关协议"]').element as HTMLSelectElement).value).toBe('top');
    expect((wrapper.get('input[aria-label="HTTPS 网关"]').element as HTMLInputElement).value).toBe(
      'https://gateway.example.test/router'
    );
    expect(save).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('preserves saved IOP and only switches protocol after explicit selection/save', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountView('extension', 'unlocked', 'manual', 'node', {
      initialSettings: { protocol: 'iop', endpoint: IOP_BUSINESS_ENDPOINT, signMethod: 'hmac-sha256' },
      save
    });
    await flushPromises();
    const selector = wrapper.get('select[aria-label="网关协议"]');
    expect((selector.element as HTMLSelectElement).value).toBe('iop');
    expect(wrapper.get('[data-testid="iop-protocol-notice"]').text()).toContain(
      '已验收的 Schema 发布、存草稿、更新'
    );
    expect(wrapper.text()).not.toContain('不支持订单、RFQ 或写操作');
    expect(wrapper.get('input[aria-label="HTTPS 网关"]').attributes('readonly')).toBeDefined();
    expect(save).not.toHaveBeenCalled();
    await selector.setValue('top');
    expect(save).not.toHaveBeenCalled();
    const saveButton = wrapper.findAll('button').find((candidate) => candidate.text().includes('保存设置'));
    await saveButton?.trigger('click');
    await flushPromises();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'top', endpoint: ALIBABA_GATEWAY, signMethod: 'hmac' })
    );
    wrapper.unmount();
  });
  it.each(['iop', 'top', undefined] as const)(
    'imports %s with the correct protocol/endpoint/signing, without auto-save',
    async (protocol) => {
      const wrapper = mountView('extension', 'empty', 'manual', 'node', {
        initialSettings: { protocol: 'iop', endpoint: IOP_BUSINESS_ENDPOINT, signMethod: 'hmac-sha256' }
      });
      await flushPromises();
      const input = wrapper.get('input[aria-label="导入授权包 JSON"]');
      const content = JSON.stringify({ ...credentialFixtures.oauthBundle, protocol });
      const file = new File([content], 'credentials.json', { type: 'application/json' });
      Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
      Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
      await input.trigger('change');
      await flushPromises();
      expect((wrapper.get('select[aria-label="网关协议"]').element as HTMLSelectElement).value).toBe(
        protocol ?? 'top'
      );
      expect(wrapper.text()).toContain('尚未保存');
      expect(createVault).not.toHaveBeenCalled();
      await wrapper.get('input[aria-label="设置保护口令"]').setValue('123456');
      await wrapper.get('input[aria-label="确认保护口令"]').setValue('123456');
      const saveButton = wrapper.findAll('button').find((candidate) => candidate.text().includes('保存设置'));
      await saveButton?.trigger('click');
      await flushPromises();
      expect(createVault).toHaveBeenCalledWith(
        '123456',
        expect.objectContaining({
          protocol: protocol ?? 'top',
          accessTokenCapturedTimeUtc: Date.parse(credentialFixtures.oauthBundle.capturedAtUtc),
          endpoint: protocol === 'iop' ? IOP_BUSINESS_ENDPOINT : ALIBABA_GATEWAY,
          signMethod: protocol === 'iop' ? 'hmac-sha256' : 'hmac'
        })
      );
      wrapper.unmount();
    }
  );
  it('retains existing TOP signing when importing a legacy TOP bundle', async () => {
    const wrapper = mountView('extension', 'empty', 'manual', 'node', {
      initialSettings: { endpoint: 'https://gateway.example.test/router', signMethod: 'md5' }
    });
    await flushPromises();
    const content = JSON.stringify(credentialFixtures.oauthBundle);
    const file = new File([content], 'credentials.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
    const input = wrapper.get('input[aria-label="导入授权包 JSON"]');
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
    await input.trigger('change');
    await flushPromises();
    expect((wrapper.get('input[aria-label="HTTPS 网关"]').element as HTMLInputElement).value).toBe(
      ALIBABA_GATEWAY
    );
    expect(
      wrapper.findAll('select').some((selector) => (selector.element as HTMLSelectElement).value === 'md5')
    ).toBe(true);
    expect(createVault).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('does not load diagnostic data or inventory from settings', async () => {
    let finishInspect: (() => void) | undefined;
    const editing = new UnsavedEditingService();
    const wrapper = mountView('extension', 'empty', 'manual', 'node', {
      editing,
      beforeInspect: () =>
        new Promise<void>((resolve) => {
          finishInspect = resolve;
        })
    });
    await flushPromises();
    await wrapper.get('input[aria-label="App Key"]').setValue('entered-during-metadata-load');
    expect(finishInspect).toBeUndefined();
    finishInspect?.();
    await flushPromises();
    expect((wrapper.get('input[aria-label="App Key"]').element as HTMLInputElement).value).toBe(
      'entered-during-metadata-load'
    );
    expect(editing.dirty.value).toBe(true);
    wrapper.unmount();
    editing.dispose();
  });
  it('switches sections without dropping unsaved values or changing Alibaba language', async () => {
    const editing = new UnsavedEditingService();
    const wrapper = mountView('mock', undefined, 'manual', 'node', { editing });
    await flushPromises();
    expect(wrapper.get('#settings-credentials').isVisible()).toBe(true);
    expect(wrapper.find('#settings-maintenance').exists()).toBe(false);
    expect(wrapper.find('button[aria-controls="settings-storage"]').exists()).toBe(false);
    await wrapper.get('input[aria-label="App Key"]').setValue('unsaved-key');
    const language = wrapper.get('select[aria-label="平台请求语言"]').element as HTMLSelectElement;
    const originalLanguage = language.value;
    await wrapper.get('button[aria-controls="settings-preferences"]').trigger('click');
    expect(wrapper.get('#settings-credentials').isVisible()).toBe(false);
    expect(wrapper.get('#settings-preferences').isVisible()).toBe(true);
    expect(wrapper.get('button[aria-controls="settings-preferences"]').attributes('aria-pressed')).toBe(
      'true'
    );
    expect(language.value).toBe(originalLanguage);
    await wrapper.get('button[aria-controls="settings-credentials"]').trigger('click');
    expect((wrapper.get('input[aria-label="App Key"]').element as HTMLInputElement).value).toBe(
      'unsaved-key'
    );
    expect(editing.dirty.value).toBe(true);
    expect(editing.confirmationOpen.value).toBe(false);
    wrapper.unmount();
    editing.dispose();
  });
  it('shows the Node credential panel instead of environment-variable-only instructions', async () => {
    const wrapper = mountView('bff');
    await flushPromises();
    // This is a lazy module: full-suite Windows transforms can exceed Vitest's
    // default 1s polling window even though the import and component succeed.
    await vi.waitFor(
      () => {
        expect(wrapper.find('[data-testid="gateway-credential-panel"]').exists()).toBe(true);
      },
      { timeout: 5_000 }
    );
    const guide = wrapper.get('[data-testid="gateway-credential-panel"]');
    expect(guide.text()).toContain('Alibaba 凭据配置');
    expect(guide.text()).not.toContain('ONE_VEGETABLE_ALIBABA_APP_KEY');
    expect(guide.find('input').exists()).toBe(false);
    expect(guide.find('a[href="#/admin"]').exists()).toBe(false);
    wrapper.unmount();
  });
  it('directs Cloudflare users to admin credential import', async () => {
    const wrapper = mountView('bff', undefined, 'manual', 'cloudflare');
    await flushPromises();
    const guide = wrapper.get('[data-testid="bff-credential-guide"]');
    expect(guide.get('a[href="#/admin"]').text()).toContain('配置');
    expect(guide.text()).not.toContain('artifacts/openapi-auth/credentials.json');
    wrapper.unmount();
  });
  it('shows no idle auto-lock as the default and explains the six-character minimum', async () => {
    const wrapper = mountView('extension', 'unlocked');
    await flushPromises();

    expect((wrapper.get('select[aria-label="空闲自动锁定时间"]').element as HTMLSelectElement).value).toBe(
      '0'
    );
    expect(wrapper.get('select[aria-label="空闲自动锁定时间"]').text()).toContain('不自动锁定（默认）');
    expect(wrapper.get('input[aria-label="新保护口令"]').attributes('placeholder')).toBe('至少 6 位');
    expect(wrapper.text()).not.toContain('UTF-8 字节');

    const policyButton = wrapper
      .findAll('button')
      .find((candidate) => candidate.text().includes('保存锁定策略'));
    if (!policyButton) throw new Error('Missing idle-lock policy button');
    await policyButton.trigger('click');
    await vi.waitFor(() => {
      expect(updateVaultPolicy).toHaveBeenCalledWith(0);
      expect(wrapper.text()).toContain('已关闭空闲自动锁定');
    });
    wrapper.unmount();
  });

  it('saves credentials and settings in one action when creating the extension vault', async () => {
    const wrapper = mountView('extension', 'empty');
    await flushPromises();

    await wrapper.get('input[aria-label="设置保护口令"]').setValue('123456');
    await wrapper.get('input[aria-label="确认保护口令"]').setValue('123456');
    const createButton = wrapper.findAll('button').find((candidate) => candidate.text().includes('保存设置'));
    if (!createButton) throw new Error('Missing settings save button');
    await createButton.trigger('click');
    await flushPromises();

    expect(createVault).toHaveBeenCalledWith(
      '123456',
      expect.objectContaining({ endpoint: ALIBABA_GATEWAY, signMethod: 'hmac' })
    );
    expect(wrapper.text()).toContain('凭证与设置已加密保存');
    expect(toast.success).toHaveBeenCalledWith('凭证与设置已保存');
    expect(wrapper.text()).not.toContain('加密保存凭证');
    wrapper.unmount();
  });

  it('marks saved edits clean without loading inventory or clearing later edits', async () => {
    const editing = new UnsavedEditingService();
    let finishInspect: (() => void) | undefined;
    let inspections = 0;
    const wrapper = mountView('extension', 'empty', 'manual', 'node', {
      editing,
      beforeInspect: () => {
        inspections += 1;
        if (inspections === 1) return Promise.resolve();
        return new Promise<void>((resolve) => {
          finishInspect = resolve;
        });
      }
    });
    await flushPromises();
    await wrapper.get('input[aria-label="App Key"]').setValue('new-key');
    await wrapper.get('input[aria-label="设置保护口令"]').setValue('123456');
    await wrapper.get('input[aria-label="确认保护口令"]').setValue('123456');
    expect(editing.dirty.value).toBe(true);
    const save = wrapper.findAll('button').find((button) => button.text().includes('保存设置'));
    if (!save) throw new Error('Missing settings save button');
    await save.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('凭证与设置已加密保存');
    expect(finishInspect).toBeUndefined();
    expect(inspections).toBe(0);
    expect(editing.dirty.value).toBe(false);
    expect(await editing.confirmLeave()).toBe(true);
    expect(editing.confirmationOpen.value).toBe(false);
    await wrapper.get('input[aria-label="App Key"]').setValue('another-key');
    expect(editing.dirty.value).toBe(true);
    finishInspect?.();
    await flushPromises();
    expect(editing.dirty.value).toBe(true);
    wrapper.unmount();
    editing.dispose();
  });

  it('shows a busy state while the combined settings save is running', async () => {
    let finishCreate: ((status: CredentialVaultStatus) => void) | undefined;
    createVault.mockImplementationOnce(
      (_passphrase, _settings) =>
        new Promise((resolve) => {
          finishCreate = resolve;
        })
    );
    const wrapper = mountView('extension', 'empty');
    await flushPromises();

    await wrapper.get('input[aria-label="设置保护口令"]').setValue('123456');
    await wrapper.get('input[aria-label="确认保护口令"]').setValue('123456');
    const saveButton = wrapper.findAll('button').find((candidate) => candidate.text().includes('保存设置'));
    if (!saveButton) throw new Error('Missing settings save button');
    await saveButton.trigger('click');

    expect(saveButton.text()).toContain('保存中');
    expect(saveButton.attributes('disabled')).toBeDefined();
    if (!finishCreate) throw new Error('Vault creation did not start');
    finishCreate(vaultStatus('unlocked'));
    await flushPromises();

    expect(saveButton.text()).toContain('保存设置');
    expect(toast.success).toHaveBeenCalledWith('凭证与设置已保存');
    wrapper.unmount();
  });

  it('imports the local authorization bundle without saving it automatically', async () => {
    const wrapper = mountView('extension', 'empty');
    await flushPromises();
    const input = wrapper.get('input[aria-label="导入授权包 JSON"]');
    const file = new File(
      [
        JSON.stringify({
          application: { appKey: 'imported-key', appSecret: 'imported-secret' },
          oauth: { accessToken: 'imported-token' }
        })
      ],
      'credentials.json',
      { type: 'application/json' }
    );
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: () =>
        Promise.resolve(
          JSON.stringify({
            application: { appKey: 'imported-key', appSecret: 'imported-secret' },
            oauth: { accessToken: 'imported-token' }
          })
        )
    });
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
    await input.trigger('change');
    await flushPromises();

    expect(wrapper.text()).toContain('尚未保存');
    expect((wrapper.get('input[aria-label="App Key"]').element as HTMLInputElement).value).toBe(
      'imported-key'
    );
    expect(wrapper.get('input[aria-label="App Key"]').attributes('data-feedback-redact')).toBe('');
    expect((wrapper.get('input[aria-label="App Secret"]').element as HTMLInputElement).value).toBe(
      'imported-secret'
    );
    expect(wrapper.get('input[aria-label="App Secret"]').attributes('type')).toBe('password');
    expect((wrapper.get('input[aria-label="Access Token"]').element as HTMLInputElement).value).toBe(
      'imported-token'
    );
    expect(wrapper.get('input[aria-label="Access Token"]').attributes('type')).toBe('password');
    expect(wrapper.text()).toContain('尚未保存');
    expect(createVault).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each(['mock', 'extension'] as const)(
    'restoring an edited key leaves old %s settings without a token-capture field clean',
    async (mode) => {
      const editing = new UnsavedEditingService();
      const wrapper = mountView(mode, mode === 'extension' ? 'unlocked' : undefined, 'manual', 'node', {
        editing,
        initialSettings: {
          appKey: credentialFixtures.manual.appKey,
          accessTokenExpiresTimeUtc: null,
          systemApiPermission: 'unknown',
          permissionCapturedTimeUtc: null
        }
      });
      await flushPromises();
      expect(editing.dirty.value).toBe(false);
      const key = wrapper.get('input[aria-label="App Key"]');
      await key.setValue('edited-key');
      expect(editing.dirty.value).toBe(true);
      await key.setValue(credentialFixtures.manual.appKey);
      expect(editing.dirty.value).toBe(false);
      expect(await editing.confirmLeave()).toBe(true);
      expect(editing.confirmationOpen.value).toBe(false);
      wrapper.unmount();
      editing.dispose();
    }
  );

  it('retains imported expiry when saving but clears stale expiry after a manual credential change', async () => {
    const wrapper = mountView('extension', 'empty');
    await flushPromises();
    const input = wrapper.get('input[aria-label="导入授权包 JSON"]');
    const content = JSON.stringify({
      ...credentialFixtures.oauthBundle,
      oauth: { ...credentialFixtures.oauthBundle.oauth, expiresAtUtc: credentialFixtures.knownExpiry }
    });
    const file = new File([content], 'credentials.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
    await input.trigger('change');
    await flushPromises();
    expect(wrapper.text()).toContain('2030-01-02');
    await wrapper.get('input[aria-label="Access Token"]').setValue('replacement-token');
    expect(wrapper.text()).toContain('未知，不代表永久有效');
    expect(wrapper.text()).not.toContain('2030-01-02');
    await input.trigger('change');
    await flushPromises();
    await wrapper.get('input[aria-label="设置保护口令"]').setValue('123456');
    await wrapper.get('input[aria-label="确认保护口令"]').setValue('123456');
    const save = wrapper.findAll('button').find((button) => button.text().includes('保存设置'));
    if (!save) throw new Error('Missing save button');
    await save.trigger('click');
    await flushPromises();
    expect(createVault).toHaveBeenCalledWith(
      '123456',
      expect.objectContaining({
        accessTokenExpiresTimeUtc: Date.parse(credentialFixtures.knownExpiry)
      })
    );
    wrapper.unmount();
  });

  it('persists the preferred Alibaba request language outside the credential vault', async () => {
    const wrapper = mountView('extension', 'locked');
    await flushPromises();

    const language = wrapper.get('select[aria-label="平台请求语言"]');
    expect((language.element as HTMLSelectElement).value).toBe('en_US');
    await language.setValue('zh_CN');

    expect(JSON.parse(localStorage.getItem(APP_PREFERENCES_STORAGE_KEY) ?? '{}')).toEqual({
      uiLocale: 'zh-CN',
      alibabaLanguage: 'zh_CN',
      theme: 'system'
    });
    expect(wrapper.text()).toContain('Alibaba 接口语言已保存为 zh_CN');
    wrapper.unmount();
  });

  it('keeps interface theme controls out of connection settings', async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.find('select[aria-label="主题偏好"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('界面主题');
    wrapper.unmount();
  });

  it('exports a redacted snapshot and clears the session log', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(anchorClick);
    const wrapper = mountView('mock', undefined, 'manual', 'node', { logs: true });

    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('1 条');
    });

    const exportButton = wrapper.findAll('button').find((candidate) => candidate.text().includes('导出诊断'));
    if (!exportButton) throw new Error('Missing diagnostics export button');
    await exportButton.trigger('click');
    await flushPromises();

    await vi.waitFor(() => {
      expect(createObjectUrl).toHaveBeenCalledOnce();
      expect(anchorClick).toHaveBeenCalledOnce();
      expect(revokeObjectUrl).toHaveBeenCalledWith('blob:diagnostics');
      expect(wrapper.text()).toContain('已导出 1 条脱敏诊断。');
    });

    const clearButton = wrapper.findAll('button').find((candidate) => candidate.text().includes('清空诊断'));
    if (!clearButton) throw new Error('Missing diagnostics clear button');
    await clearButton.trigger('click');
    await flushPromises();
    await confirmSettingsAction('确认清空诊断');

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('0 条');
      expect(wrapper.text()).toContain('诊断记录已清空。');
    });
    wrapper.unmount();
  });

  it('lists and revokes optional host permissions in extension mode', async () => {
    const wrapper = mountView('extension', undefined, 'manual', 'node', { logs: true });
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('https://images.example.com/*');
    });

    const revokeButton = wrapper.get('button[aria-label="撤销 https://images.example.com/*"]');
    await revokeButton.trigger('click');
    await confirmSettingsAction('确认撤销主机权限');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('当前没有额外主机权限。');
      expect(wrapper.text()).toContain('再次使用时会重新请求授权。');
    });
    wrapper.unmount();
  });

  it('requires an exact phrase before clearing all extension data', async () => {
    const wrapper = mountView('extension', undefined, 'manual', 'node', { logs: true });
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('本地数据与隐私');
      expect(wrapper.text()).toContain('加密开放平台凭证与网关设置');
    });

    const clearButton = wrapper.findAll('button').find((candidate) => candidate.text().includes('彻底清除'));
    if (!clearButton) throw new Error('Missing clear-all button');
    expect(clearButton.attributes('disabled')).toBeDefined();
    await wrapper.get('input[aria-label="清除确认短语"]').setValue('不正确');
    expect(clearButton.attributes('disabled')).toBeDefined();
    await wrapper.get('input[aria-label="清除确认短语"]').setValue('清除全部数据');
    expect(clearButton.attributes('disabled')).toBeUndefined();
    await clearButton.trigger('click');
    await flushPromises();

    await vi.waitFor(() => {
      expect(clearAllLocalData).toHaveBeenCalledOnce();
      expect(toast.success).toHaveBeenCalledWith('本地数据及额外权限已清除；重载后显示首次使用说明。');
    });
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('本地数据及额外权限已清除');
    });
    wrapper.unmount();
  });

  it('hides editable credentials while locked and reveals only safe fields after unlock', async () => {
    const wrapper = mountView('extension', 'locked');
    await vi.waitFor(() => {
      expect(wrapper.find('input[aria-label="保护口令"]').exists()).toBe(true);
    });
    expect(wrapper.text()).not.toContain('国际站开放平台凭证');

    await wrapper.get('input[aria-label="保护口令"]').setValue('correct-vault-password');
    await wrapper.get('#settings-credentials button').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('凭证已解锁');
    });
    expect((wrapper.get('input[aria-label="App Key"]').element as HTMLInputElement).value).toBe(
      'configured-key'
    );
    expect(unlockVault).toHaveBeenCalledWith('correct-vault-password');
    expect(wrapper.get('input[aria-label="App Secret"]').attributes('placeholder')).toContain('留空保持不变');

    await wrapper.get('select[aria-label="空闲自动锁定时间"]').setValue('30');
    const policyButton = wrapper
      .findAll('button')
      .find((candidate) => candidate.text().includes('保存锁定策略'));
    if (!policyButton) throw new Error('Missing idle-lock policy button');
    await policyButton.trigger('click');
    await vi.waitFor(() => {
      expect(updateVaultPolicy).toHaveBeenCalledWith(30);
      expect(wrapper.text()).toContain('连续 30 分钟未使用后自动锁定');
    });
    wrapper.unmount();
  });

  it('explains that ending the Chrome session cleared only the in-memory unlock material', async () => {
    const wrapper = mountView('extension', 'locked', 'session-ended');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Chrome 会话已结束，需要重新解锁');
    });
    expect(wrapper.text()).toContain('会清除内存解锁材料');
    expect(wrapper.text()).toContain('加密凭据仍保留');
    wrapper.unmount();
  });

  it('requires matching passphrases before migrating legacy plaintext credentials', async () => {
    const wrapper = mountView('extension', 'legacy');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('发现旧版明文凭证');
    });
    await wrapper.get('input[aria-label="设置保护口令"]').setValue('migrated-vault-password');
    await wrapper.get('input[aria-label="确认保护口令"]').setValue('different-vault-password');
    await wrapper.get('#settings-credentials button').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('两次输入的本机保护口令不一致');
    });
    expect(migrateVault).not.toHaveBeenCalled();

    await wrapper.get('input[aria-label="确认保护口令"]').setValue('migrated-vault-password');
    await wrapper.get('#settings-credentials button').trigger('click');
    await vi.waitFor(() => {
      expect(migrateVault).toHaveBeenCalledWith('migrated-vault-password');
      expect(wrapper.text()).toContain('旧凭证已原位加密，会话内可用');
    });
    wrapper.unmount();
  });
});

function vaultStatus(
  state: CredentialVaultState,
  idleTimeoutMinutes = 0,
  lockReason: CredentialVaultLockReason = 'manual'
): CredentialVaultStatus {
  return {
    state,
    hasAppKey: state === 'unlocked' || state === 'legacy',
    hasAppSecret: state === 'unlocked' || state === 'legacy',
    hasAccessToken: state === 'unlocked' || state === 'legacy',
    appKey: state === 'unlocked' || state === 'legacy' ? 'configured-key' : '',
    endpoint: ALIBABA_GATEWAY,
    signMethod: 'hmac',
    idleTimeoutMinutes: state === 'unlocked' ? idleTimeoutMinutes : null,
    lastActivityAt: state === 'unlocked' ? '2026-08-13T08:00:00.000Z' : null,
    idleRemainingSeconds: state === 'unlocked' && idleTimeoutMinutes > 0 ? idleTimeoutMinutes * 60 : null,
    lockReason: state === 'locked' ? lockReason : null
  };
}
