// @vitest-environment jsdom
import { computed, defineComponent, h, ref, type Component, type Ref } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhotoGroup, RequestOf } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import PhotoGroupNavigation from '../src/components/PhotoGroupNavigation.vue';
import { provideListIdentityScope } from '../src/lib/list-identity-scope';
import { provideServices } from '../src/lib/services';
import { uiI18n } from '../src/i18n';
import fixture from '../../../mock/data/photo-group-navigation.json';

const wrappers: VueWrapper[] = [];
const clients = new Set<QueryClient>();
function group(
  id: string,
  name: string,
  parentId: string | null = null,
  level: PhotoGroup['level'] = 1
): PhotoGroup {
  const found = [...fixture.groups, ...fixture.completeTree].find(
    (candidate) =>
      candidate.id === id &&
      candidate.name === name &&
      candidate.parentId === parentId &&
      candidate.level === level
  );
  if (!found) throw new Error('Missing fictional navigation fixture');
  return structuredClone(found);
}
function harness(
  load: (parentId?: string) => Promise<PhotoGroup[]>,
  options: { scope?: Ref<string>; allowAll?: boolean; queryClient?: QueryClient } = {}
) {
  const scope = options.scope ?? ref('account-a');
  const gateway = new MockGatewayClient(0);
  const request = vi.spyOn(gateway, 'request').mockImplementation((operation, payload) => {
    if (operation !== 'listPhotoGroups') return Promise.reject(new Error('Unexpected gateway operation'));
    const parentId = (payload as RequestOf<'listPhotoGroups'>)?.parentId;
    return load(parentId);
  });
  const model = ref('-1');
  const selected = ref<PhotoGroup | null>(null);
  const selections: PhotoGroup[] = [];
  const host = defineComponent({
    setup() {
      provideServices({
        gateway,
        mode: 'mock',
        settings: {
          load: () =>
            Promise.resolve({
              appKey: '',
              appSecret: '',
              accessToken: '',
              endpoint: 'https://eco.taobao.com/router/rest',
              signMethod: 'hmac'
            }),
          save: () => Promise.resolve()
        }
      });
      provideListIdentityScope(computed(() => scope.value));
      return () =>
        h(PhotoGroupNavigation as Component, {
          modelValue: model.value,
          allowAll: options.allowAll ?? true,
          'onUpdate:modelValue': (id: string) => {
            model.value = id;
          },
          onSelect: (value: PhotoGroup) => {
            selected.value = value;
            selections.push(value);
          }
        });
    }
  });
  const queryClient =
    options.queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  clients.add(queryClient);
  const wrapper = mount(host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  wrappers.push(wrapper);
  return { wrapper, scope, gateway, request, model, selected, selections, queryClient };
}
async function choose(wrapper: VueWrapper, name: string): Promise<void> {
  await vi.waitFor(() => {
    expect(wrapper.text()).toContain(name);
  });
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === name);
  if (!button) throw new Error(`Missing fictional group: ${name}`);
  await button.trigger('click');
}
function row(wrapper: VueWrapper, name: string) {
  const result = wrapper
    .findAll('[role="treeitem"]')
    .find((candidate) => candidate.find('span.truncate').text() === name);
  if (!result) throw new Error(`Missing fictional row: ${name}`);
  return result;
}
function labels(wrapper: VueWrapper): string[] {
  return wrapper.findAll('[role="treeitem"] span.truncate').map((element) => element.text());
}
beforeEach(() => {
  uiI18n.global.locale.value = 'zh-CN';
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No live platform calls allowed')));
});
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  for (const client of clients) client.clear();
  clients.clear();
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PhotoGroupNavigation context isolation', () => {
  it('partitions both root and child caches by identity and ignores the old unscoped root cache', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } }
    });
    queryClient.setQueryData(['photo-groups', 'root'], [group('legacy', 'Wrong unscoped account')]);
    const first = harness(
      (parent) =>
        Promise.resolve(parent ? [group('a-child', 'Alpha child', 'a', 2)] : [group('a', 'Alpha root')]),
      { queryClient }
    );
    const second = harness(
      (parent) =>
        Promise.resolve(parent ? [group('b-child', 'Beta child', 'b', 2)] : [group('b', 'Beta root')]),
      { scope: ref('account-b'), queryClient }
    );
    await choose(first.wrapper, 'Alpha root');
    await choose(second.wrapper, 'Beta root');
    await vi.waitFor(() => {
      expect(first.wrapper.text()).toContain('Alpha child');
      expect(second.wrapper.text()).toContain('Beta child');
    });
    expect(first.wrapper.text()).not.toMatch(/Wrong unscoped|Beta/);
    expect(second.wrapper.text()).not.toMatch(/Wrong unscoped|Alpha/);
    expect(queryClient.getQueryData(['photo-groups', 'account-a', 'root'])).toEqual([
      group('a', 'Alpha root')
    ]);
    expect(queryClient.getQueryData(['photo-groups', 'account-b', 'root'])).toEqual([
      group('b', 'Beta root')
    ]);
    expect(queryClient.getQueryData(['photo-groups', 'account-a', 'a'])).toEqual([
      group('a-child', 'Alpha child', 'a', 2)
    ]);
    expect(queryClient.getQueryData(['photo-groups', 'account-b', 'b'])).toEqual([
      group('b-child', 'Beta child', 'b', 2)
    ]);
  });

  it('clears descendants, expanded rows and parent-held selection before the new account root resolves', async () => {
    const scope = ref('account-a');
    const nextRoots = Promise.withResolvers<PhotoGroup[]>();
    const current = harness(
      (parent) =>
        scope.value === 'account-b'
          ? nextRoots.promise
          : Promise.resolve(parent ? [group('a-child', 'Alpha child', 'a', 2)] : [group('a', 'Alpha root')]),
      { scope }
    );
    await choose(current.wrapper, 'Alpha root');
    await choose(current.wrapper, 'Alpha child');
    expect(current.selected.value?.id).toBe('a-child');
    scope.value = 'account-b';
    await flushPromises();
    expect(current.wrapper.text()).not.toContain('Alpha');
    expect(current.model.value).toBe('-1');
    expect(current.selected.value?.id).toBe('-1');
    expect(current.wrapper.findAll('[aria-expanded="true"]')).toHaveLength(0);
    expect(current.wrapper.find('svg.animate-spin').exists()).toBe(false);
    nextRoots.resolve([group('b', 'Beta root')]);
    await vi.waitFor(() => {
      expect(current.wrapper.text()).toContain('Beta root');
    });
    expect(row(current.wrapper, 'Beta root').attributes('aria-expanded')).toBe('false');
    expect(current.model.value).toBe('-1');
  });

  it('ignores a late old root and auto-selects only a root from the current IOP context', async () => {
    const scope = ref('account-a');
    const oldRoots = Promise.withResolvers<PhotoGroup[]>();
    const current = harness(
      (parent) =>
        scope.value === 'account-a'
          ? oldRoots.promise
          : Promise.resolve(parent ? [] : [group('b', 'Beta root')]),
      { scope, allowAll: false }
    );
    scope.value = 'account-b';
    await vi.waitFor(() => {
      expect(current.selected.value?.id).toBe('b');
    });
    oldRoots.resolve([group('a', 'Late Alpha root')]);
    await flushPromises();
    expect(current.wrapper.text()).not.toContain('Alpha');
    expect(current.model.value).toBe('b');
    expect(current.selections.some((selected) => selected.id === 'a')).toBe(false);
    expect(
      current.request.mock.calls.some(
        ([, payload]) => (payload as RequestOf<'listPhotoGroups'>)?.parentId === 'a'
      )
    ).toBe(false);
  });

  it.each(['success', 'failure'] as const)(
    'a late old child %s cannot overwrite new rows, error or loading for a reused group ID',
    async (outcome) => {
      const scope = ref('account-a');
      const oldChildren = Promise.withResolvers<PhotoGroup[]>();
      const newChildren = Promise.withResolvers<PhotoGroup[]>();
      const current = harness(
        (parent) =>
          parent
            ? scope.value === 'account-a'
              ? oldChildren.promise
              : newChildren.promise
            : Promise.resolve([
                group('shared-root', scope.value === 'account-a' ? 'Alpha root' : 'Beta root')
              ]),
        { scope }
      );
      await choose(current.wrapper, 'Alpha root');
      expect(row(current.wrapper, 'Alpha root').find('svg.animate-spin').exists()).toBe(true);
      scope.value = 'account-b';
      await choose(current.wrapper, 'Beta root');
      expect(row(current.wrapper, 'Beta root').find('svg.animate-spin').exists()).toBe(true);
      if (outcome === 'success')
        oldChildren.resolve([group('old-child', 'Late Alpha child', 'shared-root', 2)]);
      else oldChildren.reject(new Error('OLD_ACCOUNT_ERROR'));
      await flushPromises();
      expect(current.wrapper.text()).not.toMatch(/Alpha|OLD_ACCOUNT_ERROR|GALLERY_CONTEXT_CHANGED/);
      expect(row(current.wrapper, 'Beta root').find('svg.animate-spin').exists()).toBe(true);
      newChildren.resolve([group('new-child', 'Beta child', 'shared-root', 2)]);
      await vi.waitFor(() => {
        expect(current.wrapper.text()).toContain('Beta child');
        expect(row(current.wrapper, 'Beta root').find('svg.animate-spin').exists()).toBe(false);
      });
      expect(current.selected.value?.name).toBe('Beta root');
    }
  );

  it('does not accept an old request even after switching away and back to the same identity', async () => {
    const scope = ref('account-a');
    const oldChildren = Promise.withResolvers<PhotoGroup[]>();
    let childReads = 0;
    const current = harness(
      (parent) => {
        if (scope.value === 'account-b') return Promise.resolve([group('b', 'Beta root')]);
        if (!parent) return Promise.resolve([group('a', 'Alpha root')]);
        childReads++;
        return childReads === 1
          ? oldChildren.promise
          : Promise.resolve([group('fresh', 'Fresh Alpha child', 'a', 2)]);
      },
      { scope }
    );
    await choose(current.wrapper, 'Alpha root');
    scope.value = 'account-b';
    await vi.waitFor(() => {
      expect(current.wrapper.text()).toContain('Beta root');
    });
    scope.value = 'account-a';
    await choose(current.wrapper, 'Alpha root');
    await vi.waitFor(() => {
      expect(current.wrapper.text()).toContain('Fresh Alpha child');
    });
    oldChildren.resolve([group('late', 'Stale Alpha child', 'a', 2)]);
    await flushPromises();
    expect(current.wrapper.text()).not.toContain('Stale Alpha');
    expect(current.queryClient.getQueryData(['photo-groups', 'account-a', 'a'])).toEqual([
      group('fresh', 'Fresh Alpha child', 'a', 2)
    ]);
  });

  it('does not resume an old refresh or emit its selection after the context changes', async () => {
    const scope = ref('account-a');
    const oldRefresh = Promise.withResolvers<PhotoGroup[]>();
    let rootReads = 0;
    const current = harness(
      (parent) => {
        if (scope.value === 'account-b') return Promise.resolve([group('b', 'Beta root')]);
        if (parent) return Promise.resolve([]);
        rootReads++;
        return rootReads === 1 ? Promise.resolve([group('a', 'Alpha root')]) : oldRefresh.promise;
      },
      { scope }
    );
    await choose(current.wrapper, 'Alpha root');
    await flushPromises();
    const navigation = current.wrapper.findComponent(PhotoGroupNavigation).vm as unknown as {
      refresh(): Promise<void>;
    };
    const refreshing = navigation.refresh();
    await flushPromises();
    scope.value = 'account-b';
    await vi.waitFor(() => {
      expect(current.wrapper.text()).toContain('Beta root');
    });
    const emitted = current.selections.length;
    oldRefresh.resolve([group('a', 'Late Alpha root')]);
    await refreshing;
    await flushPromises();
    expect(current.model.value).toBe('-1');
    expect(current.selected.value?.id).toBe('-1');
    expect(current.selections).toHaveLength(emitted);
    expect(
      current.request.mock.calls.some(
        ([, payload]) => (payload as RequestOf<'listPhotoGroups'>)?.parentId === 'b'
      )
    ).toBe(false);
  });

  it('orders descendants by parent chain and never nests a different root from a complete tree response', async () => {
    const complete = structuredClone(fixture.completeTree);
    const current = harness(() => Promise.resolve(complete));
    await choose(current.wrapper, 'Alpha root');
    await vi.waitFor(() => {
      expect(current.wrapper.text()).toContain('Alpha leaf 2');
    });
    expect(labels(current.wrapper).slice(1)).toEqual([
      'Alpha root',
      'Alpha child 1',
      'Alpha leaf 1',
      'Alpha child 2',
      'Alpha leaf 2',
      'Beta root'
    ]);
    expect(labels(current.wrapper).filter((name) => name === 'Beta root')).toHaveLength(1);
    expect(current.wrapper.text()).not.toContain('Beta child');
    await choose(current.wrapper, 'Beta root');
    await vi.waitFor(() => {
      expect(current.wrapper.text()).toContain('Beta child');
    });
    expect(labels(current.wrapper).slice(1)).toEqual([
      'Alpha root',
      'Alpha child 1',
      'Alpha leaf 1',
      'Alpha child 2',
      'Alpha leaf 2',
      'Beta root',
      'Beta child'
    ]);
    await choose(current.wrapper, 'Alpha leaf 1');
    expect(current.selected.value).toMatchObject({ id: 'a1-leaf', parentId: 'a1' });
  });
});
