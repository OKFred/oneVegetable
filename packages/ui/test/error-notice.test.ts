// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ALIBABA_GATEWAY, GatewayException } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import ErrorNotice from '../src/components/ErrorNotice.vue';
import { provideServices } from '../src/lib/services';

const requestId = '3d7c8523-93cc-48b7-a615-a23d2976c516';
const clipboardWrite = vi.fn(() => Promise.resolve());
const anchorClick = vi.fn();
let exportedBlob: Blob | null = null;

function mountErrorNotice(error: unknown, mode: 'mock' | 'extension') {
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
        mode
      });
      return () => h(ErrorNotice, { error });
    }
  });
  return mount(Host);
}

beforeEach(() => {
  exportedBlob = null;
  clipboardWrite.mockClear();
  anchorClick.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWrite }
  });
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      exportedBlob = blob;
      return 'blob:diagnostics';
    })
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(globalThis.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
    anchorClick();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorNotice', () => {
  it('copies requestId and exports only redacted diagnostic context', async () => {
    const secret = 'abcdefghijklmnopqrstuvwxyz0123456789-secret';
    const error = new GatewayException(
      {
        code: 'ALIBABA_ERROR',
        message: `access_token=${secret}`,
        traceId: 'trace-1',
        retryable: false
      },
      requestId
    );
    const wrapper = mountErrorNotice(error, 'mock');

    expect(wrapper.text()).toContain(requestId);
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(2);
    await buttons[0]?.trigger('click');
    expect(clipboardWrite).toHaveBeenCalledWith(requestId);

    await buttons[1]?.trigger('click');
    await flushPromises();
    await vi.waitFor(() => {
      expect(exportedBlob).not.toBeNull();
    });
    expect(anchorClick).toHaveBeenCalledOnce();
    const exported = await exportedBlob?.text();
    expect(exported).toContain(requestId);
    expect(exported).toContain('mock-diagnostic-1');
    expect(exported).not.toContain(secret);
  });

  it('links credential vault failures directly to extension settings', () => {
    const error = new GatewayException({
      code: 'CREDENTIAL_VAULT_EMPTY',
      message: '请先在设置中配置开放平台凭证',
      retryable: false
    });
    const wrapper = mountErrorNotice(error, 'extension');

    expect(wrapper.get('a[href="#/settings"]').text()).toContain('前往设置凭证');
    wrapper.unmount();
  });

  it('shows semicolon-separated platform reasons as a readable list with traceId', () => {
    const error = new GatewayException({
      code: 'PRODUCT_SCHEMA_INVALID',
      message: '商品名称不能为空; 主图至少需要一张；商品名称不能为空',
      traceId: 'alibaba-trace-1',
      retryable: false
    });
    const wrapper = mountErrorNotice(error, 'mock');

    expect(wrapper.text()).toContain('返回了 2 条原因');
    expect(wrapper.findAll('li').map((item) => item.text())).toEqual([
      '商品名称不能为空',
      '主图至少需要一张'
    ]);
    expect(wrapper.text()).toContain('traceId: alibaba-trace-1');
    wrapper.unmount();
  });
});
