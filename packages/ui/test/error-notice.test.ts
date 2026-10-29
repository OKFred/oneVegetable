// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ALIBABA_GATEWAY, GatewayException } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import ErrorNotice from '../src/components/ErrorNotice.vue';
import { uiI18n } from '../src/i18n';
import s3Errors from '../../../mock/data/gallery-s3-errors.json';
import { provideServices } from '../src/lib/services';
import type { AppServices } from '../src/lib/services';
import type { MediaErrorFeature } from '../src/lib/media-error-guidance';

const requestId = '3d7c8523-93cc-48b7-a615-a23d2976c516';
const clipboardWrite = vi.fn(() => Promise.resolve());
const anchorClick = vi.fn();
let exportedBlob: Blob | null = null;

function mountErrorNotice(
  error: unknown,
  mode: 'mock' | 'extension' | 'bff',
  options: { mediaFeature?: MediaErrorFeature; runtime?: AppServices['runtime'] } = {}
) {
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
        mode,
        ...(options.runtime ? { runtime: options.runtime } : {})
      });
      return () =>
        h(ErrorNotice, { error, ...(options.mediaFeature ? { mediaFeature: options.mediaFeature } : {}) });
    }
  });
  return mount(Host);
}

beforeEach(() => {
  uiI18n.global.locale.value = 'zh-CN';
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
  uiI18n.global.locale.value = 'zh-CN';
  vi.restoreAllMocks();
});

describe('ErrorNotice', () => {
  it.each(['extension', 'bff'] as const)(
    'offers explicit media next actions in %s without requests',
    async (mode) => {
      const requests = vi.spyOn(MockGatewayClient.prototype, 'request');
      const wrapper = mountErrorNotice(
        new GatewayException({
          code: 'ALIBABA_IOP_BUSINESS_REJECTED',
          message: 'illegal param error',
          retryable: false
        }),
        mode,
        { mediaFeature: 'videos' }
      );
      expect(wrapper.get('[data-testid="media-authorization-settings"]').attributes('href')).toBe(
        '#/settings'
      );
      expect(wrapper.get('[data-testid="media-official-page"]').attributes()).toMatchObject({
        href: 'https://us-productposting.alibaba.com/product/videobank/home.htm',
        target: '_blank',
        rel: 'noopener noreferrer'
      });
      expect(wrapper.text()).toContain('不能据此认定缺少权限');
      expect(wrapper.get('details').text()).toContain('illegal param error');
      uiI18n.global.locale.value = 'en-US';
      await flushPromises();
      expect(wrapper.get('[data-testid="media-error-guidance"]').text()).toContain('No automatic retry');
      expect(wrapper.text()).not.toContain('common.error.');
      expect(requests).not.toHaveBeenCalled();
      wrapper.unmount();
    }
  );
  it('points Cloudflare media configuration to the existing admin page', () => {
    const wrapper = mountErrorNotice(
      new GatewayException({
        code: 'GALLERY_READBACK_UNVERIFIED',
        message: 'GALLERY_READBACK_UNVERIFIED',
        retryable: false
      }),
      'bff',
      {
        runtime: {
          backendMeta: {
            runtime: 'cloudflare',
            database: 'd1',
            environment: 'self-hosted',
            gatewayMode: 'real',
            apiPrefix: '/api/v1',
            version: 'test'
          },
          metaStatus: 'ready'
        }
      }
    );
    expect(wrapper.get('[data-testid="media-authorization-settings"]').attributes('href')).toBe('#/admin');
    expect(wrapper.text()).toContain('已停止后续上传和建目录');
    wrapper.unmount();
  });
  it('does not suggest TOP for an unrelated IOP mutation rejection', () => {
    const wrapper = mountErrorNotice(
      new GatewayException({ code: 'ALIBABA_IOP_BUSINESS_REJECTED', message: 'rejected', retryable: false }),
      'extension'
    );
    expect(wrapper.find('[data-testid="media-error-guidance"]').exists()).toBe(false);
    wrapper.unmount();
  });
  it.each([
    'ALIBABA_PROTOCOL_INVALID',
    'ALIBABA_IOP_METHOD_UNSUPPORTED',
    'ALIBABA_IOP_PARAMETER_UNSUPPORTED',
    'ALIBABA_IOP_MUTATION_UNVERIFIED',
    'ALIBABA_IOP_BUSINESS_REJECTED',
    'ALIBABA_IOP_PHOTO_GROUP_REQUIRED',
    'ALIBABA_IOP_PHOTO_SCOPE_MISMATCH',
    'ALIBABA_PROTOCOL_ENDPOINT_MISMATCH',
    'ALIBABA_IOP_RESPONSE_INVALID',
    'ALIBABA_IOP_API_REJECTED'
  ])('provides a safe bilingual description for %s', async (code) => {
    const wrapper = mountErrorNotice(
      new GatewayException({ code, message: code, retryable: false }),
      'extension'
    );
    expect(wrapper.text()).not.toContain('errors.codes.');
    const chinese = wrapper.text();
    if (code === 'ALIBABA_IOP_PHOTO_SCOPE_MISMATCH') {
      expect(chinese).toContain('阿里平台 IOP 图片分组查询暂有异常。');
      expect(chinese).toContain('可使用 TOP 授权，或前往国际站查看。');
      expect(chinese).not.toContain('还没开发完');
      expect(chinese).not.toContain('分组新增、改名');
    }
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(wrapper.text()).not.toBe(chinese);
    expect(wrapper.text()).not.toContain('errors.codes.');
    if (code === 'ALIBABA_IOP_PHOTO_GROUP_REQUIRED')
      expect(wrapper.text()).toContain('Choose a specific group');
    if (code === 'ALIBABA_IOP_PHOTO_SCOPE_MISMATCH') {
      expect(wrapper.text()).toContain('Alibaba IOP image-group queries are currently unreliable.');
      expect(wrapper.text()).toContain('TOP authorization');
      expect(wrapper.text()).not.toContain('Group creation, renaming');
    }
    if (code === 'ALIBABA_IOP_PARAMETER_UNSUPPORTED')
      expect(wrapper.text()).toContain('never silently ignored');
    if (code === 'ALIBABA_IOP_MUTATION_UNVERIFIED') expect(wrapper.text()).toContain('remains disabled');
    if (code === 'ALIBABA_IOP_BUSINESS_REJECTED') expect(wrapper.text()).toContain('do not resubmit');
    wrapper.unmount();
  });
  it.each([
    '27',
    'invalid-sessionkey',
    'isv.invalid-session',
    'ALIBABA_ACCESS_TOKEN_EXPIRED',
    'ALIBABA_REFRESH_TOKEN_EXPIRED',
    'ALIBABA_TOKEN_REFRESH_FAILED'
  ])('offers Alibaba renewal for %s without retrying a request', async (code) => {
    const wrapper = mountErrorNotice(
      new GatewayException({ code, message: 'provider authorization response', retryable: false }, requestId),
      'extension'
    );
    expect(wrapper.get('[data-testid="alibaba-reconnect"]').attributes('href')).toBe('#/settings');
    expect(wrapper.text()).toContain('网页登录不等于 API 授权');
    expect(wrapper.text()).toContain(requestId);
    expect(wrapper.get('details').text()).toContain('provider authorization response');
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(wrapper.get('[data-testid="alibaba-reconnect"]').text()).toBe('Reconnect Alibaba');
    expect(wrapper.text()).toContain('Do not resubmit previous writes');
    wrapper.unmount();
  });

  it.each([
    'SESSION_EXPIRED',
    'SESSION_INVALID',
    'CREDENTIAL_VAULT_LOCKED',
    'PERMISSION_DENIED',
    'GATEWAY_ERROR'
  ])('does not confuse %s with expired Alibaba authorization', (code) => {
    const wrapper = mountErrorNotice(
      new GatewayException({ code, message: 'unrelated failure', retryable: false }),
      'extension'
    );
    expect(wrapper.find('[data-testid="alibaba-reconnect"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('guides BFF users to admin-managed credential renewal, not workbench sign-out', () => {
    const wrapper = mountErrorNotice(
      new GatewayException({ code: '27', message: 'Invalid session', retryable: false }),
      'bff'
    );
    expect(wrapper.text()).toContain('请管理员尝试刷新 Token');
    expect(wrapper.text()).toContain('无需退出工作台');
    wrapper.unmount();
  });
  it('explains the local HTTP server opt-in without implying that cloud runtimes can enable it', async () => {
    const wrapper = mountErrorNotice(new GatewayException(s3Errors.localHttpDisabled), 'mock');
    expect(wrapper.text()).toContain('本地 Node 需显式开启');
    expect(wrapper.text()).toContain('云端 Worker 不支持');
    expect(wrapper.text()).toContain('ONE_VEGETABLE_ALLOW_LOCAL_S3_HTTP=1');
    expect(wrapper.get('a').attributes('href')).toBe('#/settings');
    expect(wrapper.text()).not.toContain('errors.codes.');
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(wrapper.text()).toContain(uiI18n.global.t('settings.s3.localHttp'));
    expect(wrapper.get('a').text()).toBe('S3 asset storage');
    wrapper.unmount();
  });
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

  it('localizes a known gateway code while preserving the Alibaba response', () => {
    uiI18n.global.locale.value = 'en-US';
    const error = new GatewayException({
      code: 'ALIBABA_ERROR',
      message: '访问令牌无效',
      retryable: false
    });
    const wrapper = mountErrorNotice(error, 'mock');

    expect(wrapper.text()).toContain('The Alibaba API returned an error.');
    expect(wrapper.get('summary').text()).toBe('Platform response');
    expect(wrapper.text()).toContain('访问令牌无效');
    wrapper.unmount();
  });
});
