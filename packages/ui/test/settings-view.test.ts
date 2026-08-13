// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ALIBABA_GATEWAY, MockGatewayClient } from '@one-vegetable/core';

import SettingsView from '../src/views/SettingsView.vue';
import { provideServices } from '../src/lib/services';

const anchorClick = vi.fn();
const createObjectUrl = vi.fn(() => 'blob:diagnostics');
const revokeObjectUrl = vi.fn();
const clearAllLocalData = vi.fn(() => Promise.resolve());

function mountView(mode: 'mock' | 'extension' = 'mock') {
  let grantedHosts = ['https://images.example.com/*'];
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
                  label: '开放平台凭证与网关设置',
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
      expect(wrapper.text()).toContain('开放平台凭证与网关设置');
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
});
