// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ALIBABA_GATEWAY } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import type { AlibabaCredentialAcquisitionState, ControlClient } from '@one-vegetable/core';

import AlibabaCloudCredentialAcquisitionDialog from '../src/components/AlibabaCloudCredentialAcquisitionDialog.vue';
import { provideServices } from '../src/lib/services';

type RunningState = Extract<AlibabaCredentialAcquisitionState, { status: 'running' }>;
type SelectionState = Extract<AlibabaCredentialAcquisitionState, { status: 'selection-required' }>;
type CallbackState = Extract<AlibabaCredentialAcquisitionState, { status: 'callback-confirmation-required' }>;
type FailedState = Extract<AlibabaCredentialAcquisitionState, { status: 'failed' }>;

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('AlibabaCloudCredentialAcquisitionDialog', () => {
  it('offers the local extension without starting Browser Run', async () => {
    const start = vi.fn(() => Promise.resolve(runningState()));
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null);
    const wrapper = mountDialog({ startAlibabaCredentialAcquisition: start });
    await flushPromises();

    clickButton('使用本机插件');
    await flushPromises();
    expect(start).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('不会占用 Browser Run 额度');
    clickButton('打开 Chrome 商店');
    expect(open).toHaveBeenCalledOnce();

    clickButton('返回');
    await flushPromises();
    expect(document.body.textContent).toContain('云端自动获取');
    wrapper.unmount();
  });

  it('clears website credentials, supports application and callback choices, then falls back to extension', async () => {
    const start = vi.fn(() => Promise.resolve(selectionState()));
    const continueAcquisition = vi
      .fn<(jobId: string, command: Record<string, unknown>) => Promise<AlibabaCredentialAcquisitionState>>()
      .mockResolvedValueOnce(callbackState())
      .mockResolvedValueOnce({ status: 'extension-required', reasonCode: 'slider' });
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null);
    const wrapper = mountDialog({
      startAlibabaCredentialAcquisition: start,
      continueAlibabaCredentialAcquisition: continueAcquisition
    });
    await flushPromises();

    const inputs = [...document.body.querySelectorAll<HTMLInputElement>('input')];
    if (inputs.length < 3) throw new Error('credential form inputs missing');
    await input(inputs[0], 'website-account@example.com');
    await input(inputs[1], 'website-password');
    await input(inputs[2], '');
    clickButton('云端自动获取');
    await flushPromises();

    expect(start).toHaveBeenCalledWith({
      account: 'website-account@example.com',
      password: 'website-password',
      callbackUrl: null
    });
    expect(document.body.textContent).not.toContain('website-account@example.com');
    expect(document.body.textContent).not.toContain('website-password');
    expect(document.body.textContent).toContain('选择已有应用');

    clickButton('Application B', 'contains');
    await flushPromises();
    expect(continueAcquisition).toHaveBeenNthCalledWith(1, '11111111-1111-4111-8111-111111111111', {
      type: 'select-application',
      applicationId: 'application-center:2'
    });
    expect(document.body.textContent).toContain('https://old.example.com/callback');
    expect(document.body.textContent).toContain('https://new.example.com/callback');

    clickButton('保留现有地址');
    await flushPromises();
    expect(continueAcquisition).toHaveBeenNthCalledWith(2, '11111111-1111-4111-8111-111111111111', {
      type: 'confirm-callback-change',
      confirmed: false
    });
    expect(document.body.textContent).toContain('Alibaba 要求完成滑块验证');
    expect(document.body.textContent).toContain('credentialInfo.json');

    clickButton('打开 Chrome 商店');
    expect(open).toHaveBeenCalledWith(
      'https://chromewebstore.google.com/detail/aepfdoldflokikbbcpnfifkacpfakmjc',
      '_blank',
      'noopener,noreferrer'
    );
    wrapper.unmount();
  });

  it('cancels an active cloud task when the dialog is closed', async () => {
    const cancel = vi.fn(() => Promise.resolve(failedState()));
    const wrapper = mountDialog({
      startAlibabaCredentialAcquisition: () => Promise.resolve(runningState()),
      cancelAlibabaCredentialAcquisition: cancel,
      alibabaCredentialAcquisitionStatus: () => Promise.resolve(runningState())
    });
    await flushPromises();
    const inputs = [...document.body.querySelectorAll<HTMLInputElement>('input')];
    if (inputs.length < 2) throw new Error('credential form inputs missing');
    await input(inputs[0], 'account');
    await input(inputs[1], 'password');
    clickButton('云端自动获取');
    await flushPromises();
    clickAriaButton('关闭一键连接 Alibaba');
    await flushPromises();
    expect(cancel).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    wrapper.unmount();
  });

  it('stops cloud polling and explains an under-review developer prerequisite', async () => {
    const status = vi.fn(() => Promise.resolve(runningState()));
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null);
    const wrapper = mountDialog({
      startAlibabaCredentialAcquisition: () =>
        Promise.resolve({
          status: 'prerequisite-required',
          reasonCode: 'developer-registration-under-review',
          checkedAtUtc: Date.now()
        }),
      alibabaCredentialAcquisitionStatus: status
    });
    await flushPromises();
    const inputs = [...document.body.querySelectorAll<HTMLInputElement>('input')];
    if (inputs.length < 2) throw new Error('credential form inputs missing');
    await input(inputs[0], 'account');
    await input(inputs[1], 'password');

    clickButton('云端自动获取');
    await flushPromises();

    expect(document.body.textContent).toContain('开发者注册正在审核中');
    expect(document.body.textContent).toContain('2–5 个工作日');
    expect(status).not.toHaveBeenCalled();
    clickButton('返回注册页面');
    expect(open).toHaveBeenCalledWith(
      'https://i.alibaba.com/explore/open-api',
      '_blank',
      'noopener,noreferrer'
    );
    wrapper.unmount();
  });
});

function mountDialog(controlPatch: Partial<ControlClient>) {
  const control = controlPatch as ControlClient;
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
        control,
        mode: 'bff'
      });
      return () => h(AlibabaCloudCredentialAcquisitionDialog, { open: true });
    }
  });
  return mount(Host, { attachTo: document.body });
}

function clickButton(label: string, match: 'exact' | 'contains' = 'exact'): void {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
    match === 'contains'
      ? candidate.textContent.trim().includes(label)
      : candidate.textContent.trim() === label
  );
  if (!button) throw new Error(`button missing: ${label}`);
  button.click();
}

function clickAriaButton(label: string): void {
  const button = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw new Error(`button missing: ${label}`);
  button.click();
}

async function input(element: HTMLInputElement | undefined, value: string): Promise<void> {
  if (!element) throw new Error('input missing');
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  await flushPromises();
}

function runningState(): RunningState {
  return {
    status: 'running',
    jobId: '11111111-1111-4111-8111-111111111111',
    expiresAtUtc: Date.now() + 60_000
  };
}

function selectionState(): SelectionState {
  return {
    ...runningState(),
    status: 'selection-required',
    applications: [
      {
        applicationId: 'application-center:1',
        appName: 'Application A',
        appKeySuffix: '0001',
        status: 'Online',
        source: 'application-center'
      },
      {
        applicationId: 'application-center:2',
        appName: 'Application B',
        appKeySuffix: '0002',
        status: 'Online',
        source: 'application-center'
      }
    ]
  };
}

function callbackState(): CallbackState {
  return {
    ...runningState(),
    status: 'callback-confirmation-required',
    currentUrl: 'https://old.example.com/callback',
    requestedUrl: 'https://new.example.com/callback'
  };
}

function failedState(): FailedState {
  return {
    status: 'failed',
    error: { code: 'ACQUISITION_CANCELLED', message: 'cancelled', retryable: false }
  };
}
