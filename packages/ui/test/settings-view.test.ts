// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ALIBABA_GATEWAY,
  MockGatewayClient,
  type CredentialVaultState,
  type CredentialVaultStatus,
  type GatewaySettings
} from '@one-vegetable/core';

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

function mountView(mode: 'mock' | 'extension' = 'mock', initialVaultState?: CredentialVaultState) {
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
                status: () => Promise.resolve(vaultStatus(currentVaultState ?? 'empty')),
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
      expect(wrapper.text()).toContain('凭证保险库已解锁');
    });
    const credentialsCard = wrapper
      .findAll('section')
      .find((candidate) => candidate.text().includes('国际站开放平台凭证'));
    if (!credentialsCard) throw new Error('Missing credentials card after unlock');
    const credentialInputs = credentialsCard.findAll('input');
    expect((credentialInputs[0]?.element as HTMLInputElement | undefined)?.value).toBe('configured-key');
    expect(unlockVault).toHaveBeenCalledWith('correct-vault-password');
    expect(credentialInputs[1]?.attributes('placeholder')).toContain('留空保持不变');

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
      expect(wrapper.text()).toContain('旧版明文凭证已原位迁移');
    });
    wrapper.unmount();
  });
});

function vaultStatus(state: CredentialVaultState, idleTimeoutMinutes = 15): CredentialVaultStatus {
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
    idleRemainingSeconds: state === 'unlocked' ? idleTimeoutMinutes * 60 : null,
    lockReason: state === 'locked' ? 'manual' : null
  };
}
