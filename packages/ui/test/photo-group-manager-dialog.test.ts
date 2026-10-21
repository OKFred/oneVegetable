// @vitest-environment jsdom

import { computed, defineComponent, h, ref, type Ref } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { toast } from 'vue-sonner';

import {
  OPERATION_IDS,
  StaticOperationAvailabilityClient,
  type OperationId,
  type PhotoGroup,
  type PhotoGroupOperationResult,
  type RequestOf,
  type ResponseOf
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import PhotoGroupManagerDialog from '../src/components/PhotoGroupManagerDialog.vue';
import { provideServices } from '../src/lib/services';
import { provideListIdentityScope } from '../src/lib/list-identity-scope';

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn() }
}));
const mounted: VueWrapper[] = [];

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
  mounted.splice(0).forEach((wrapper) => {
    wrapper.unmount();
  });
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('PhotoGroupManagerDialog', () => {
  it('keeps the parent expanded and shows a newly added child immediately', async () => {
    const wrapper = mountDialog('mock');

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('商品主图');
    });
    buttonByLabel('展开商品主图').click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('白底主图');
    });

    buttonByLabel('在 商品主图 下新增分组').click();
    await flushPromises();
    const input = inputByLabel('在 商品主图 下的新分组名称');
    input.value = '新版详情素材';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    buttonByText('保存').click();

    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('图片分组“新版详情素材”已创建');
      expect(document.body.textContent).toContain('新版详情素材');
      expect(buttonByLabel('收起商品主图')).toBeDefined();
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
      expect(document.body.textContent).toContain('确认修改图片分组');
      expect(document.body.textContent).toContain('改名为“主图素材”');
    });
    buttonByText('确认改名').click();
    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('图片分组已改名为“主图素材”');
      expect(document.body.textContent).toContain('主图素材');
    });

    buttonByLabel('删除分组 主图素材').click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('确认删除图片分组');
      expect(document.body.textContent).toContain('若分组仍含图片或子分组，平台可能拒绝');
    });
    buttonByText('确认删除').click();
    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('已删除所选图片分组');
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
    expect(document.body.textContent).toContain('当前环境未开放图片分组写入（STATIC_DISABLED）');
    wrapper.unmount();
  });

  it('renames only the current identity caches, leaving foreign and legacy entries unchanged', async () => {
    const scope = ref('account-a');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = group('2001', '商品主图');
    queryClient.setQueryData(['photo-groups', scope.value, 'root'], [root]);
    queryClient.setQueryData(['photo-groups', scope.value, '2001'], [root]);
    queryClient.setQueryData(['photo-groups', 'account-b', 'root'], [root]);
    queryClient.setQueryData(['photo-groups', 'root'], [root]);
    mountDialog('mock', undefined, { scope, queryClient });
    await flushPromises();
    buttonByLabel('修改分组 商品主图').click();
    await flushPromises();
    await changeName('商品主图 的新名称', '当前账号主图');
    await vi.waitFor(() => {
      expect(queryClient.getQueryData(['photo-groups', scope.value, 'root'])).toMatchObject([
        { id: root.id, name: '当前账号主图' }
      ]);
    });
    expect(queryClient.getQueryData(['photo-groups', scope.value, '2001'])).toMatchObject([
      { id: root.id, name: '当前账号主图' }
    ]);
    expect(queryClient.getQueryData(['photo-groups', 'account-b', 'root'])).toEqual([root]);
    expect(queryClient.getQueryState(['photo-groups', 'account-b', 'root'])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryData(['photo-groups', 'root'])).toEqual([root]);
  });

  it.each(['success', 'failure'] as const)(
    'ignores an old mutation %s after identity changes',
    async (outcome) => {
      const scope = ref('account-a');
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const root = group('2001', '商品主图');
      queryClient.setQueryData(['photo-groups', scope.value, 'root'], [root]);
      queryClient.setQueryData(['photo-groups', 'account-b', 'root'], [root]);
      const pending = deferred<PhotoGroupOperationResult>();
      const gateway = new MockGatewayClient(0);
      const original = gateway.request.bind(gateway);
      const request = vi
        .spyOn(gateway, 'request')
        .mockImplementation(
          <K extends OperationId>(operation: K, payload: RequestOf<K>): Promise<ResponseOf<K>> =>
            operation === 'operatePhotoGroup' ? pending.promise : original(operation, payload)
        );
      const changed = vi.fn();
      mountDialog('mock', undefined, { scope, queryClient, gateway, changed });
      await flushPromises();
      buttonByLabel('修改分组 商品主图').click();
      await flushPromises();
      await changeName('商品主图 的新名称', '旧账号改名');
      await vi.waitFor(() => {
        expect(request).toHaveBeenCalledWith('operatePhotoGroup', {
          operation: 'rename',
          groupId: '2001',
          groupName: '旧账号改名'
        });
      });
      scope.value = 'account-b';
      await flushPromises();
      buttonByLabel('修改分组 商品主图').click();
      await flushPromises();
      if (outcome === 'success') {
        pending.resolve({ operation: 'rename', groupId: '2001', group: { ...root, name: '旧账号改名' } });
      } else {
        pending.reject(new Error('Old account mutation failed'));
      }
      await flushPromises();
      expect(inputByLabel('商品主图 的新名称').value).toBe('商品主图');
      expect(queryClient.getQueryData(['photo-groups', 'account-b', 'root'])).toEqual([root]);
      expect(queryClient.getQueryState(['photo-groups', 'account-b', 'root'])?.isInvalidated).toBe(false);
      expect(document.body.textContent).not.toContain('Old account mutation failed');
      expect(toast.success).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
    }
  );

  it.each(['success', 'failure'] as const)('ignores late child %s for a reused group ID', async (outcome) => {
    const scope = ref('account-a');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = group('2001', '商品主图');
    queryClient.setQueryData(['photo-groups', scope.value, 'root'], [root]);
    queryClient.setQueryData(['photo-groups', 'account-b', 'root'], [root]);
    const oldChildren = deferred<PhotoGroup[]>();
    const newChildren = deferred<PhotoGroup[]>();
    const gateway = new MockGatewayClient(0);
    const original = gateway.request.bind(gateway);
    const request = vi
      .spyOn(gateway, 'request')
      .mockImplementation(
        <K extends OperationId>(operation: K, payload: RequestOf<K>): Promise<ResponseOf<K>> =>
          operation === 'listPhotoGroups' && payload
            ? scope.value === 'account-a'
              ? oldChildren.promise
              : newChildren.promise
            : original(operation, payload)
      );
    mountDialog('mock', undefined, { scope, queryClient, gateway });
    await flushPromises();
    buttonByLabel('展开商品主图').click();
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith('listPhotoGroups', { parentId: '2001' });
    });
    scope.value = 'account-b';
    await flushPromises();
    buttonByLabel('展开商品主图').click();
    await flushPromises();
    if (outcome === 'success') oldChildren.resolve([group('old-child', '旧账号子组', '2001')]);
    else oldChildren.reject(new Error('Old account children failed'));
    await flushPromises();
    expect(document.body.textContent).not.toContain('旧账号子组');
    expect(document.body.textContent).not.toContain('Old account children failed');
    expect(queryClient.getQueryData(['photo-groups', 'account-b', '2001'])).toBeUndefined();
    newChildren.resolve([group('new-child', '当前账号子组', '2001')]);
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('当前账号子组');
    });
    expect(queryClient.getQueryData(['photo-groups', 'account-b', '2001'])).toEqual([
      group('new-child', '当前账号子组', '2001')
    ]);
    expect(document.body.textContent).not.toContain('旧账号子组');
  });
});

function mountDialog(
  mode: 'mock' | 'extension',
  allowedOperations: ReadonlySet<OperationId> = new Set(OPERATION_IDS),
  options: {
    scope?: Ref<string>;
    queryClient?: QueryClient;
    gateway?: MockGatewayClient;
    changed?: () => void;
  } = {}
) {
  const gateway = options.gateway ?? new MockGatewayClient(0);
  const Host = defineComponent({
    setup() {
      const open = ref(true);
      provideListIdentityScope(computed(() => options.scope?.value ?? ''));
      provideServices({
        gateway,
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        operationAvailability: new StaticOperationAvailabilityClient(allowedOperations),
        mode
      });
      return () =>
        h(PhotoGroupManagerDialog, {
          open: open.value,
          ...(options.changed ? { onChanged: options.changed } : {}),
          'onUpdate:open': (value: boolean) => {
            open.value = value;
          }
        });
    }
  });
  const queryClient =
    options.queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: { plugins: [[VueQueryPlugin, { queryClient }]] }
  });
  mounted.push(wrapper);
  return wrapper;
}

function group(id: string, name: string, parentId: string | null = null): PhotoGroup {
  return { id, name, parentId, level: parentId ? 2 : 1, photoCount: 0 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function changeName(label: string, value: string) {
  const input = inputByLabel(label);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await flushPromises();
  buttonByText('保存').click();
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
