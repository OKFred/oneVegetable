// @vitest-environment jsdom
import { computed, h, ref, type PropType, type ComputedRef } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigDefaults, DirEntry, FeaturesConfig, MenuItem } from 'vuefinder';
import type * as VueFinderModule from 'vuefinder';
import type { S3StorageControl, S3StorageConfigurationSummary } from '../../core/src/s3-storage';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { provideServices } from '../src/lib/services';
import { provideListIdentityScope } from '../src/lib/list-identity-scope';
import { uiI18n } from '../src/i18n';
import FilesView from '../src/views/FilesView.vue';
import { S3_FILE_LIMIT, type S3FileDriver } from '../src/lib/s3-file-driver';

vi.mock('vuefinder', async (importOriginal) => {
  const original = await importOriginal<typeof VueFinderModule>();
  const { computed, defineComponent, h, inject, onMounted, onUnmounted, provide, ref, shallowRef } =
    await import('vue');
  return {
    ...original,
    useMenuItems: () => {
      const menuItems = inject<ComputedRef<MenuItem[]>>('files-fixture-menu-items');
      if (!menuItems) throw new Error('Missing VueFinder menu context');
      return { menuItems, shouldShowExit: computed(() => false) };
    },
    VueFinder: defineComponent({
      name: 'VueFinderFixture',
      props: {
        driver: { type: Object as PropType<S3FileDriver>, required: true },
        config: { type: Object as PropType<ConfigDefaults>, required: true },
        features: { type: Object as PropType<FeaturesConfig>, required: true },
        locale: { type: String, default: 'zhCN' }
      },
      emits: ['select', 'file-dclick', 'folder-dclick'],
      setup(props, { emit, slots }) {
        const rows = shallowRef<DirEntry[]>([]);
        // Mirror VueFinder: a config prop update alone does not update internal layout.
        const internalView = ref<'grid' | 'list'>('grid');
        provide(
          'files-fixture-menu-items',
          computed<MenuItem[]>(() => [
            {
              id: 'view',
              items: [
                {
                  id: 'grid-view',
                  action: () => {
                    internalView.value = 'grid';
                  }
                },
                {
                  id: 'list-view',
                  action: () => {
                    internalView.value = 'list';
                  }
                }
              ]
            }
          ])
        );
        const options = inject<{ i18n: Record<string, unknown> }>('VueFinderOptions');
        if (!options || typeof options.i18n.en !== 'function' || typeof options.i18n.zhCN !== 'function')
          throw new Error('Missing bundled VueFinder locales');
        let active = true;
        onMounted(async () => {
          const page = await props.driver.list({ path: props.config.initialPath ?? '' });
          if (active) rows.value = page.files;
        });
        onUnmounted(() => {
          active = false;
        });
        return () =>
          h(
            'div',
            {
              'data-testid': 'vuefinder-fixture',
              'data-locale': props.locale,
              'data-theme': props.config.theme,
              'data-view': internalView.value,
              'data-features': JSON.stringify(props.features),
              'data-persist': String(props.config.persist)
            },
            [
              ...rows.value.map((row) =>
                h(
                  'div',
                  {
                    'data-entry': row.basename,
                    class:
                      internalView.value === 'list'
                        ? 'vuefinder__explorer__item-list-content'
                        : 'vuefinder__explorer__item-grid-content',
                    onClick: () => {
                      emit('select', row.type === 'file' ? [row] : []);
                    },
                    onDblclick: () => {
                      const event = {
                        item: row,
                        defaultPrevented: false,
                        preventDefault() {
                          event.defaultPrevented = true;
                        }
                      };
                      emit(row.type === 'file' ? 'file-dclick' : 'folder-dclick', event);
                    }
                  },
                  [row.basename, slots.icon?.({ item: row })]
                )
              ),
              slots['status-bar']?.()
            ]
          );
      }
    })
  };
});
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn() } }));
import { toast } from 'vue-sonner';

const context = 'a'.repeat(64);
const disposers: (() => void)[] = [];
function summary(id = context, configured = true): S3StorageConfigurationSummary {
  return {
    configured,
    configurationId: id,
    endpoint: null,
    region: null,
    bucket: null,
    accessKeyIdSuffix: null,
    hasSessionToken: false,
    pathStyle: null,
    rootPrefix: null,
    revision: 1,
    updateTimeUtc: null,
    updaterId: null,
    remark: null
  };
}
function storage() {
  return {
    s3StorageConfiguration: vi.fn<S3StorageControl['s3StorageConfiguration']>().mockResolvedValue(summary()),
    listS3Objects: vi.fn<S3StorageControl['listS3Objects']>().mockResolvedValue({
      items: [{ key: 'hello.txt', size: 3, etag: null, lastModifiedTimeUtc: null }],
      prefixes: ['folder/'],
      nextContinuationToken: null
    }),
    getS3Object: vi.fn<S3StorageControl['getS3Object']>().mockResolvedValue({
      key: 'hello.txt',
      bytes: new TextEncoder().encode('abc'),
      contentType: 'text/plain',
      etag: null
    }),
    putS3Object: vi
      .fn<S3StorageControl['putS3Object']>()
      .mockImplementation((input) => Promise.resolve({ key: input.key, etag: null })),
    updateS3StorageConfiguration: vi.fn<S3StorageControl['updateS3StorageConfiguration']>(),
    clearS3StorageConfiguration: vi.fn<S3StorageControl['clearS3StorageConfiguration']>(),
    testS3StorageConnection: vi.fn<S3StorageControl['testS3StorageConnection']>()
  };
}
function mountView(s3: ReturnType<typeof storage> | undefined = storage()) {
  const identity = ref('identity-a');
  const gateway = new MockGatewayClient(0);
  const request = vi.spyOn(gateway, 'request');
  const load = vi.fn(() => {
    throw new Error('Files must not read Alibaba credentials');
  });
  const Host = {
    setup() {
      provideServices({
        gateway,
        settings: { load, save: () => Promise.resolve() },
        s3Storage: s3,
        mode: 'mock'
      });
      provideListIdentityScope(computed(() => identity.value));
      return () => h(FilesView);
    }
  };
  const wrapper = mount(Host, { attachTo: document.body });
  disposers.push(() => {
    wrapper.unmount();
  });
  return { wrapper, identity, request, load };
}
async function ready(wrapper: ReturnType<typeof mountView>['wrapper']) {
  await vi.dynamicImportSettled();
  await vi.waitFor(() => {
    expect(wrapper.find('[data-testid="vuefinder-fixture"]').exists()).toBe(true);
  });
  await flushPromises();
}
function bodyButton(text: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (value) => value.textContent.trim() === text
  );
  if (!button) throw new Error('Missing button: ' + text);
  return button;
}
async function choose(
  wrapper: ReturnType<typeof mountView>['wrapper'],
  name = 'upload.txt',
  bytes = new Uint8Array([1, 2, 3])
) {
  const file = new File([Uint8Array.from(bytes)], name, { type: 'text/plain' });
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(Uint8Array.from(bytes).buffer) });
  const input = wrapper.get<HTMLInputElement>('[data-testid="files-input"]');
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
  await input.trigger('change');
  await flushPromises();
}
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.innerHTML = '';
  document.documentElement.classList.remove('dark');
  uiI18n.global.locale.value = 'zh-CN';
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('FilesView', () => {
  it('shows a friendly configuration CTA with zero Alibaba calls, and fails closed on a missing context', async () => {
    const s3 = storage();
    s3.s3StorageConfiguration.mockResolvedValue(summary(context, false));
    const first = mountView(s3);
    await flushPromises();
    expect(first.wrapper.text()).toContain('尚未配置 S3 存储');
    expect(first.wrapper.get('a[href="#/settings"]').text()).toContain('配置 S3 存储');
    expect(s3.listS3Objects).not.toHaveBeenCalled();
    expect(first.request).not.toHaveBeenCalled();
    expect(first.load).not.toHaveBeenCalled();
    const invalid = storage();
    invalid.s3StorageConfiguration.mockResolvedValue(summary('not-hex'));
    const second = mountView(invalid);
    await flushPromises();
    expect(second.wrapper.get('[role="alert"]').text()).toContain('缺少有效标识');
    expect(invalid.listS3Objects).not.toHaveBeenCalled();
  });
  it('uses the S3-only service without reading credentials', async () => {
    // Only the S3 methods are used even when the application supplies a broad control client.
    const s3 = storage();
    const { wrapper, request, load } = mountView(s3);
    await ready(wrapper);
    expect(wrapper.text()).toContain('hello.txt');
    expect(s3.listS3Objects).toHaveBeenCalledWith(
      { prefix: '', delimiter: '/', maximum: 100 },
      { storageContext: context }
    );
    expect(s3.getS3Object).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
  it('disables all built-in mutations, URLs and thumbnails; locale, view and theme changes make no API requests', async () => {
    const s3 = storage(),
      { wrapper } = mountView(s3);
    await ready(wrapper);
    const finder = wrapper.get('[data-testid="vuefinder-fixture"]');
    expect(finder.attributes('data-persist')).toBe('false');
    const serialized = finder.attributes('data-features');
    if (!serialized) throw new Error('Missing serialized feature flags');
    const flags: unknown = JSON.parse(serialized);
    if (typeof flags !== 'object' || flags === null) throw new Error('Missing feature flags');
    expect(flags).toEqual({
      edit: false,
      newfile: false,
      newfolder: false,
      preview: false,
      archive: false,
      unarchive: false,
      search: false,
      rename: false,
      upload: false,
      delete: false,
      fullscreen: false,
      download: false,
      language: false,
      move: false,
      copy: false,
      history: false,
      theme: false,
      pinned: false
    });
    const before = s3.s3StorageConfiguration.mock.calls.length;
    uiI18n.global.locale.value = 'en-US';
    document.documentElement.classList.add('dark');
    await flushPromises();
    expect(finder.attributes('data-locale')).toBe('en');
    expect(finder.attributes('data-theme')).toBe('midnight');
    const list = wrapper.findAll('[data-list-view-toggle] button').find((button) => button.text() === 'List');
    if (!list) throw new Error('Missing list toggle');
    await list.trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="vuefinder-fixture"]').attributes('data-view')).toBe('list');
    expect(wrapper.findAll('.vuefinder__explorer__item-list-content')).toHaveLength(2);
    expect(wrapper.findAll('.vuefinder__explorer__item-grid-content')).toHaveLength(0);
    const grid = wrapper.findAll('[data-list-view-toggle] button').find((button) => button.text() === 'Grid');
    if (!grid) throw new Error('Missing grid toggle');
    await grid.trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.vuefinder__explorer__item-grid-content')).toHaveLength(2);
    expect(wrapper.findAll('.vuefinder__explorer__item-list-content')).toHaveLength(0);
    expect(s3.listS3Objects).toHaveBeenCalledOnce();
    expect(s3.s3StorageConfiguration).toHaveBeenCalledTimes(before);
    expect(s3.getS3Object).not.toHaveBeenCalled();
    expect(localStorage.getItem('vuefinder_config_s3-files')).toBeNull();
  });
  it('filters only loaded entries, and explicitly pages without claiming totals or scanning folders', async () => {
    const s3 = storage();
    s3.listS3Objects
      .mockResolvedValueOnce({
        items: [{ key: 'hello.txt', size: 3, etag: null, lastModifiedTimeUtc: null }],
        prefixes: ['folder/'],
        nextContinuationToken: 'opaque-next'
      })
      .mockResolvedValue({
        items: [{ key: 'next.txt', size: 0, etag: null, lastModifiedTimeUtc: null }],
        nextContinuationToken: null
      });
    const { wrapper } = mountView(s3);
    await ready(wrapper);
    await wrapper.get('[data-testid="files-search"]').setValue('HELLO');
    await flushPromises();
    expect(wrapper.find('[data-entry="folder"]').exists()).toBe(false);
    expect(wrapper.find('[data-entry="hello.txt"]').exists()).toBe(true);
    expect(s3.listS3Objects).toHaveBeenCalledOnce();
    const next = wrapper
      .get('[data-testid="files-pagination"]')
      .findAll('button')
      .find((button) => button.text() === '下一页');
    if (!next) throw new Error('Missing next page');
    await next.trigger('click');
    await flushPromises();
    expect(s3.listS3Objects).toHaveBeenLastCalledWith(
      { prefix: '', maximum: 100, delimiter: '/', continuationToken: 'opaque-next' },
      { storageContext: context }
    );
    expect(wrapper.text()).toContain('不代表目录或存储总数');
    expect(s3.listS3Objects).toHaveBeenCalledTimes(2);
  });
  it('navigates folders lazily through the same control and root-relative breadcrumbs', async () => {
    const s3 = storage(),
      { wrapper } = mountView(s3);
    await ready(wrapper);
    s3.listS3Objects.mockResolvedValue({
      items: [],
      prefixes: ['folder/nested/'],
      nextContinuationToken: null
    });
    await wrapper.get('[data-entry="folder"]').trigger('dblclick');
    await flushPromises();
    expect(s3.listS3Objects).toHaveBeenLastCalledWith(
      { prefix: 'folder/', maximum: 100, delimiter: '/' },
      { storageContext: context }
    );
    expect(wrapper.get('[data-testid="files-breadcrumbs"]').text()).toContain('folder');
    expect(s3.listS3Objects).toHaveBeenCalledTimes(2);
    expect(s3.getS3Object).not.toHaveBeenCalled();
  });
  it('requires confirmation, freezes the upload destination and confirms only after matching byte readback', async () => {
    const s3 = storage(),
      { wrapper } = mountView(s3);
    await ready(wrapper);
    await choose(wrapper);
    expect(s3.putS3Object).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('目标：upload.txt');
    s3.getS3Object.mockResolvedValue({
      key: 'upload.txt',
      bytes: new Uint8Array([1, 2, 3]),
      contentType: null,
      etag: null
    });
    bodyButton('确认创建').click();
    await flushPromises();
    expect(s3.putS3Object).toHaveBeenCalledExactlyOnceWith(
      {
        key: 'upload.txt',
        bytes: new Uint8Array([1, 2, 3]),
        contentType: 'text/plain',
        directory: false,
        createOnly: true
      },
      { storageContext: context }
    );
    expect(s3.getS3Object).toHaveBeenCalledExactlyOnceWith('upload.txt', { storageContext: context });
    expect(toast.success).toHaveBeenCalledOnce();
  });
  it('creates zero-byte directory markers only after confirmation', async () => {
    const s3 = storage(),
      { wrapper } = mountView(s3);
    await ready(wrapper);
    await wrapper.get('[data-testid="files-new-folder"]').trigger('click');
    const input = document.body.querySelector<HTMLInputElement>('[data-testid="files-folder-name"]');
    if (!input) throw new Error('Missing folder input');
    input.value = ' bad ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    bodyButton('确认创建').click();
    await flushPromises();
    const dialog = document.body.querySelector('[role="dialog"]');
    if (!dialog) throw new Error('Missing folder dialog');
    expect(dialog.textContent).toContain('名称或路径无效');
    expect(s3.putS3Object).not.toHaveBeenCalled();
    input.value = 'empty';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    const prepare = document.body.querySelector<HTMLButtonElement>('[data-testid="files-prepare-folder"]');
    if (!prepare) throw new Error('Missing folder preparation');
    prepare.click();
    await flushPromises();
    expect(s3.putS3Object).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('empty/');
    s3.getS3Object.mockResolvedValue({
      key: 'empty/',
      bytes: new Uint8Array(),
      contentType: null,
      etag: null
    });
    bodyButton('确认创建').click();
    await flushPromises();
    expect(s3.putS3Object).toHaveBeenCalledExactlyOnceWith(
      {
        key: 'empty/',
        bytes: new Uint8Array(),
        contentType: 'application/x-directory',
        directory: true,
        createOnly: true
      },
      { storageContext: context }
    );
    expect(toast.success).toHaveBeenCalledOnce();
  });
  it('shows unknown writes without retry or success, and rejects oversized uploads before reading bytes', async () => {
    const s3 = storage(),
      { wrapper } = mountView(s3);
    await ready(wrapper);
    await choose(wrapper);
    s3.putS3Object.mockRejectedValue(new Error('timeout'));
    bodyButton('确认创建').click();
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('写入结果未知');
    expect(s3.putS3Object).toHaveBeenCalledOnce();
    expect(s3.getS3Object).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    const huge = new File([], 'large.bin');
    Object.defineProperty(huge, 'size', { value: S3_FILE_LIMIT + 1 });
    const read = vi.fn();
    Object.defineProperty(huge, 'arrayBuffer', { value: read });
    const input = wrapper.get<HTMLInputElement>('[data-testid="files-input"]');
    Object.defineProperty(input.element, 'files', { configurable: true, value: [huge] });
    await input.trigger('change');
    expect(wrapper.get('[role="alert"]').text()).toContain('超过 5 MiB');
    expect(read).not.toHaveBeenCalled();
    expect(s3.putS3Object).toHaveBeenCalledOnce();
  });
  it('does not fetch large selections, and previews HTML/SVG only as escaped text', async () => {
    const s3 = storage();
    s3.listS3Objects.mockResolvedValue({
      items: [
        { key: 'unsafe.svg', size: 50, etag: null, lastModifiedTimeUtc: null },
        { key: 'large.bin', size: S3_FILE_LIMIT + 1, etag: null, lastModifiedTimeUtc: null }
      ],
      nextContinuationToken: null
    });
    const { wrapper } = mountView(s3);
    await ready(wrapper);
    await wrapper.get('[data-entry="large.bin"]').trigger('click');
    expect(wrapper.get('[data-testid="files-preview"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('超过 5 MiB');
    expect(s3.getS3Object).not.toHaveBeenCalled();
    const text = '<svg onload="bad()"><script>bad()</script></svg>';
    s3.getS3Object.mockResolvedValue({
      key: 'unsafe.svg',
      bytes: new TextEncoder().encode(text),
      contentType: 'image/svg+xml',
      etag: null
    });
    await wrapper.get('[data-entry="unsafe.svg"]').trigger('dblclick');
    await flushPromises();
    await vi.waitFor(() => {
      expect(s3.getS3Object).toHaveBeenCalledOnce();
    });
    expect(wrapper.find('[role="alert"]').exists(), wrapper.text()).toBe(false);
    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="files-text-preview"]')).not.toBeNull();
    });
    const preview = document.body.querySelector('[data-testid="files-text-preview"]');
    if (!preview) throw new Error('Missing escaped text preview');
    expect(preview.textContent).toBe(text);
    expect(preview.querySelector('svg, script, iframe')).toBeNull();
    expect(s3.getS3Object).toHaveBeenCalledOnce();
  });
  it('shows read failures as unknown, without fallback or automatic retry', async () => {
    const s3 = storage();
    s3.listS3Objects.mockRejectedValue(new Error('private-provider-error'));
    const { wrapper } = mountView(s3);
    await ready(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toContain('读取结果未知');
    expect(wrapper.text()).not.toContain('private-provider-error');
    await flushPromises();
    expect(s3.listS3Objects).toHaveBeenCalledOnce();
  });
  it('reconnects without a warning when identity initialization interrupts no file operation', async () => {
    const s3 = storage(),
      { wrapper, identity, request, load } = mountView(s3);
    await ready(wrapper);
    identity.value = 'identity-a-hydrated';
    await flushPromises();
    await ready(wrapper);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('hello.txt');
    expect(s3.listS3Objects).toHaveBeenCalledTimes(2);
    expect(s3.getS3Object).not.toHaveBeenCalled();
    expect(s3.putS3Object).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
  it('keeps the interruption warning and never replays a late write after an identity change', async () => {
    const s3 = storage(),
      { wrapper, identity } = mountView(s3);
    let finishWrite: (value: Awaited<ReturnType<S3StorageControl['putS3Object']>>) => void = () => {
      throw new Error('Deferred write not initialized');
    };
    s3.putS3Object.mockReturnValueOnce(
      new Promise((resolve) => {
        finishWrite = resolve;
      })
    );
    await ready(wrapper);
    await choose(wrapper);
    bodyButton('确认创建').click();
    await flushPromises();
    expect(s3.putS3Object).toHaveBeenCalledOnce();
    s3.s3StorageConfiguration.mockResolvedValue(summary('b'.repeat(64)));
    identity.value = 'identity-b';
    await flushPromises();
    await ready(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toContain('账户或存储配置已变化');
    identity.value = 'identity-b-hydrated';
    await flushPromises();
    await ready(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toContain('账户或存储配置已变化');
    finishWrite({ key: 'upload.txt', etag: null });
    await flushPromises();
    expect(s3.putS3Object).toHaveBeenCalledOnce();
    expect(s3.getS3Object).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it('retains an unknown-write warning across later idle identity initialization', async () => {
    const s3 = storage(),
      { wrapper, identity } = mountView(s3);
    s3.putS3Object.mockRejectedValueOnce(new Error('timeout'));
    await ready(wrapper);
    await choose(wrapper);
    bodyButton('确认创建').click();
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('写入结果未知');
    identity.value = 'identity-a-hydrated';
    await flushPromises();
    await ready(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toContain('写入结果未知');
    expect(s3.putS3Object).toHaveBeenCalledOnce();
    expect(s3.getS3Object).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it('drops a pending confirmation on identity changes', async () => {
    const s3 = storage(),
      { wrapper, identity } = mountView(s3);
    await ready(wrapper);
    await choose(wrapper);
    identity.value = 'identity-b';
    s3.s3StorageConfiguration.mockResolvedValue(summary('b'.repeat(64)));
    await flushPromises();
    expect(document.body.textContent).not.toContain('目标：upload.txt');
    expect(s3.putS3Object).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('账户或存储配置已变化');
    wrapper.unmount();
    expect(s3.getS3Object).not.toHaveBeenCalled();
  });
  it('blocks VueFinder unguarded hotkeys and external drops before library handlers run', async () => {
    const s3 = storage(),
      { wrapper } = mountView(s3);
    await ready(wrapper);
    const target = wrapper.get('[data-testid="vuefinder-fixture"]');
    const key = vi.fn(),
      drop = vi.fn();
    target.element.addEventListener('keydown', key);
    target.element.addEventListener('drop', drop);
    await target.trigger('keydown', { code: 'KeyE', metaKey: true });
    await target.trigger('keydown', { code: 'KeyS', metaKey: true });
    await target.trigger('keydown', { code: 'Space' });
    await target.trigger('drop');
    expect(key).not.toHaveBeenCalled();
    expect(drop).not.toHaveBeenCalled();
    expect(s3.getS3Object).not.toHaveBeenCalled();
    expect(s3.putS3Object).not.toHaveBeenCalled();
    await wrapper.get('[data-entry="hello.txt"]').trigger('click');
    await target.trigger('keydown', { code: 'Space' });
    await flushPromises();
    expect(s3.getS3Object).toHaveBeenCalledExactlyOnceWith('hello.txt', { storageContext: context });
    expect(document.body.querySelector('[data-testid="files-text-preview"]')?.textContent).toBe('abc');
  });
  it('provides keyboard-focusable safe folder and preview actions', async () => {
    const s3 = storage(),
      { wrapper } = mountView(s3);
    await ready(wrapper);
    const folder = wrapper.get('button[aria-label="目录: folder"]');
    await folder.trigger('click');
    await flushPromises();
    expect(s3.listS3Objects).toHaveBeenLastCalledWith(
      { prefix: 'folder/', maximum: 100, delimiter: '/' },
      { storageContext: context }
    );
    expect(s3.getS3Object).not.toHaveBeenCalled();
  });
  it('downloads only via the bounded control and revokes temporary object URLs on unmount', async () => {
    const s3 = storage(),
      { wrapper } = mountView(s3);
    const create = vi.fn(() => 'blob:files-test'),
      revoke = vi.fn();
    const OriginalURL = URL;
    vi.stubGlobal(
      'URL',
      class extends OriginalURL {
        static override createObjectURL = create;
        static override revokeObjectURL = revoke;
      }
    );
    const downloads: { href: string; name: string }[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      downloads.push({ href: this.href, name: this.download });
    });
    await ready(wrapper);
    await wrapper.get('[data-entry="hello.txt"]').trigger('click');
    await wrapper.get('[data-testid="files-download"]').trigger('click');
    await flushPromises();
    expect(downloads).toEqual([{ href: 'blob:files-test', name: 'hello.txt' }]);
    expect(create).toHaveBeenCalledOnce();
    expect(s3.getS3Object).toHaveBeenCalledExactlyOnceWith('hello.txt', { storageContext: context });
    wrapper.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:files-test');
    click.mockRestore();
  });
  it('ignores a late preview read after unmount without scheduling more work', async () => {
    const s3 = storage(),
      { wrapper } = mountView(s3);
    let resolve: (value: Awaited<ReturnType<S3StorageControl['getS3Object']>>) => void = () => {
      throw new Error('Deferred read not initialized');
    };
    const pending = new Promise<Awaited<ReturnType<S3StorageControl['getS3Object']>>>((done) => {
      resolve = done;
    });
    s3.getS3Object.mockReturnValue(pending);
    await ready(wrapper);
    await wrapper.get('[data-entry="hello.txt"]').trigger('click');
    await wrapper.get('[data-testid="files-preview"]').trigger('click');
    await vi.waitFor(() => {
      expect(s3.getS3Object).toHaveBeenCalledOnce();
    });
    const summaries = s3.s3StorageConfiguration.mock.calls.length;
    wrapper.unmount();
    resolve({ key: 'hello.txt', bytes: new Uint8Array([65]), contentType: null, etag: null });
    await flushPromises();
    expect(s3.s3StorageConfiguration).toHaveBeenCalledTimes(summaries);
    expect(document.body.querySelector('[data-testid="files-text-preview"]')).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
