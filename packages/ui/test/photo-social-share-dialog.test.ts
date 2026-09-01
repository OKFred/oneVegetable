// @vitest-environment jsdom

import { defineComponent, h, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { toast } from 'vue-sonner';

import type { Photo } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import PhotoSocialShareDialog from '../src/components/PhotoSocialShareDialog.vue';
import { provideServices } from '../src/lib/services';

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn() }
}));

const photo: Photo = {
  id: 'ph_001',
  name: 'solar-station-front.jpg',
  url: 'https://sc04.alicdn.com/kf/mock-solar-station.jpg',
  previewUrl: 'mock-asset:solar-station-front.svg',
  groupId: '2001',
  width: 1200,
  height: 1200,
  fileSize: 4,
  referenceCount: 4,
  modifiedAt: '2026-08-11T03:20:00Z'
};

describe('PhotoSocialShareDialog', () => {
  it('prepares original files before user activation and hands them to system share', async () => {
    const share = vi.fn<(data: ShareData) => Promise<void>>((_data) => Promise.resolve());
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn(() => true) });
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    const wrapper = mountDialog();

    await flushPromises();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('系统支持原图分享');
      expect(document.body.textContent).toContain('Instagram 专业账号');
      expect(document.body.textContent).toContain('照片仅支持从已验证域名的公共 URL 拉取');
    });
    await clickBodyButton('使用系统分享');
    await vi.waitFor(() => {
      expect(share).toHaveBeenCalledOnce();
    });
    const payload = share.mock.calls[0]?.[0];
    expect(payload?.files).toHaveLength(1);
    expect(payload?.files?.[0]).toMatchObject({ name: 'mock-product-asset.jpg', type: 'image/jpeg' });
    expect(toast.success).toHaveBeenCalledWith('素材已交给系统分享面板；最终发布仍由所选应用确认');
    wrapper.unmount();
  });
});

function mountDialog() {
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway: new MockGatewayClient(0),
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        mode: 'mock'
      });
      const open = ref(true);
      return () =>
        h(PhotoSocialShareDialog, {
          open: open.value,
          photos: [photo],
          'onUpdate:open': (value: boolean) => {
            open.value = value;
          }
        });
    }
  });
  return mount(Host, { attachTo: document.body });
}

async function clickBodyButton(label: string): Promise<void> {
  const match = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent.trim() === label
  );
  if (!match) throw new Error(`Missing button: ${label}`);
  match.click();
  await flushPromises();
}

function settings() {
  return {
    appKey: '',
    appSecret: '',
    accessToken: '',
    endpoint: 'https://eco.taobao.com/router/rest',
    signMethod: 'hmac' as const
  };
}
