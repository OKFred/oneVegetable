// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { VideoAssociationResult } from '@one-vegetable/core/video-association';
import type { GatewayClient } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { VIDEO_MOCK_DATA } from '../../core/src/generated/mock-data';
import ProductVideoAssociation from '../src/components/ProductVideoAssociation.vue';
import ConfirmActionDialog from '../src/components/ConfirmActionDialog.vue';
import { provideServices, type AppServices } from '../src/lib/services';
import { pageDetailIdentity } from '../src/lib/page-details';
import { GATEWAY_CONFIGURATION_EVENT } from '../src/lib/gateway-configuration-events';
import {
  VIDEO_ASSOCIATION_PREFIX,
  clearVideoAssociationLocalData
} from '../src/lib/video-association-storage';
import type { VideoAssociationReceipt } from '../src/lib/product-video-association';

const video = VIDEO_MOCK_DATA.responses.listVideos.items[0];
if (!video?.id || !video.encryptedId) throw new Error('Missing fixture');
const fixture = { ...video, id: video.id, encryptedId: video.encryptedId };
const target = {
  productId: '10000001',
  videoId: fixture.id,
  encryptedVideoId: fixture.encryptedId,
  type: 'main' as const,
  language: 'en_US' as const
};
const wrappers: VueWrapper[] = [];
function requestSpy(gateway: GatewayClient) {
  return vi.spyOn(gateway, 'request');
}
function readStored(key: string): unknown {
  return JSON.parse(localStorage.getItem(key) ?? 'null');
}
let held = false;
beforeEach(() => {
  localStorage.clear();
  held = false;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: vi.fn(
        async (_name: string, _options: unknown, run: (lock: object | null) => Promise<unknown>) => {
          if (held) return run(null);
          held = true;
          try {
            return await run({});
          } finally {
            held = false;
          }
        }
      )
    }
  });
});
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  vi.restoreAllMocks();
});

function setup(
  options: {
    mode?: AppServices['mode'];
    availability?: 'missing' | 'denied';
    productId?: string;
    gateway?: MockGatewayClient;
  } = {}
) {
  const gateway = options.gateway ?? new MockGatewayClient(0);
  const get = vi.fn((operations: Parameters<NonNullable<AppServices['operationAvailability']>['get']>[0]) =>
    Promise.resolve({
      items: operations.map((operation) => ({
        operation,
        allowed: options.availability !== 'denied',
        reasonCode: options.availability === 'denied' ? 'PERMISSION_DENIED' : null
      }))
    })
  );
  const Host = defineComponent({
    props: { productId: { type: String, default: '10000001' }, language: { type: String, default: 'en_US' } },
    setup(props) {
      provideServices({
        gateway,
        mode: options.mode ?? 'mock',
        settings: { load: vi.fn(), save: vi.fn() },
        ...(options.availability === 'missing' ? {} : { operationAvailability: { get } })
      });
      return () =>
        h(ProductVideoAssociation, {
          productId: props.productId,
          language: props.language === 'zh_CN' ? 'zh_CN' : 'en_US'
        });
    }
  });
  const wrapper = mount(Host, {
    props: { productId: options.productId ?? '10000001' },
    global: {
      stubs: {
        VideoDrawer: true,
        VideoPicker: {
          setup: () => ({ fixture }),
          template: '<button data-testid="picker-stub" @click="$emit(\'select\', fixture)">Pick</button>'
        },
        ActionTooltip: {
          props: ['reason', 'disabled'],
          template: '<span :title="disabled ? reason : undefined"><slot/></span>'
        },
        ConfirmActionDialog: {
          props: ['open', 'description', 'pending'],
          template:
            '<div v-if="open" data-testid="confirmation"><p>{{ description }}</p><slot/><button data-testid="confirm" :disabled="pending" @click="$emit(\'confirm\')">Confirm</button></div>'
        }
      }
    }
  });
  wrappers.push(wrapper);
  return { wrapper, gateway, get };
}
async function choose(wrapper: VueWrapper) {
  await flushPromises();
  const button = wrapper.findAll('button').find((b) => b.text() === '选择视频');
  if (!button) throw new Error('No picker entry');
  await button.trigger('click');
  await wrapper.get('[data-testid="picker-stub"]').trigger('click');
  await flushPromises();
}
async function submit(wrapper: VueWrapper) {
  await choose(wrapper);
  await wrapper.get('[data-testid="associate-video"]').trigger('click');
  await wrapper.get('[data-testid="confirm"]').trigger('click');
  await flushPromises();
}
async function seed(
  gateway: MockGatewayClient,
  state: VideoAssociationReceipt['state'] = 'sending',
  mode: AppServices['mode'] = 'mock'
) {
  const identity = await pageDetailIdentity(gateway, mode);
  const key = VIDEO_ASSOCIATION_PREFIX + JSON.stringify([mode, identity, target.productId]);
  const receipt: VideoAssociationReceipt = {
    version: 1,
    requestId: 'receipt-original',
    request: target,
    state,
    outcome: state === 'sending' ? 'unknown' : state,
    code: null,
    traceId: null,
    updatedAt: Date.now()
  };
  localStorage.setItem(key, JSON.stringify(receipt));
  return key;
}

describe('product video association component', () => {
  it.each(['main', 'detail'] as const)(
    'confirms a separate %s write, persists before send, and never saves or publishes',
    async (type) => {
      const { wrapper, gateway } = setup();
      const original = gateway.request.bind(gateway);
      const request = requestSpy(gateway).mockImplementation(async (...args) => {
        if (args[0] === 'associateProductVideo') {
          const key = Object.keys(localStorage).find((key) => key.startsWith(VIDEO_ASSOCIATION_PREFIX));
          expect(key).toBeTruthy();
          const stored = readStored(key ?? '');
          expect(stored).toMatchObject({
            state: 'sending',
            requestId: args[2]?.requestId,
            request: { ...target, type }
          });
          expect(JSON.stringify(stored)).not.toContain('"confirmed"');
          expect(JSON.stringify(stored)).not.toContain('videoUrl');
        }
        return original(args[0], args[1]);
      });
      await choose(wrapper);
      await wrapper.get('select').setValue(type);
      await wrapper.get('[data-testid="associate-video"]').trigger('click');
      expect(request).not.toHaveBeenCalled();
      expect(wrapper.get('[data-testid="confirmation"]').text()).toContain('独立、立即生效');
      expect(wrapper.getComponent(ConfirmActionDialog).props('open')).toBe(true);
      // Confirmation freezes the use even if a UI event changes the selector afterwards.
      await wrapper.get('select').setValue(type === 'main' ? 'detail' : 'main');
      await wrapper.get('[data-testid="confirm"]').trigger('click');
      await flushPromises();
      expect(request).toHaveBeenCalledExactlyOnceWith(
        'associateProductVideo',
        { ...target, type, confirmed: true },
        expect.anything()
      );
      expect(request.mock.calls[0]?.[2]?.requestId).toEqual(expect.any(String));
      expect(wrapper.get('[data-testid="video-association-receipt"]').text()).toContain('回读已确认');
      expect(wrapper.getComponent(ProductVideoAssociation).emitted('submit')).toBeUndefined();
    }
  );

  it.each(['unknown', 'unconfirmed'] as const)(
    'retains %s across remount and verifies manually without resending',
    async (outcome) => {
      const gateway = new MockGatewayClient(0);
      const request = requestSpy(gateway).mockResolvedValue({ outcome, traceId: 'trace-1', code: null });
      const first = setup({ gateway });
      await submit(first.wrapper);
      expect(first.wrapper.get('[data-testid="associate-video"]').attributes('disabled')).toBeDefined();
      first.wrapper.unmount();
      const again = setup({ gateway });
      await flushPromises();
      expect(request).toHaveBeenCalledTimes(1);
      expect(again.wrapper.text()).toContain('requestId:');
      request.mockResolvedValueOnce({ outcome: 'confirmed', traceId: 'readback', code: null });
      await again.wrapper.get('[data-testid="verify-video"]').trigger('click');
      await flushPromises();
      expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls[1]).toEqual(['verifyProductVideoAssociation', target, expect.anything()]);
      expect(request.mock.calls[1]?.[2]?.requestId).not.toBe(request.mock.calls[0]?.[2]?.requestId);
      expect(again.wrapper.text()).toContain('回读已确认');
    }
  );

  it('recovers interrupted sending as unknown without any automatic gateway calls', async () => {
    const gateway = new MockGatewayClient(0),
      key = await seed(gateway);
    const request = vi.spyOn(gateway, 'request');
    const { wrapper } = setup({ gateway });
    await flushPromises();
    expect(readStored(key)).toMatchObject({ state: 'unknown' });
    expect(wrapper.text()).toContain('结果不明');
    expect(request).not.toHaveBeenCalled();
  });

  it('does not declare another tab interrupted while its lock is held', async () => {
    const gateway = new MockGatewayClient(0),
      key = await seed(gateway);
    held = true;
    const { wrapper } = setup({ gateway });
    await flushPromises();
    expect(readStored(key)).toMatchObject({ state: 'sending' });
    expect(wrapper.text()).toContain('正在单次发送');
  });

  it('does not retry timeouts and keeps a rejected verification blocking', async () => {
    const { wrapper, gateway } = setup();
    const request = vi.spyOn(gateway, 'request').mockRejectedValueOnce(new Error('timeout'));
    await submit(wrapper);
    expect(request).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('结果不明');
    request.mockResolvedValueOnce({ outcome: 'rejected', traceId: null, code: 'PERMISSION_DENIED' });
    await wrapper.get('[data-testid="verify-video"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="associate-video"]').attributes('disabled')).toBeDefined();
    expect(request.mock.calls.map(([op]) => op)).toEqual([
      'associateProductVideo',
      'verifyProductVideoAssociation'
    ]);
  });

  it('fails closed for corrupt receipts and never erases them', async () => {
    const gateway = new MockGatewayClient(0),
      key = await seed(gateway);
    localStorage.setItem(key, '{broken');
    const request = vi.spyOn(gateway, 'request');
    const { wrapper } = setup({ gateway });
    await flushPromises();
    expect(wrapper.text()).toContain('本地回执无法读取或保存');
    expect(wrapper.get('[data-testid="associate-video"]').attributes('disabled')).toBeDefined();
    expect(localStorage.getItem(key)).toBe('{broken');
    expect(request).not.toHaveBeenCalled();
  });

  it('fails closed before send on storage failure or unavailable locks', async () => {
    const { wrapper, gateway } = setup();
    const request = vi.spyOn(gateway, 'request');
    await choose(wrapper);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await wrapper.get('[data-testid="associate-video"]').trigger('click');
    await wrapper.get('[data-testid="confirm"]').trigger('click');
    await flushPromises();
    expect(request).not.toHaveBeenCalled();
  });

  it.each(['missing', 'denied'] as const)(
    'defaults closed with a localized tooltip when availability is %s',
    async (availability) => {
      const { wrapper, gateway } = setup({ availability });
      const request = vi.spyOn(gateway, 'request');
      await choose(wrapper);
      expect(wrapper.get('[data-testid="associate-video"]').attributes('disabled')).toBeDefined();
      expect(
        wrapper.get('[data-testid="associate-video"]').element.parentElement?.getAttribute('title')
      ).toContain('尚未开放');
      expect(request).not.toHaveBeenCalled();
    }
  );

  it.each(['bff', 'extension'] as const)(
    'keeps real %s writes off even if availability erroneously allows them',
    async (mode) => {
      const { wrapper } = setup({ mode });
      await choose(wrapper);
      expect(wrapper.get('[data-testid="associate-video"]').attributes('disabled')).toBeDefined();
    }
  );

  it.each(['', 'pending:123', 'draft-1', '0'])(
    'has no entry or availability lookup for non-existing product ID %s',
    async (productId) => {
      const { wrapper, get } = setup({ productId });
      await flushPromises();
      expect(wrapper.find('[data-testid="product-video-association"]').exists()).toBe(false);
      expect(get).not.toHaveBeenCalled();
    }
  );

  it('rechecks availability at confirmation and refuses revoked authorization', async () => {
    const { wrapper, gateway, get } = setup();
    const request = vi.spyOn(gateway, 'request');
    await choose(wrapper);
    await wrapper.get('[data-testid="associate-video"]').trigger('click');
    get.mockResolvedValue({ items: [] });
    await wrapper.get('[data-testid="confirm"]').trigger('click');
    await flushPromises();
    expect(request).not.toHaveBeenCalled();
  });

  it('resets confirmation and hides account A receipts on reactive identity/visibility changes', async () => {
    const { wrapper, gateway } = setup();
    await choose(wrapper);
    await wrapper.get('[data-testid="associate-video"]').trigger('click');
    const old = await gateway.galleryTransferContext();
    vi.spyOn(gateway, 'galleryTransferContext').mockResolvedValue({ ...old, identity: 'another-account' });
    globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
    await flushPromises();
    expect(wrapper.find('[data-testid="confirmation"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="video-association-receipt"]').exists()).toBe(false);
    await choose(wrapper);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(wrapper.get('[data-testid="associate-video"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).not.toContain(fixture.title);
  });

  it('persists a late result to its original account but never displays it in the replacement account', async () => {
    const { wrapper, gateway } = setup();
    let complete: (result: VideoAssociationResult) => void = () => undefined;
    const request = vi.spyOn(gateway, 'request').mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    await submit(wrapper);
    expect(request).toHaveBeenCalledTimes(1);
    const old = await gateway.galleryTransferContext();
    vi.spyOn(gateway, 'galleryTransferContext').mockResolvedValue({ ...old, identity: 'new-account' });
    globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
    complete({ outcome: 'confirmed', traceId: 'original-account-trace', code: null });
    await flushPromises();
    expect(wrapper.text()).not.toContain('original-account-trace');
    expect(wrapper.find('[data-testid="video-association-receipt"]').exists()).toBe(false);
    expect(
      Object.keys(localStorage).some((key) => localStorage.getItem(key)?.includes('original-account-trace'))
    ).toBe(true);
  });
});

describe('video association local-data cleanup', () => {
  it('clears only its own receipts after clearing other data', async () => {
    localStorage.setItem(VIDEO_ASSOCIATION_PREFIX + 'a', 'receipt');
    localStorage.setItem('unrelated', 'keep');
    const other = vi.fn(() => {
      expect(localStorage.getItem(VIDEO_ASSOCIATION_PREFIX + 'a')).toBe('receipt');
      return Promise.resolve();
    });
    await clearVideoAssociationLocalData(other);
    expect(other).toHaveBeenCalledOnce();
    expect(localStorage.getItem(VIDEO_ASSOCIATION_PREFIX + 'a')).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });
  it('refuses to clear an in-flight receipt', async () => {
    held = true;
    const other = vi.fn();
    await expect(clearVideoAssociationLocalData(other)).rejects.toThrow('VIDEO_ASSOCIATION_LOCKED');
    expect(other).not.toHaveBeenCalled();
  });
});
