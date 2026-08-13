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

function mountView() {
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
        mode: 'mock'
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
});
