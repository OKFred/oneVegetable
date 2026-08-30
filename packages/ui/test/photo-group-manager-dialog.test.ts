// @vitest-environment jsdom

import { defineComponent, h, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { toast } from 'vue-sonner';

import { OPERATION_IDS, StaticOperationAvailabilityClient, type OperationId } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import PhotoGroupManagerDialog from '../src/components/PhotoGroupManagerDialog.vue';
import { provideServices } from '../src/lib/services';

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn() }
}));

class ResizeObserverMock implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    void callback;
  }
  observe(target: Element, options?: ResizeObserverOptions): void {
    void target;
    void options;
  }
  unobserve(target: Element): void {
    void target;
  }
  disconnect(): void {
    return;
  }
}

beforeAll(() => {
  globalThis.ResizeObserver = ResizeObserverMock;
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('PhotoGroupManagerDialog', () => {
  it('loads descendants lazily and adds a root group in Mock mode', async () => {
    const wrapper = mountDialog('mock');

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('商品主图');
    });
    buttonByLabel('展开商品主图').click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('白底主图');
    });

    buttonByLabel('在全部图片下新增分组').click();
    await flushPromises();
    const input = inputByLabel('在全部图片下的新分组名称');
    input.value = '新版详情素材';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    buttonByText('保存').click();

    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('图库分组“新版详情素材”已创建');
      expect(document.body.textContent).toContain('新版详情素材');
    });
    wrapper.unmount();
  });

  it('confirms real rename and delete operations before writing', async () => {
    const wrapper = mountDialog('extension');

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('商品主图');
    });
    buttonByLabel('修改分组 商品主图').click();
    await flushPromises();
    const input = inputByLabel('商品主图 的新名称');
    input.value = '主图素材';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    buttonByText('保存').click();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('确认修改图库分组');
      expect(document.body.textContent).toContain('改名为“主图素材”');
    });
    buttonByText('确认改名').click();
    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('图库分组已改名为“主图素材”');
      expect(document.body.textContent).toContain('主图素材');
    });

    buttonByLabel('删除分组 主图素材').click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('确认删除图库分组');
      expect(document.body.textContent).toContain('若分组仍含图片或子分组，平台可能拒绝');
    });
    buttonByText('确认删除').click();
    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('已删除所选图库分组');
      expect(document.body.textContent).not.toContain('主图素材');
    });
    wrapper.unmount();
  });

  it('keeps tree actions disabled when the environment denies group writes', async () => {
    const wrapper = mountDialog('extension', new Set());

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('商品主图');
    });
    expect(buttonByLabel('在全部图片下新增分组').disabled).toBe(true);
    expect(buttonByLabel('修改分组 商品主图').disabled).toBe(true);
    expect(buttonByLabel('删除分组 商品主图').disabled).toBe(true);
    expect(document.body.textContent).toContain('当前环境未开放图库分组写入（STATIC_DISABLED）');
    wrapper.unmount();
  });
});

function mountDialog(
  mode: 'mock' | 'extension',
  allowedOperations: ReadonlySet<OperationId> = new Set(OPERATION_IDS)
) {
  const gateway = new MockGatewayClient(0);
  const Host = defineComponent({
    setup() {
      const open = ref(true);
      provideServices({
        gateway,
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        operationAvailability: new StaticOperationAvailabilityClient(allowedOperations),
        mode
      });
      return () =>
        h(PhotoGroupManagerDialog, {
          open: open.value,
          'onUpdate:open': (value: boolean) => {
            open.value = value;
          }
        });
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(Host, {
    attachTo: document.body,
    global: { plugins: [[VueQueryPlugin, { queryClient }]] }
  });
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}

function buttonByText(label: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent.trim() === label
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}

function inputByLabel(label: string): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`Missing input: ${label}`);
  return input;
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
