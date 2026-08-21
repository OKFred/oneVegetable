// @vitest-environment jsdom

import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { MockGatewayClient } from '@one-vegetable/core/mock';

import ImagePreview from '../src/components/ImagePreview.vue';

describe('ImagePreview', () => {
  it('supports navigation, zoom, rotation, reset and close actions', async () => {
    const open = ref(true);
    const photos = await new MockGatewayClient(0).request('listPhotos', {
      page: 1,
      pageSize: 2,
      groupId: '-1'
    });
    const images = photos.items.slice(0, 2).map((photo) => ({
      id: photo.id,
      src: photo.url,
      alt: photo.name,
      description: `${photo.width} × ${photo.height}`
    }));
    const [first, second] = images;
    if (!first || !second) throw new Error('Central PhotoBank Mock must contain at least two images');
    const Host = defineComponent({
      setup() {
        return () =>
          h(ImagePreview, {
            open: open.value,
            images,
            'onUpdate:open': (value: boolean) => {
              open.value = value;
            }
          });
      }
    });
    const wrapper = mount(Host, { attachTo: document.body });
    await nextTick();

    expect(document.body.querySelector<HTMLImageElement>(`img[alt="${first.alt}"]`)).not.toBeNull();
    expect(document.body.textContent).toContain('1 / 2');

    document.body.querySelector<HTMLButtonElement>('button[aria-label="放大图片"]')?.click();
    await nextTick();
    expect(document.body.textContent).toContain('125%');

    document.body.querySelector<HTMLButtonElement>('button[aria-label="下一张图片"]')?.click();
    await nextTick();
    expect(document.body.querySelector<HTMLImageElement>(`img[alt="${second.alt}"]`)).not.toBeNull();
    expect(document.body.textContent).toContain('2 / 2');

    document.body.querySelector<HTMLButtonElement>('button[aria-label="向右旋转"]')?.click();
    await nextTick();
    expect(
      document.body.querySelector<HTMLImageElement>(`img[alt="${second.alt}"]`)?.style.transform
    ).toContain('rotate(90deg)');

    document.body.querySelector<HTMLButtonElement>('button[aria-label="复位图片"]')?.click();
    await nextTick();
    expect(document.body.querySelector<HTMLImageElement>(`img[alt="${second.alt}"]`)?.style.transform).toBe(
      'scale(1) rotate(0deg)'
    );

    document.body.querySelector<HTMLButtonElement>('button[aria-label="关闭图片预览"]')?.click();
    await nextTick();
    expect(open.value).toBe(false);
    wrapper.unmount();
  });
});
