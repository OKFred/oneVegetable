// @vitest-environment jsdom

import { defineComponent, h, type ComponentPublicInstance } from 'vue';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'vue-sonner';

import {
  ALIBABA_GATEWAY,
  APP_PREFERENCES_STORAGE_KEY,
  type CredentialVaultLockReason,
  type CredentialVaultState,
  type CredentialVaultStatus,
  type GatewaySettings,
  type SettingsRepository,
  type AlibabaAuthorizationsSummary,
  type ControlGatewayCredentialSummary,
  type ExtensionAlibabaCredentialAcquisitionRepository
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { IOP_BUSINESS_ENDPOINT } from '@one-vegetable/core/alibaba-iop';
import { GatewayException } from '@one-vegetable/core/errors';
import type { AlibabaOpenApiCredentialBundle } from '@one-vegetable/core/credential-bundle';
import credentialFixtures from '../../../mock/data/node-gateway-credentials.json';
import dashboardFixture from '../../../mock/data/dashboard-authorization.json';

import SettingsView from '../src/views/SettingsView.vue';
import { uiI18n } from '../src/i18n';
import LocalDiagnosticsPanel from '../src/components/LocalDiagnosticsPanel.vue';
import { provideServices } from '../src/lib/services';
import {
  installEditingNavigationGuard,
  provideUnsavedEditing,
  UnsavedEditingService
} from '../src/lib/unsaved-editing';
import { notifyCredentialVaultChanged } from '../src/lib/credential-vault-events';

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}));

const anchorClick = vi.fn();
const createObjectUrl = vi.fn((_blob: Blob) => 'blob:diagnostics');
const revokeObjectUrl = vi.fn();
const clearAllLocalData = vi.fn(() => Promise.resolve());
const unlockVault = vi.fn((_passphrase: string) => Promise.resolve(vaultStatus('unlocked')));
const migrateVault = vi.fn((_passphrase: string) => Promise.resolve(vaultStatus('unlocked')));
const createVault = vi.fn((_passphrase: string, _settings: GatewaySettings) =>
  Promise.resolve(vaultStatus('unlocked'))
);
const updateVaultPolicy = vi.fn(() => Promise.resolve(vaultStatus('unlocked')));
const rotateVault = vi.fn((_passphrase: string) => Promise.resolve(vaultStatus('unlocked')));
const manualLockVault = vi.fn(() => Promise.resolve({ ...vaultStatus('locked'), gatewayAvailable: true }));
const mountedViews: VueWrapper[] = [];

beforeEach(() => {
  uiI18n.global.locale.value = 'zh-CN';
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
    initialVaultStatus?: CredentialVaultStatus;
    save?: (settings: GatewaySettings) => Promise<void>;
    acquisition?: ExtensionAlibabaCredentialAcquisitionRepository;
    status?: () => Promise<CredentialVaultStatus>;
    loadSettings?: () => Promise<GatewaySettings>;
    settings?: Partial<SettingsRepository>;
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
          load:
            options.loadSettings ??
            (() =>
              Promise.resolve({
                appKey: currentVaultState === 'unlocked' ? 'configured-key' : '',
                appSecret: '',
                accessToken: '',
                endpoint: ALIBABA_GATEWAY,
                signMethod: 'hmac' as const,
                ...options.initialSettings
              })),
          save: options.save ?? (() => Promise.resolve()),
          ...options.settings
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
                status:
                  options.status ??
                  (() =>
                    Promise.resolve(
                      options.initialVaultStatus ??
                        vaultStatus(currentVaultState ?? 'empty', 0, initialLockReason)
                    )),
                create: createVault,
                migrate: migrateVault,
                unlock: async (passphrase) => {
                  currentVaultState = 'unlocked';
                  return unlockVault(passphrase);
                },
                lock: () => {
                  currentVaultState = 'locked';
                  return manualLockVault();
                },
                rotate: rotateVault,
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
  const wrapper = mount(Host, { attachTo: globalThis.document.body });
  mountedViews.push(wrapper);
  return wrapper;
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

async function openSettingsAuthorization(wrapper: ReturnType<typeof mountView>): Promise<void> {
  await wrapper.get('[data-testid="open-authorization-guide"]').trigger('click');
  await flushPromises();
  document.body.querySelector<HTMLButtonElement>('[data-testid="authorization-wizard-continue"]')?.click();
  await flushPromises();
}

async function openPassphraseDialog(wrapper: ReturnType<typeof mountView>): Promise<DOMWrapper<HTMLElement>> {
  await wrapper.get('[data-testid="open-vault-passphrase"]').trigger('click');
  await flushPromises();
  const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) throw new Error('Missing passphrase dialog');
  return new DOMWrapper(dialog);
}

afterEach(async () => {
  for (const wrapper of mountedViews.splice(0)) {
    if (wrapper.exists()) wrapper.unmount();
  }
  await flushPromises();
  document.body.replaceChildren();
  uiI18n.global.locale.value = 'zh-CN';
  vi.restoreAllMocks();
  anchorClick.mockClear();
  createObjectUrl.mockClear();
  revokeObjectUrl.mockClear();
  clearAllLocalData.mockClear();
  unlockVault.mockClear();
  migrateVault.mockClear();
  createVault.mockClear();
  updateVaultPolicy.mockClear();
  rotateVault.mockClear();
  manualLockVault.mockClear();
});

describe('SettingsView diagnostics', () => {
  it('shows authorization skeletons while local settings are pending, without showing setup as ready', async () => {
    let resolve!: (settings: GatewaySettings) => void;
    const pending = new Promise<GatewaySettings>((done) => {
      resolve = done;
    });
    const wrapper = mountView('extension', 'unlocked', 'manual', 'node', { loadSettings: () => pending });
    await flushPromises();
    expect(wrapper.find('[data-skeleton-layout="authorization"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="open-authorization-guide"]').exists()).toBe(false);
    resolve({ appKey: '', appSecret: '', accessToken: '', endpoint: ALIBABA_GATEWAY, signMethod: 'hmac' });
    await flushPromises();
    expect(wrapper.find('[data-skeleton-layout="authorization"]').exists()).toBe(false);
  });

  it('ends a failed initial settings load and offers an explicit read-only retry', async () => {
    const loadSettings = vi.fn().mockRejectedValueOnce(new Error('settings-read-failed')).mockResolvedValue({
      appKey: '',
      appSecret: '',
      accessToken: '',
      endpoint: ALIBABA_GATEWAY,
      signMethod: 'hmac'
    });
    const wrapper = mountView('extension', 'unlocked', 'manual', 'node', { loadSettings });
    await flushPromises();
    expect(wrapper.find('[data-skeleton-layout="authorization"]').exists()).toBe(false);
    const retry = wrapper.findAll('button').find((button) => button.text() === '重新加载');
    expect(retry).toBeDefined();
    if (!retry) throw new Error('Missing retry action');
    await retry.trigger('click');
    await flushPromises();
    expect(loadSettings).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-skeleton-layout="authorization"]').exists()).toBe(false);
  });
  it('keeps the independent service notice once at the bottom, outside credential dialogs', async () => {
    const wrapper = mountView('extension', 'unlocked');
    await flushPromises();
    const notice = wrapper.get('[data-testid="settings-independent-notice"]');
    expect(wrapper.findAll('[data-testid="settings-independent-notice"]')).toHaveLength(1);
    expect(notice.element.closest('[role="dialog"]')).toBeNull();
    expect(notice.element.parentElement?.lastElementChild).toBe(notice.element);
    wrapper.unmount();
  });
  it.each(['empty', 'unlocked'] as const)(
    'keeps an authorization guide entry with a %s vault and allows reopening it',
    async (state) => {
      const acquisition = {
        openTool: vi.fn(),
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
      const wrapper = mountView('extension', state, 'manual', 'node', { acquisition });
      await flushPromises();
      const launcher = wrapper.get('[data-testid="open-authorization-guide"]');
      expect(launcher.classes()).toContain('bg-primary');
      expect(launcher.element.parentElement?.classList.contains('justify-end')).toBe(true);
      expect(launcher.element.parentElement?.querySelectorAll('button')).toHaveLength(1);
      for (let index = 0; index < 2; index++) {
        await launcher.trigger('click');
        await flushPromises();
        expect(document.body.querySelector('[data-testid="authorization-wizard-guide"]')).not.toBeNull();
        document.body
          .querySelector<HTMLButtonElement>('[data-testid="cancel-authorization-protocol"]')
          ?.click();
        await flushPromises();
      }
      expect(acquisition.openTool).not.toHaveBeenCalled();
      expect(acquisition.start).not.toHaveBeenCalled();
      expect(createVault).not.toHaveBeenCalled();
      expect(unlockVault).not.toHaveBeenCalled();
      wrapper.unmount();
    }
  );

  it('saves a new vault with blank optional protection', async () => {
    const wrapper = mountView('extension', 'empty');
    await flushPromises();
    const save = wrapper.get('[data-testid="save-vault-near-passphrase"]');
    expect(save.attributes('disabled')).toBeUndefined();
    await save.trigger('click');
    await flushPromises();
    expect(createVault).toHaveBeenCalledWith('', expect.objectContaining({ endpoint: ALIBABA_GATEWAY }));
    wrapper.unmount();
  });

  it('explicitly unlocks device-protected settings without a password and keeps rotation available', async () => {
    const wrapper = mountView('extension', 'locked', 'manual', 'node', {
      initialVaultStatus: { ...vaultStatus('locked'), deviceProtected: true }
    });
    await flushPromises();
    expect(wrapper.find('input[aria-label="保护口令"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="vault-device-protected"]').exists()).toBe(true);
    expect(unlockVault).not.toHaveBeenCalled();
    const unlock = wrapper.findAll('button').find((button) => button.text() === '解锁');
    expect(unlock?.attributes('disabled')).toBeUndefined();
    await unlock?.trigger('click');
    await flushPromises();
    expect(unlockVault).toHaveBeenCalledExactlyOnceWith('');
    expect(wrapper.find('input[aria-label="新保护口令"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="open-vault-passphrase"]').attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('coalesces vault notifications and adopts returning authorization state without creating or unlocking again', async () => {
    let currentStatus = vaultStatus('empty');
    const status = vi.fn(() => Promise.resolve(currentStatus));
    const loadSettings = vi.fn(() =>
      Promise.resolve({
        appKey: currentStatus.state === 'unlocked' ? 'returned-key' : '',
        appSecret: '',
        accessToken: '',
        endpoint: ALIBABA_GATEWAY,
        signMethod: 'hmac' as const
      })
    );
    const wrapper = mountView('extension', 'empty', 'manual', 'node', { status, loadSettings });
    await flushPromises();
    window.dispatchEvent(new Event('storage'));
    expect(status).toHaveBeenCalledTimes(1);
    currentStatus = { ...vaultStatus('unlocked'), deviceProtected: true };
    notifyCredentialVaultChanged();
    notifyCredentialVaultChanged();
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="vault-device-protected"]').exists()).toBe(true);
    });
    await flushPromises();
    expect(status).toHaveBeenCalledTimes(2);
    expect(loadSettings).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-testid="vault-passphrase-setup"]').exists()).toBe(false);
    expect((wrapper.get('input[aria-label="App Key"]').element as HTMLInputElement).value).toBe(
      'returned-key'
    );
    expect(createVault).not.toHaveBeenCalled();
    expect(unlockVault).not.toHaveBeenCalled();
    wrapper.unmount();
    notifyCredentialVaultChanged();
    await flushPromises();
    expect(status).toHaveBeenCalledTimes(2);
  });

  it.each(['credentials', 'passphrase'] as const)(
    'does not overwrite unsaved %s after vault storage notifications',
    async (field) => {
      const editing = new UnsavedEditingService();
      const status = vi.fn(() => Promise.resolve(vaultStatus('unlocked')));
      const loadSettings = vi.fn(() =>
        Promise.resolve({
          appKey: 'initial',
          appSecret: '',
          accessToken: '',
          endpoint: ALIBABA_GATEWAY,
          signMethod: 'hmac' as const
        })
      );
      const wrapper = mountView('extension', 'unlocked', 'manual', 'node', { editing, status, loadSettings });
      await flushPromises();
      const selector =
        field === 'credentials' ? 'input[aria-label="App Key"]' : 'input[aria-label="新保护口令"]';
      const fields = field === 'credentials' ? wrapper : await openPassphraseDialog(wrapper);
      await fields.get(selector).setValue('unsaved-draft');
      notifyCredentialVaultChanged();
      await vi.waitFor(() => {
        expect(status).toHaveBeenCalledTimes(2);
      });
      expect(loadSettings).toHaveBeenCalledTimes(1);
      expect((fields.get(selector).element as HTMLInputElement).value).toBe('unsaved-draft');
      expect(editing.dirty.value).toBe(true);
      wrapper.unmount();
      editing.dispose();
    }
  );
  it('offers the IOP recommendation without opening a tool before the protocol choice', async () => {
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
    expect(wrapper.get('[data-testid="alibaba-credential-acquisition-guide"]').text()).toContain(
      '选择已有旧版应用'
    );
    await wrapper.get('select[aria-label="网关协议"]').setValue('iop');
    expect(wrapper.get('[data-testid="alibaba-credential-acquisition-guide"]').text()).toContain(
      '选择新版应用'
    );
    expect(wrapper.get('[data-testid="alibaba-credential-acquisition-guide"]').text()).toContain(
      '下载文件并在这里导入保存'
    );
    expect(wrapper.get('[data-testid="alibaba-credential-acquisition-guide"]').text()).not.toContain(
      '已打开的旧应用页面'
    );
    await openSettingsAuthorization(wrapper);
    expect(openIopTool).not.toHaveBeenCalled();
    expect(acquisition.readPrerequisite).not.toHaveBeenCalled();
    expect(acquisition.start).not.toHaveBeenCalled();
    const iop = document.body.querySelector<HTMLButtonElement>('[data-testid="choose-authorization-iop"]');
    expect(iop?.textContent).toContain('连接新版应用');
    expect(iop?.textContent).not.toContain('推荐');
    iop?.click();
    await flushPromises();
    expect(openIopTool).toHaveBeenCalledOnce();
    expect(acquisition.start).not.toHaveBeenCalled();
    expect(createVault).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each(['top', 'iop'] as const)(
    'launches only the chosen %s tool directly from its click',
    async (protocol) => {
      let clicking = false;
      const openTool = vi.fn(() => {
        expect(clicking).toBe(true);
        return Promise.resolve();
      });
      const acquisition = {
        openTool,
        openIopTool: vi.fn(),
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
      const wrapper = mountView('extension', 'unlocked', 'manual', 'node', { acquisition });
      await flushPromises();
      await openSettingsAuthorization(wrapper);
      expect(openTool).not.toHaveBeenCalled();
      expect(acquisition.readPrerequisite).not.toHaveBeenCalled();
      clicking = true;
      document.body
        .querySelector<HTMLButtonElement>(`[data-testid="choose-authorization-${protocol}"]`)
        ?.click();
      clicking = false;
      expect(openTool.mock.calls).toEqual([[protocol]]);
      expect(acquisition.openIopTool).not.toHaveBeenCalled();
      expect(acquisition.start).not.toHaveBeenCalled();
      expect(acquisition.readPrerequisite).not.toHaveBeenCalled();
      wrapper.unmount();
    }
  );

  it.each(['cancel', 'iop-unavailable', 'bff'] as const)(
    'does not acquire or read an app on %s',
    async (scenario) => {
      const acquisition = {
        openTool: vi.fn(),
        openIopTool: vi.fn(),
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
      if (scenario === 'iop-unavailable') {
        Object.defineProperty(acquisition, 'openTool', { value: undefined });
        Object.defineProperty(acquisition, 'openIopTool', { value: undefined });
      }
      const wrapper = mountView(scenario === 'bff' ? 'bff' : 'extension', 'empty', 'manual', 'node', {
        acquisition
      });
      await flushPromises();
      if (scenario === 'bff') {
        expect(wrapper.find('[data-testid="get-alibaba-credentials"]').exists()).toBe(false);
      } else {
        await openSettingsAuthorization(wrapper);
        const action = scenario === 'cancel' ? 'cancel-authorization-protocol' : 'choose-authorization-iop';
        document.body.querySelector<HTMLButtonElement>(`[data-testid="${action}"]`)?.click();
      }
      await flushPromises();
      if (scenario === 'iop-unavailable') {
        expect(toast.error).toHaveBeenCalledWith(
          '当前版本未提供此协议的授权工具，请升级插件或导入对应授权包。'
        );
      } else {
        expect(acquisition.openTool).not.toHaveBeenCalled();
        expect(acquisition.openIopTool).not.toHaveBeenCalled();
      }
      expect(acquisition.start).not.toHaveBeenCalled();
      expect(acquisition.readPrerequisite).not.toHaveBeenCalled();
      expect(acquisition.status).not.toHaveBeenCalled();
      wrapper.unmount();
    }
  );
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
    expect(wrapper.find('#settings-preferences').exists()).toBe(false);
    await wrapper.get('button[aria-controls="settings-preferences"]').trigger('click');
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
  it('removes idle controls and countdowns even from an old timed status, while retaining passphrase setup', async () => {
    const wrapper = mountView('extension', 'unlocked', 'manual', 'node', {
      initialVaultStatus: vaultStatus('unlocked', 30)
    });
    await flushPromises();

    expect(wrapper.find('select[aria-label="空闲自动锁定时间"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('保存锁定策略');
    expect(wrapper.text()).not.toContain('快照剩余');
    expect(wrapper.text()).toContain('本机记住解锁');
    expect(wrapper.text()).toContain('重启浏览器或更新扩展不锁定');
    expect(wrapper.text()).toContain('手动锁定仅隐藏敏感信息，不中断后台 API');
    const passphrase = await openPassphraseDialog(wrapper);
    expect(passphrase.get('input[aria-label="新保护口令"]').attributes('placeholder')).toBe('至少 6 位');
    expect(wrapper.text()).not.toContain('UTF-8 字节');
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(wrapper.text()).toContain('Unlocking survives browser restarts and extension updates');
    expect(wrapper.text()).toContain('background APIs continue working');
    expect(wrapper.text()).toContain('Legacy records without a local recovery key');
    expect(document.body.textContent).toContain('No idle lock');
    expect(wrapper.text()).toContain('Lock now');
    expect(wrapper.find('select[aria-label="Automatic idle lock duration"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Save lock policy');
    expect(wrapper.text()).not.toContain('minutes left');
    expect(updateVaultPolicy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('preserves a typed unlock passphrase when the same locked status is notified again', async () => {
    const status = vi.fn(() => Promise.resolve({ ...vaultStatus('locked'), gatewayAvailable: true }));
    const wrapper = mountView('extension', 'locked', 'manual', 'node', { status });
    await flushPromises();
    const input = wrapper.get('input[aria-label="保护口令"]');
    await input.setValue('test-only-passphrase');
    notifyCredentialVaultChanged();
    await vi.waitFor(() => {
      expect(status.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    await flushPromises();
    expect((input.element as HTMLInputElement).value).toBe('test-only-passphrase');
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === '解锁');
    if (!button) throw new Error('Missing unlock button');
    expect(button.attributes('disabled')).toBeUndefined();
  });

  it('keeps manual locking and requires the passphrase before unlocking again', async () => {
    const wrapper = mountView('extension', 'unlocked');
    await flushPromises();
    const lockButton = wrapper.findAll('button').find((candidate) => candidate.text() === '立即锁定');
    if (!lockButton) throw new Error('Missing manual lock button');
    await lockButton.trigger('click');
    await flushPromises();
    expect(manualLockVault).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('已手动锁定');
    expect(wrapper.text()).toContain('后台 API 可继续使用');
    expect(wrapper.find('input[aria-label="App Key"]').exists()).toBe(false);
    expect(unlockVault).not.toHaveBeenCalled();
    await wrapper.get('input[aria-label="保护口令"]').setValue('test-only-passphrase');
    const unlockButton = wrapper.findAll('button').find((candidate) => candidate.text() === '解锁');
    if (!unlockButton) throw new Error('Missing unlock button');
    await unlockButton.trigger('click');
    await flushPromises();
    expect(unlockVault).toHaveBeenCalledWith('test-only-passphrase');
    expect(wrapper.text()).toContain('本机已记住状态');
    expect(updateVaultPolicy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('retains unsaved passphrase protection and rotation without a lock policy', async () => {
    const editing = new UnsavedEditingService();
    const wrapper = mountView('extension', 'unlocked', 'manual', 'node', { editing });
    await flushPromises();
    expect(editing.dirty.value).toBe(false);
    const passphrase = await openPassphraseDialog(wrapper);
    await passphrase.get('input[aria-label="新保护口令"]').setValue('rotated-test-only');
    await passphrase.get('input[aria-label="确认新保护口令"]').setValue('rotated-test-only');
    expect(editing.dirty.value).toBe(true);
    const rotateButton = passphrase.findAll('button').find((candidate) => candidate.text() === '更换口令');
    if (!rotateButton) throw new Error('Missing passphrase rotation button');
    await rotateButton.trigger('click');
    await flushPromises();
    expect(rotateVault).toHaveBeenCalledWith('rotated-test-only');
    expect(editing.dirty.value).toBe(false);
    expect(document.body.querySelector('input[aria-label="新保护口令"]')).toBeNull();
    expect(updateVaultPolicy).not.toHaveBeenCalled();
    wrapper.unmount();
    editing.dispose();
  });

  it('keeps two protection actions and opens rotation only on request; cancel leaves the vault unchanged', async () => {
    const wrapper = mountView('extension', 'unlocked');
    await flushPromises();
    const protection = wrapper.get('[data-testid="alibaba-credential-protection-panel"]');
    expect(protection.findAll('button')).toHaveLength(2);
    expect(document.body.querySelector('input[aria-label="新保护口令"]')).toBeNull();
    const dialog = await openPassphraseDialog(wrapper);
    await dialog
      .findAll('button')
      .find((button) => button.text() === '取消')
      ?.trigger('click');
    await flushPromises();
    expect(document.body.querySelector('input[aria-label="新保护口令"]')).toBeNull();
    expect(rotateVault).not.toHaveBeenCalled();
    expect(manualLockVault).not.toHaveBeenCalled();
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
    expect(wrapper.text()).toContain('凭证与设置已保存');
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
    expect(wrapper.text()).toContain('凭证与设置已保存');
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
    await wrapper.get('button[aria-controls="settings-preferences"]').trigger('click');

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
      expect(wrapper.text()).toContain('已解锁，本机已记住状态');
    });
    expect((wrapper.get('input[aria-label="App Key"]').element as HTMLInputElement).value).toBe(
      'configured-key'
    );
    expect(unlockVault).toHaveBeenCalledWith('correct-vault-password');
    expect(wrapper.get('input[aria-label="App Secret"]').attributes('placeholder')).toContain('留空保持不变');

    expect(wrapper.find('select[aria-label="空闲自动锁定时间"]').exists()).toBe(false);
    expect(updateVaultPolicy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each(['session-ended', 'idle'] as const)(
    'requires one unlock for an existing %s record without claiming new auto-lock behavior',
    async (reason) => {
      const wrapper = mountView('extension', 'locked', reason);
      await vi.waitFor(() => {
        expect(wrapper.text()).toContain('现有开放平台凭证仍处于锁定状态');
      });
      expect(wrapper.text()).toContain('旧凭证仍锁定');
      expect(wrapper.text()).toContain('请用原口令解锁一次');
      expect(unlockVault).not.toHaveBeenCalled();
      expect(wrapper.text()).not.toContain('会清除内存解锁材料');
      wrapper.unmount();
    }
  );

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
      expect(wrapper.text()).toContain('旧凭证已加密，本机保持解锁');
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

function safeAuthorizationSummary(): AlibabaAuthorizationsSummary {
  const profile = (protocol: 'top' | 'iop'): ControlGatewayCredentialSummary => ({
    ...(dashboardFixture.credential as ControlGatewayCredentialSummary),
    protocol,
    configurationId: `${protocol}-opaque-configuration`,
    managementAvailable: true
  });
  return {
    top: profile('top'),
    iop: profile('iop'),
    defaultProtocol: 'top',
    binding: { confirmed: false, topConfigurationId: null, iopConfigurationId: null, confirmedAtUtc: null }
  };
}

function settingsForBackup(exportAuthorization: NonNullable<SettingsRepository['exportAuthorization']>) {
  return {
    authorizations: vi.fn().mockResolvedValue(safeAuthorizationSummary()),
    loadAuthorization: vi.fn().mockResolvedValue({
      appKey: credentialFixtures.oauthBundle.application.appKey,
      appSecret: '',
      accessToken: '',
      endpoint: ALIBABA_GATEWAY,
      signMethod: 'hmac'
    }),
    exportAuthorization,
    setDefaultAuthorization: vi.fn(),
    refreshAuthorization: vi.fn(),
    clearAuthorization: vi.fn(),
    testAuthorization: vi.fn()
  } satisfies Partial<SettingsRepository>;
}

function bodyButton(testId: string): HTMLButtonElement {
  const button = document.body.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!button) throw new Error(`Missing settings button: ${testId}`);
  return button;
}

async function openBackupConfirmation(wrapper: ReturnType<typeof mountView>): Promise<void> {
  await waitForAuthorizationSummary(wrapper);
  await wrapper.get('[data-testid="select-authorization-top"]').trigger('click');
  await flushPromises();
  await vi.waitFor(() => {
    expect(bodyButton('backup-online-authorization').disabled).toBe(false);
  });
  expect(document.querySelectorAll('[data-testid="credential-connection-actions"]')).toHaveLength(1);
  expect(document.querySelectorAll('[data-testid="credential-backup-actions"]')).toHaveLength(1);
  bodyButton('backup-online-authorization').click();
  await flushPromises();
  await vi.waitFor(() => {
    expect(backupConfirmationDialog()).toBeDefined();
  });
}

async function waitForAuthorizationSummary(wrapper: ReturnType<typeof mountView>): Promise<void> {
  await vi.waitFor(
    () => {
      expect(wrapper.find('[data-testid="alibaba-authorizations-panel"]').exists()).toBe(true);
    },
    { timeout: 5_000 }
  );
}

function backupConfirmationDialog(): HTMLElement {
  const dialog = [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')].find((node) => {
    const title = node.querySelector('h2')?.textContent ?? '';
    return (
      title === '下载包含明文密钥的授权文件？' ||
      title === 'Download an authorization file with plaintext secrets?'
    );
  });
  if (!dialog) throw new Error('Missing authorization-backup confirmation dialog');
  return dialog;
}

function confirmBackup(): void {
  const button = [...backupConfirmationDialog().querySelectorAll<HTMLButtonElement>('button')].find(
    (item) =>
      item.textContent.trim() === '确认下载授权文件' ||
      item.textContent.trim() === 'Download authorization file'
  );
  if (!button) throw new Error('Missing explicit authorization-backup confirmation');
  button.click();
}

describe('SettingsView saved credential import baseline', () => {
  async function mountSavedImport() {
    const editing = new UnsavedEditingService();
    const metadata = Promise.withResolvers<AlibabaAuthorizationsSummary>();
    let persisted = false;
    let currentStatus = vaultStatus('unlocked');
    const loadSettings = vi.fn(() =>
      Promise.resolve<GatewaySettings>({
        appKey: persisted ? 'persisted-import-key' : 'initial-key',
        appSecret: '',
        accessToken: '',
        endpoint: ALIBABA_GATEWAY,
        signMethod: 'hmac'
      })
    );
    const authorizations = vi.fn().mockResolvedValue(safeAuthorizationSummary());
    const repository = {
      ...settingsForBackup(vi.fn()),
      loadAuthorization: loadSettings,
      authorizations
    };
    const wrapper = mountView('extension', 'unlocked', 'manual', 'node', {
      editing,
      loadSettings,
      settings: repository,
      status: () => Promise.resolve(currentStatus)
    });
    await waitForAuthorizationSummary(wrapper);
    await flushPromises();
    authorizations.mockReturnValue(metadata.promise);
    function imported(): void {
      persisted = true;
      const dialog = wrapper.getComponent({ name: 'AlibabaAuthorizationProtocolDialog' })
        .vm as ComponentPublicInstance;
      dialog.$emit('imported', currentStatus);
    }
    async function openEditor(): Promise<DOMWrapper<HTMLElement>> {
      await wrapper.get('[data-testid="select-authorization-top"]').trigger('click');
      await flushPromises();
      const manual = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent.trim() === '\u624b\u52a8\u586b\u5199'
      );
      if (!manual) throw new Error('Missing manual configuration action');
      manual.click();
      await flushPromises();
      return new DOMWrapper(document.body);
    }
    return {
      wrapper,
      editing,
      metadata,
      authorizations,
      loadSettings,
      imported,
      openEditor,
      lock() {
        currentStatus = { ...vaultStatus('locked'), gatewayAvailable: true };
        notifyCredentialVaultChanged();
      }
    };
  }

  it('allows immediate navigation after a saved import while metadata refresh is pending', async () => {
    const fixture = await mountSavedImport();
    const previousHash = window.location.hash;
    window.history.replaceState(null, '', '#/settings');
    const stop = installEditingNavigationGuard(fixture.editing);
    const navigated = vi.fn();
    window.addEventListener('hashchange', navigated);
    try {
      fixture.imported();
      await flushPromises();
      expect(fixture.authorizations).toHaveBeenCalledTimes(2);
      expect(fixture.editing.dirty.value).toBe(false);
      window.location.hash = '#/photos';
      await vi.waitFor(() => {
        expect(navigated).toHaveBeenCalled();
      });
      expect(window.location.hash).toBe('#/photos');
      expect(fixture.editing.confirmationOpen.value).toBe(false);
    } finally {
      window.removeEventListener('hashchange', navigated);
      stop();
      fixture.metadata.resolve(safeAuthorizationSummary());
      await flushPromises();
      fixture.wrapper.unmount();
      fixture.editing.dispose();
      window.history.replaceState(null, '', previousHash || '#/dashboard');
    }
  });

  it('keeps later real edits dirty when the imported authorization metadata finishes refreshing', async () => {
    const fixture = await mountSavedImport();
    const fields = await fixture.openEditor();
    const previousHash = window.location.hash;
    window.history.replaceState(null, '', '#/settings');
    const stop = installEditingNavigationGuard(fixture.editing);
    try {
      fixture.imported();
      await flushPromises();
      expect(fixture.authorizations).toHaveBeenCalledTimes(2);
      expect((fields.get('input[aria-label="App Key"]').element as HTMLInputElement).value).toBe(
        'persisted-import-key'
      );
      expect(fixture.editing.dirty.value).toBe(false);
      await fields.get('input[aria-label="App Key"]').setValue('later-unsaved-edit');
      expect(fixture.editing.dirty.value).toBe(true);
      fixture.metadata.resolve(safeAuthorizationSummary());
      await flushPromises();
      expect((fields.get('input[aria-label="App Key"]').element as HTMLInputElement).value).toBe(
        'later-unsaved-edit'
      );
      expect(fixture.editing.dirty.value).toBe(true);
      window.location.hash = '#/photos';
      await vi.waitFor(() => {
        expect(fixture.editing.confirmationOpen.value).toBe(true);
      });
      expect(window.location.hash).toBe('#/settings');
    } finally {
      fixture.editing.answer(false);
      stop();
      fixture.metadata.resolve(safeAuthorizationSummary());
      await flushPromises();
      fixture.wrapper.unmount();
      fixture.editing.dispose();
      window.history.replaceState(null, '', previousHash || '#/dashboard');
    }
  });

  it('preserves unsaved edits when reading the saved import fails', async () => {
    const fixture = await mountSavedImport();
    const fields = await fixture.openEditor();
    await fields.get('input[aria-label="App Key"]').setValue('preserved-unsaved-edit');
    const error = new Error('saved-import-read-failed');
    fixture.loadSettings.mockRejectedValueOnce(error);
    fixture.imported();
    await flushPromises();
    expect(fixture.editing.dirty.value).toBe(true);
    expect((fields.get('input[aria-label="App Key"]').element as HTMLInputElement).value).toBe(
      'preserved-unsaved-edit'
    );
    expect(fixture.authorizations).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith(error.message);
    expect(fixture.wrapper.text()).not.toContain('\u51ed\u636e\u5df2\u83b7\u53d6\u5e76\u4fdd\u5b58');
    fixture.wrapper.unmount();
    fixture.editing.dispose();
  });

  it.each(['locked', 'unmounted'] as const)(
    'ignores a late saved-import read after the sensitive view is %s',
    async (state) => {
      const fixture = await mountSavedImport();
      const fields = await fixture.openEditor();
      expect((fields.get('input[aria-label="App Key"]').element as HTMLInputElement).value).toBe(
        'initial-key'
      );
      expect(document.querySelector('input[aria-label="App Key"]')).not.toBeNull();
      const read = Promise.withResolvers<GatewaySettings>();
      fixture.loadSettings.mockReturnValueOnce(read.promise);
      fixture.imported();
      await flushPromises();
      if (state === 'unmounted') fixture.wrapper.unmount();
      else {
        fixture.lock();
        await vi.waitFor(() => {
          expect(document.querySelector('input[aria-label="App Key"]')).toBeNull();
        });
      }
      const refreshesBeforeLateRead = fixture.authorizations.mock.calls.length;
      read.resolve({
        appKey: 'late-import-must-not-appear',
        appSecret: '',
        accessToken: '',
        endpoint: ALIBABA_GATEWAY,
        signMethod: 'hmac'
      });
      await flushPromises();
      expect(fixture.authorizations).toHaveBeenCalledTimes(refreshesBeforeLateRead);
      fixture.metadata.resolve(safeAuthorizationSummary());
      await flushPromises();
      expect(document.body.textContent).not.toContain('late-import-must-not-appear');
      expect(document.body.textContent).not.toContain('\u51ed\u636e\u5df2\u83b7\u53d6\u5e76\u4fdd\u5b58');
      if (fixture.wrapper.exists()) fixture.wrapper.unmount();
      fixture.editing.dispose();
    }
  );
});

describe('SettingsView sensitive view lock and online authorization backup', () => {
  it('shows safe summaries while locked, without loading secrets or permitting management', async () => {
    const repository = settingsForBackup(vi.fn());
    const loadSettings = vi.fn();
    const wrapper = mountView('extension', 'locked', 'manual', 'node', {
      initialVaultStatus: { ...vaultStatus('locked'), gatewayAvailable: true },
      settings: repository,
      loadSettings
    });
    await waitForAuthorizationSummary(wrapper);
    const panel = wrapper.get('[data-testid="alibaba-authorizations-panel"]');
    expect(repository.authorizations).toHaveBeenCalledOnce();
    expect(panel.text()).toContain('TOP');
    expect(panel.text()).toContain('IOP');
    for (const action of ['select', 'default', 'clear']) {
      for (const protocol of ['top', 'iop']) {
        const button = panel.get(`[data-testid="${action}-authorization-${protocol}"]`);
        expect(button.attributes('disabled')).toBeDefined();
        await button.trigger('click');
      }
    }
    expect(wrapper.text()).toContain('后台 API 可继续使用');
    expect(wrapper.find('input[aria-label="App Key"]').exists()).toBe(false);
    expect(document.querySelector('[data-testid="backup-online-authorization"]')).toBeNull();
    expect(loadSettings).not.toHaveBeenCalled();
    expect(repository.loadAuthorization).not.toHaveBeenCalled();
    expect(repository.setDefaultAuthorization).not.toHaveBeenCalled();
    expect(repository.clearAuthorization).not.toHaveBeenCalled();
    expect(repository.refreshAuthorization).not.toHaveBeenCalled();
    expect(repository.exportAuthorization).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('clears a sensitive editing form and closes its dialog when another tab locks the view', async () => {
    let currentStatus = vaultStatus('unlocked');
    const repository = settingsForBackup(vi.fn());
    const wrapper = mountView('extension', 'unlocked', 'manual', 'node', {
      status: () => Promise.resolve(currentStatus),
      settings: repository
    });
    await waitForAuthorizationSummary(wrapper);
    await wrapper.get('[data-testid="select-authorization-top"]').trigger('click');
    await flushPromises();
    const manual = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent.trim() === '手动填写'
    );
    manual?.click();
    await flushPromises();
    const input = document.querySelector<HTMLInputElement>('input[aria-label="App Secret"]');
    expect(input).not.toBeNull();
    if (!input) throw new Error('Missing manual secret input');
    input.value = credentialFixtures.oauthBundle.application.appSecret;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    currentStatus = { ...vaultStatus('locked'), gatewayAvailable: true };
    notifyCredentialVaultChanged();
    await vi.waitFor(() => {
      expect(document.querySelector('input[aria-label="App Secret"]')).toBeNull();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
    expect(wrapper.text()).toContain('后台 API 可继续使用');
    expect(repository.authorizations).toHaveBeenCalledTimes(2);
    expect(repository.exportAuthorization).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each(['zh-CN', 'en-US'] as const)(
    'backs up only after confirmation, with plaintext warning (%s)',
    async (locale) => {
      const exportAuthorization = vi.fn().mockResolvedValue(credentialFixtures.oauthBundle);
      const repository = settingsForBackup(exportAuthorization);
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
      const downloads: string[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.download);
        anchorClick();
      });
      const wrapper = mountView('extension', 'unlocked', 'manual', 'node', { settings: repository });
      await waitForAuthorizationSummary(wrapper);
      uiI18n.global.locale.value = locale;
      await flushPromises();
      await openBackupConfirmation(wrapper);
      const confirmation = backupConfirmationDialog();
      expect(confirmation.textContent).toContain('App Secret');
      expect(confirmation.textContent).toContain('Access Token');
      expect(confirmation.textContent).toContain(locale === 'zh-CN' ? '明文密钥' : 'plaintext');
      expect(exportAuthorization).not.toHaveBeenCalled();
      expect(createObjectUrl).not.toHaveBeenCalled();
      const button = bodyButton('backup-online-authorization');
      expect(button.classList.contains('h-9')).toBe(true);
      confirmBackup();
      await flushPromises();
      expect(exportAuthorization).toHaveBeenCalledExactlyOnceWith('top');
      expect(downloads).toEqual(['credentialInfo.json']);
      expect(createObjectUrl).toHaveBeenCalledOnce();
      const blob = createObjectUrl.mock.calls[0]?.[0];
      expect(blob?.type).toBe('application/json');
      const content = await new Promise<string>((resolve, reject) => {
        if (!blob) {
          reject(new Error('Missing exported JSON Blob'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') resolve(reader.result);
          else reject(new Error('Expected exported JSON text'));
        };
        reader.onerror = reject;
        reader.readAsText(blob);
      });
      expect(JSON.parse(content)).toEqual(credentialFixtures.oauthBundle);
      expect(revokeObjectUrl).toHaveBeenCalledExactlyOnceWith('blob:diagnostics');
      expect(toast.success).toHaveBeenCalledWith(
        locale === 'zh-CN'
          ? '授权文件下载已发起，请妥善保管。'
          : 'Authorization download started. Keep the file secure.'
      );
      expect(repository.refreshAuthorization).not.toHaveBeenCalled();
      expect(repository.clearAuthorization).not.toHaveBeenCalled();
      wrapper.unmount();
    }
  );

  it('returns from the backup confirmation without exporting or closing the configuration dialog', async () => {
    const exportAuthorization = vi.fn();
    const wrapper = mountView('extension', 'unlocked', 'manual', 'node', {
      settings: settingsForBackup(exportAuthorization)
    });
    await flushPromises();
    await openBackupConfirmation(wrapper);
    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    expect(dialogs).toHaveLength(2);
    const close = backupConfirmationDialog().querySelector<HTMLButtonElement>('button[aria-label]');
    close?.click();
    await flushPromises();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('[data-testid="backup-online-authorization"]')).not.toBeNull();
    expect(exportAuthorization).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each(['AUTH_BACKUP_UNAVAILABLE', 'AUTH_BACKUP_STALE'])('does not download for %s', async (code) => {
    const exportAuthorization = vi
      .fn()
      .mockRejectedValue(new GatewayException({ code, message: code, retryable: false }));
    const wrapper = mountView('extension', 'unlocked', 'manual', 'node', {
      settings: settingsForBackup(exportAuthorization)
    });
    await flushPromises();
    await openBackupConfirmation(wrapper);
    confirmBackup();
    await flushPromises();
    expect(exportAuthorization).toHaveBeenCalledExactlyOnceWith('top');
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(code);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith('未能备份授权文件，请查看错误详情；也可使用原授权文件。');
    wrapper.unmount();
  });

  it('discards a late backup response after the sensitive view is locked', async () => {
    let currentStatus = vaultStatus('unlocked');
    let resolveBackup: ((bundle: AlibabaOpenApiCredentialBundle) => void) | undefined;
    const exportAuthorization = vi.fn(
      () =>
        new Promise<AlibabaOpenApiCredentialBundle>((resolve) => {
          resolveBackup = resolve;
        })
    );
    const wrapper = mountView('extension', 'unlocked', 'manual', 'node', {
      status: () => Promise.resolve(currentStatus),
      settings: settingsForBackup(exportAuthorization)
    });
    await flushPromises();
    await openBackupConfirmation(wrapper);
    confirmBackup();
    await flushPromises();
    expect(exportAuthorization).toHaveBeenCalledOnce();
    currentStatus = { ...vaultStatus('locked'), gatewayAvailable: true };
    notifyCredentialVaultChanged();
    await vi.waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
    resolveBackup?.(credentialFixtures.oauthBundle as AlibabaOpenApiCredentialBundle);
    await flushPromises();
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(document.querySelector('input[aria-label="App Key"]')).toBeNull();
    wrapper.unmount();
  });
});
