// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ALIBABA_GATEWAY,
  type AlibabaCredentialAcquisitionContinueCommand,
  type AlibabaCredentialAcquisitionState,
  type AlibabaOpenApiCredentialBundle,
  type CredentialVaultStatus
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import AlibabaCredentialAcquisitionDialog from '../src/components/AlibabaCredentialAcquisitionDialog.vue';
import { provideServices } from '../src/lib/services';

const JOB_ID = '944323be-467a-4c81-9c2e-cf455e1f8d7c';
const start = vi.fn((_callbackUrl: string | null) => Promise.resolve(selectionState()));
const continueAcquisition = vi.fn((_jobId: string, command: AlibabaCredentialAcquisitionContinueCommand) =>
  Promise.resolve(command.type === 'select-application' ? callbackState() : completedState())
);
const statusAcquisition = vi.fn(() => Promise.resolve(selectionState()));
const cancelAcquisition = vi.fn(() => Promise.resolve(failedState()));
const saveToVault = vi.fn((_passphrase?: string) => Promise.resolve(vaultStatus('unlocked')));
const exportBundle = vi.fn(() => Promise.resolve(bundle()));
const readPrerequisite = vi.fn(
  (): Promise<Extract<AlibabaCredentialAcquisitionState, { status: 'prerequisite-required' }> | null> =>
    Promise.resolve(null)
);
const locatePrerequisiteField = vi.fn(() => Promise.resolve(null));
const focusPrerequisitePage = vi.fn(() => Promise.resolve());
const anchorClick = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(anchorClick);
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:credential-bundle'),
    revokeObjectURL: vi.fn()
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('AlibabaCredentialAcquisitionDialog', () => {
  it('walks through app selection, exact callback confirmation, vault save and explicit export', async () => {
    const Host = defineComponent({
      setup() {
        provideServices({
          gateway: new MockGatewayClient(0),
          settings: {
            load: () =>
              Promise.resolve({
                appKey: '',
                appSecret: '',
                accessToken: '',
                endpoint: ALIBABA_GATEWAY,
                signMethod: 'hmac'
              }),
            save: () => Promise.resolve()
          },
          vault: {
            status: () => Promise.resolve(vaultStatus('empty')),
            create: () => Promise.resolve(vaultStatus('unlocked')),
            migrate: () => Promise.resolve(vaultStatus('unlocked')),
            unlock: () => Promise.resolve(vaultStatus('unlocked')),
            lock: () => Promise.resolve(vaultStatus('locked')),
            rotate: () => Promise.resolve(vaultStatus('unlocked')),
            updatePolicy: () => Promise.resolve(vaultStatus('unlocked'))
          },
          alibabaCredentialAcquisition: {
            start,
            continue: continueAcquisition,
            status: statusAcquisition,
            cancel: cancelAcquisition,
            saveToVault,
            exportBundle,
            readPrerequisite,
            locatePrerequisiteField,
            focusPrerequisitePage
          },
          mode: 'extension'
        });
        return () => h(AlibabaCredentialAcquisitionDialog, { open: true });
      }
    });
    const wrapper = mount(Host, { attachTo: document.body });
    await flushPromises();

    expect(document.body.textContent).toContain('插件不会读取或保存网站密码');
    expect(document.body.querySelector('input[autocomplete="current-password"]')).toBeNull();
    clickButton('打开 Alibaba 并开始');
    await flushPromises();
    expect(start).toHaveBeenCalledWith(null);
    expect(document.body.textContent).toContain('AppKey 尾号 1234');
    expect(document.body.textContent).not.toContain('50001234');

    clickButton('oneVegetable Online');
    await flushPromises();
    expect(continueAcquisition).toHaveBeenCalledWith(JOB_ID, {
      type: 'select-application',
      applicationId: 'application-1'
    });
    expect(document.body.textContent).toContain('https://seller.example.com/oauth/callback');

    clickButton('继续授权');
    await flushPromises();
    expect(continueAcquisition).toHaveBeenLastCalledWith(JOB_ID, {
      type: 'confirm-callback-change',
      confirmed: false
    });
    expect(document.body.textContent).toContain('凭据获取完成');

    const passphrases = document.body.querySelectorAll<HTMLInputElement>('input[type="password"]');
    expect(passphrases).toHaveLength(2);
    await setInput(passphrases[0], 'local-vault-passphrase');
    await setInput(passphrases[1], 'local-vault-passphrase');
    clickButton('加密保存');
    await flushPromises();
    expect(saveToVault).toHaveBeenCalledWith('local-vault-passphrase');

    const acknowledgement = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!acknowledgement) throw new Error('Missing plaintext acknowledgement');
    await setInput(acknowledgement, true);
    clickButton('导出 credentialInfo.json');
    await flushPromises();
    expect(exportBundle).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it('restores an under-review prerequisite without polling and rechecks only on demand', async () => {
    readPrerequisite.mockResolvedValueOnce({
      status: 'prerequisite-required',
      reasonCode: 'developer-registration-under-review',
      checkedAtUtc: Date.now()
    });
    const Host = defineComponent({
      setup() {
        provideServices({
          gateway: new MockGatewayClient(0),
          settings: {
            load: () =>
              Promise.resolve({
                appKey: '',
                appSecret: '',
                accessToken: '',
                endpoint: ALIBABA_GATEWAY,
                signMethod: 'hmac'
              }),
            save: () => Promise.resolve()
          },
          vault: {
            status: () => Promise.resolve(vaultStatus('empty')),
            create: () => Promise.resolve(vaultStatus('unlocked')),
            migrate: () => Promise.resolve(vaultStatus('unlocked')),
            unlock: () => Promise.resolve(vaultStatus('unlocked')),
            lock: () => Promise.resolve(vaultStatus('locked')),
            rotate: () => Promise.resolve(vaultStatus('unlocked')),
            updatePolicy: () => Promise.resolve(vaultStatus('unlocked'))
          },
          alibabaCredentialAcquisition: {
            start,
            continue: continueAcquisition,
            status: statusAcquisition,
            cancel: cancelAcquisition,
            saveToVault,
            exportBundle,
            readPrerequisite,
            locatePrerequisiteField,
            focusPrerequisitePage
          },
          mode: 'extension'
        });
        return () => h(AlibabaCredentialAcquisitionDialog, { open: true });
      }
    });
    const wrapper = mount(Host, { attachTo: document.body });
    await flushPromises();

    expect(document.body.textContent).toContain('开发者注册正在审核中');
    expect(document.body.textContent).toContain('2–5 个工作日');
    expect(statusAcquisition).not.toHaveBeenCalled();

    clickButton('重新检查');
    await flushPromises();
    expect(start).toHaveBeenCalledWith(null);

    wrapper.unmount();
  });
});

function clickButton(label: string): void {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent.trim() === label || candidate.textContent.trim().startsWith(label)
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  button.click();
}

async function setInput(input: HTMLInputElement | undefined, value: string | boolean): Promise<void> {
  if (!input) throw new Error('Missing input');
  const eventValue = typeof value === 'boolean' ? value : undefined;
  if (eventValue !== undefined) input.checked = eventValue;
  else input.value = value as string;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await flushPromises();
}

function selectionState(): AlibabaCredentialAcquisitionState {
  return {
    status: 'selection-required',
    jobId: JOB_ID,
    expiresAtUtc: Date.now() + 600_000,
    applications: [
      {
        applicationId: 'application-1',
        appName: 'oneVegetable Online',
        appKeySuffix: '1234',
        status: 'Online',
        source: 'application-center'
      },
      {
        applicationId: 'application-2',
        appName: 'Legacy application',
        appKeySuffix: '5678',
        status: 'Legacy Online',
        source: 'legacy-crosstrade'
      }
    ]
  };
}

function callbackState(): AlibabaCredentialAcquisitionState {
  return {
    status: 'callback-confirmation-required',
    jobId: JOB_ID,
    expiresAtUtc: Date.now() + 600_000,
    currentUrl: 'https://seller.example.com/oauth/callback',
    requestedUrl: 'https://seller.example.com/oauth/callback'
  };
}

function completedState(): AlibabaCredentialAcquisitionState {
  return {
    status: 'completed',
    credential: {
      appName: 'oneVegetable Online',
      appKeySuffix: '1234',
      applicationStatus: 'Online',
      permissions: { total: 1, items: [{ name: 'Product read', status: 'authorized' }] },
      accessTokenExpiresTimeUtc: Date.now() + 3_600_000,
      refreshTokenExpiresTimeUtc: null
    }
  };
}

function failedState(): AlibabaCredentialAcquisitionState {
  return {
    status: 'failed',
    error: { code: 'ACQUISITION_CANCELLED', message: '已取消', retryable: false }
  };
}

function vaultStatus(state: CredentialVaultStatus['state']): CredentialVaultStatus {
  return {
    state,
    hasAppKey: state === 'unlocked',
    hasAppSecret: state === 'unlocked',
    hasAccessToken: state === 'unlocked',
    appKey: state === 'unlocked' ? '50001234' : '',
    endpoint: ALIBABA_GATEWAY,
    signMethod: 'hmac',
    idleTimeoutMinutes: state === 'unlocked' ? 0 : null,
    lastActivityAt: null,
    idleRemainingSeconds: null,
    lockReason: state === 'locked' ? 'manual' : null
  };
}

function bundle(): AlibabaOpenApiCredentialBundle {
  return {
    schemaVersion: 1,
    capturedAtUtc: '2026-08-30T00:00:00.000Z',
    application: {
      appName: 'oneVegetable Online',
      appKey: '50001234',
      appSecret: 'secret-value',
      callbackUrl: 'https://seller.example.com/oauth/callback',
      status: 'Online',
      permissions: [{ name: 'Product read', status: 'authorized' }]
    },
    oauth: {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAtUtc: null,
      refreshExpiresAtUtc: null
    },
    callback: {
      receivedAtUtc: '2026-08-30T00:00:00.000Z',
      stateMatched: true,
      callbackOrigin: 'https://seller.example.com',
      callbackPath: '/oauth/callback'
    }
  };
}
