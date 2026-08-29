// @vitest-environment jsdom

import { defineComponent, h, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { toast } from 'vue-sonner';

import { MockGatewayClient } from '@one-vegetable/core/mock';

import ProductGroupManagerDialog from '../src/components/ProductGroupManagerDialog.vue';
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

describe('ProductGroupManagerDialog', () => {
  it('loads the tree lazily and creates a group under the selected parent', async () => {
    const wrapper = mountDialog(true);

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Energy storage');
    });
    expect(document.body.textContent).toContain('全部分组');
    await vi.waitFor(() => {
      expect(buttonByLabel('在全部分组下新增分组').disabled).toBe(false);
    });
    buttonByLabel('在全部分组下新增分组').click();
    await flushPromises();
    expect(document.body.querySelector('input[aria-label="在全部分组下的新分组名称"]')).not.toBeNull();
    buttonByText('取消').click();
    const expand = buttonByLabel('展开Energy storage');
    expand.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Portable power');
    });

    buttonByLabel('在 Energy storage 下新增分组').click();
    await flushPromises();
    const input = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="在 Energy storage 下的新分组名称"]'
    );
    expect(input).not.toBeNull();
    if (!input) throw new Error('Missing product group name input');
    input.value = 'E2E products';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    await vi.waitFor(() => {
      expect(buttonByText('保存').disabled).toBe(false);
    });
    buttonByText('保存').click();

    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('商品分组“E2E products”已创建。');
      expect(document.body.textContent).toContain('E2E products');
    });
    wrapper.unmount();
  });

  it('explains unsupported rename and delete actions with keyboard-accessible tooltips', async () => {
    const wrapper = mountDialog(true);

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Energy storage');
    });
    const rename = elementByLabel('修改分组 Energy storage（不可用）');
    const remove = elementByLabel('删除分组 Energy storage（不可用）');
    expect(rename.getAttribute('aria-disabled')).toBe('true');
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    remove.focus();
    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('暂时无法删除线上分组');
    });
    expect(document.body.textContent).toContain('仅提供商品分组查询与新增');
    wrapper.unmount();
  });
});

function mountDialog(open: boolean) {
  const gateway = new MockGatewayClient(0);
  const Host = defineComponent({
    setup() {
      const currentOpen = ref(open);
      provideServices({
        gateway,
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        operationAvailability: {
          get: (operations) =>
            Promise.resolve({
              items: operations.map((operation) => ({
                operation,
                allowed: true,
                reasonCode: 'TEST_ALLOWED'
              }))
            })
        },
        mode: 'mock'
      });
      return () =>
        h(ProductGroupManagerDialog, {
          open: currentOpen.value,
          'onUpdate:open': (value: boolean) => {
            currentOpen.value = value;
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

function elementByLabel(label: string): HTMLElement {
  const element = document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!element) throw new Error(`Missing element: ${label}`);
  return element;
}

function buttonByText(label: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent.trim() === label
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
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
