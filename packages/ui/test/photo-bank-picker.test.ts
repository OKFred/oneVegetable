// @vitest-environment jsdom

import { defineComponent, h, ref, type Ref } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
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
    const wrapper = mountPicker(selected);

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
      expect(globalThis.document.body.textContent).toContain('photo.jpg');
    });
    expect(selected.value).toEqual([]);
    wrapper.unmount();
  });

  it('keeps multiple selected product images in one horizontal strip', () => {
    const selected = ref<Photo[]>([
      photo('photo-1', 'front.jpg'),
      photo('photo-2', 'side.jpg'),
      photo('photo-3', 'package.jpg')
    ]);
    const wrapper = mountPicker(selected, 6);

    const strip = wrapper.get('[data-testid="selected-photo-strip"]');
    expect(strip.classes()).toEqual(expect.arrayContaining(['flex', 'overflow-auto']));
    expect(strip.findAll('img')).toHaveLength(3);
    expect(strip.findAll('.shrink-0')).toHaveLength(3);
    wrapper.unmount();
  });
});

function mountPicker(selected: Ref<Photo[]>, max = 1): VueWrapper {
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
          max,
          'onUpdate:modelValue': (photos: Photo[]) => {
            selected.value = photos;
          }
        });
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(Host, {
    attachTo: globalThis.document.body,
    global: { plugins: [[VueQueryPlugin, { queryClient }]] }
  });
}

function photo(id: string, name: string): Photo {
  return {
    id,
    name,
    url: `https://sc04.alicdn.com/kf/${name}`,
    groupId: '-1',
    width: 800,
    height: 800,
    fileSize: 1024,
    referenceCount: 0,
    modifiedAt: '2026-08-26T00:00:00.000Z'
  };
}

function clickBodyButton(label: string): void {
  const button = Array.from(globalThis.document.body.querySelectorAll('button')).find((candidate) =>
    candidate.textContent.includes(label)
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  button.click();
}
