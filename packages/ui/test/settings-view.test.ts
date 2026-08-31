// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ALIBABA_GATEWAY,
  APP_PREFERENCES_STORAGE_KEY,
  type CredentialVaultLockReason,
  type CredentialVaultState,
  type CredentialVaultStatus,
  type GatewaySettings
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import SettingsView from '../src/views/SettingsView.vue';
import { provideServices } from '../src/lib/services';

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
  mode: 'mock' | 'extension' = 'mock',
  initialVaultState?: CredentialVaultState,
  initialLockReason: CredentialVaultLockReason = 'manual'
) {
  let grantedHosts = ['https://images.example.com/*'];
  let currentVaultState = initialVaultState;
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway: new MockGatewayClient(0),
        settings: {
          load: () =>
            Promise.resolve({
              appKey: currentVaultState === 'unlocked' ? 'configured-key' : '',
              appSecret: '',
              accessToken: '',
              endpoint: ALIBABA_GATEWAY,
              signMethod: 'hmac' as const
            }),
          save: () => Promise.resolve()
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
          inspect: () =>
            Promise.resolve({
              generatedAt: '2026-08-13T08:00:00.000Z',
              totalApproximateBytes: 512,
              categories: [
                {
                  id: 'credentials',
                  label: '加密凭证保险库与网关设置',
                  storage: 'chrome.storage.local',
                  itemCount: 1,
                  approximateBytes: 512,
                  sensitive: true,
                  retention: '保留到用户清除'
                }
              ]
            }),
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
        mode
      });
      return () => h(SettingsView);
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
  it('shows no idle auto-lock as the default and explains the six-character minimum', async () => {
    const wrapper = mountView('extension', 'unlocked');
    await flushPromises();

    expect((wrapper.get('select[aria-label="空闲自动锁定时间"]').element as HTMLSelectElement).value).toBe(
      '0'
    );
    expect(wrapper.get('select[aria-label="空闲自动锁定时间"]').text()).toContain('不自动锁定（默认）');
    expect(wrapper.get('input[aria-label="新保险库口令"]').attributes('placeholder')).toBe('至少 6 位');
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

  it('accepts a six-character passphrase when creating the extension vault', async () => {
    const wrapper = mountView('extension', 'empty');
    await flushPromises();

    await wrapper.get('input[aria-label="新建保险库口令"]').setValue('123456');
    await wrapper.get('input[aria-label="确认保险库口令"]').setValue('123456');
    const createButton = wrapper
      .findAll('button')
      .find((candidate) => candidate.text().includes('创建保险库并保存'));
    if (!createButton) throw new Error('Missing vault creation button');
    await createButton.trigger('click');
    await flushPromises();

    expect(createVault).toHaveBeenCalledWith(
      '123456',
      expect.objectContaining({ endpoint: ALIBABA_GATEWAY, signMethod: 'hmac' })
    );
    expect(wrapper.text()).toContain('凭证已加密保存');
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
    expect((wrapper.get('input[aria-label="App Secret"]').element as HTMLInputElement).value).toBe(
      'imported-secret'
    );
    expect((wrapper.get('input[aria-label="Access Token"]').element as HTMLInputElement).value).toBe(
      'imported-token'
    );
    expect(wrapper.text()).toContain('尚未保存');
    expect(createVault).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('persists the preferred Alibaba request language outside the credential vault', async () => {
    const wrapper = mountView('extension', 'locked');
    await flushPromises();

    const language = wrapper.get('select[aria-label="偏好语言"]');
    expect((language.element as HTMLSelectElement).value).toBe('en_US');
    await language.setValue('zh_CN');

    expect(JSON.parse(localStorage.getItem(APP_PREFERENCES_STORAGE_KEY) ?? '{}')).toEqual({
      language: 'zh_CN',
      theme: 'system'
    });
    expect(wrapper.text()).toContain('接口语言偏好已保存为 zh_CN');
    wrapper.unmount();
  });

  it('persists and applies the preferred interface theme', async () => {
    const wrapper = mountView();
    await flushPromises();

    const theme = wrapper.get('select[aria-label="主题偏好"]');
    expect((theme.element as HTMLSelectElement).value).toBe('system');
    await theme.setValue('dark');

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(JSON.parse(localStorage.getItem(APP_PREFERENCES_STORAGE_KEY) ?? '{}')).toEqual({
      language: 'en_US',
      theme: 'dark'
    });
    expect(wrapper.text()).toContain('界面主题已切换为深色');
    wrapper.unmount();
  });

  it('exports a redacted snapshot and clears the session log', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(anchorClick);
    const wrapper = mountView();

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
    const wrapper = mountView('extension');
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
    const wrapper = mountView('extension');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('本地数据与隐私');
      expect(wrapper.text()).toContain('加密凭证保险库与网关设置');
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

    expect(clearAllLocalData).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('扩展本地数据和额外主机权限已清除');
    });
    wrapper.unmount();
  });

  it('hides editable credentials while locked and reveals only safe fields after unlock', async () => {
    const wrapper = mountView('extension', 'locked');
    await vi.waitFor(() => {
      expect(wrapper.find('input[aria-label="保险库口令"]').exists()).toBe(true);
    });
    expect(wrapper.text()).not.toContain('国际站开放平台凭证');

    await wrapper.get('input[aria-label="保险库口令"]').setValue('correct-vault-password');
    await wrapper.get('button').trigger('click');
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
      expect(wrapper.text()).toContain('连续 30 分钟未使用凭证后自动锁定');
    });
    wrapper.unmount();
  });

  it('explains that ending the Chrome session cleared only the in-memory unlock material', async () => {
    const wrapper = mountView('extension', 'locked', 'session-ended');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Chrome 会话已结束，需要重新解锁');
    });
    expect(wrapper.text()).toContain('会清除仅存于内存的会话解锁材料');
    expect(wrapper.text()).toContain('本地加密凭据仍然安全保存');
    wrapper.unmount();
  });

  it('requires matching passphrases before migrating legacy plaintext credentials', async () => {
    const wrapper = mountView('extension', 'legacy');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('发现旧版明文凭证');
    });
    await wrapper.get('input[aria-label="新建保险库口令"]').setValue('migrated-vault-password');
    await wrapper.get('input[aria-label="确认保险库口令"]').setValue('different-vault-password');
    await wrapper.get('button').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('两次输入的保险库口令不一致');
    });
    expect(migrateVault).not.toHaveBeenCalled();

    await wrapper.get('input[aria-label="确认保险库口令"]').setValue('migrated-vault-password');
    await wrapper.get('button').trigger('click');
    await vi.waitFor(() => {
      expect(migrateVault).toHaveBeenCalledWith('migrated-vault-password');
      expect(wrapper.text()).toContain('旧版明文凭证已原位加密，并在当前 Chrome 会话内保持可用');
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
