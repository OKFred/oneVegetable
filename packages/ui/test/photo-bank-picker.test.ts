// @vitest-environment jsdom

import { defineComponent, h, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ALIBABA_GATEWAY, type Photo } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import PhotoBankPicker from '../src/components/PhotoBankPicker.vue';
import { provideServices } from '../src/lib/services';

afterEach(() => {
  globalThis.document.body.innerHTML = '';
});

describe('PhotoBankPicker', () => {
  it('keeps uploading separate from selecting a product image', async () => {
    const selected = ref<Photo[]>([]);
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
          mode: 'mock'
        });
        return () =>
          h(PhotoBankPicker, {
            modelValue: selected.value,
            max: 1,
            'onUpdate:modelValue': (photos: Photo[]) => {
              selected.value = photos;
            }
          });
      }
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = mount(Host, {
      attachTo: globalThis.document.body,
      global: { plugins: [[VueQueryPlugin, { queryClient }]] }
    });

    await wrapper.get('button').trigger('click');
    await flushPromises();
    clickBodyButton('上传新素材');
    await flushPromises();

    const urlInput = globalThis.document.body.querySelector<HTMLInputElement>(
      'input[aria-label="外部图片 URL"]'
    );
    if (!urlInput) throw new Error('Missing external photo URL input');
    urlInput.value = 'https://example.com/photo.jpg';
    urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    clickBodyButton('下载并存入图库');

    await vi.waitFor(() => {
      expect(globalThis.document.body.textContent).toContain('已转存到图库');
      expect(globalThis.document.body.textContent).toContain('请在素材列表中选择');
    });
    expect(selected.value).toEqual([]);
    wrapper.unmount();
  });
});

function clickBodyButton(label: string): void {
  const button = Array.from(globalThis.document.body.querySelectorAll('button')).find((candidate) =>
    candidate.textContent.includes(label)
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  button.click();
}
