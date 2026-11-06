// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { uiI18n } from '../src/i18n';
import GalleryView from '../src/views/GalleryView.vue';

vi.mock('../src/views/PhotosView.vue', () => ({
  __esModule: true,
  default: { template: '<div data-testid="images-panel" />' }
}));
vi.mock('../src/views/VideosView.vue', () => ({
  __esModule: true,
  default: { template: '<div data-testid="videos-panel" />' }
}));
vi.mock('../src/views/FilesView.vue', () => ({
  __esModule: true,
  default: { template: '<div data-testid="files-panel" />' }
}));

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  uiI18n.global.locale.value = 'zh-CN';
  globalThis.history.replaceState(null, '', '#/dashboard');
});

it.each([
  ['zh-CN', ['图片', '视频', '文件']],
  ['en-US', ['Images', 'Videos', 'Files']]
] as const)('renders three localized asset tabs in order (%s)', async (locale, labels) => {
  uiI18n.global.locale.value = locale;
  globalThis.history.replaceState(null, '', '#/photos');
  wrapper = mount(GalleryView);
  await flushPromises();
  expect(wrapper.findAll('nav a').map((link) => link.text())).toEqual(labels);
  expect(wrapper.get('a[href="#/photos"]').attributes('aria-current')).toBe('page');
  expect(wrapper.find('[data-testid="files-panel"]').exists()).toBe(false);
});

it.each([
  ['#/photos', 'images'],
  ['#/photos/videos/uploads/task-id', 'videos'],
  ['#/files', 'files']
])('restores the selected panel for %s', async (hash, panel) => {
  globalThis.history.replaceState(null, '', hash);
  wrapper = mount(GalleryView);
  await flushPromises();
  expect(wrapper.find('[data-testid="' + panel + '-panel"]').exists()).toBe(true);
  expect(wrapper.findAll('[data-testid$="-panel"]')).toHaveLength(1);
  expect(wrapper.findAll('nav [aria-current="page"]')).toHaveLength(1);
});

it('follows hash history without mounting hidden panels', async () => {
  globalThis.history.replaceState(null, '', '#/files');
  wrapper = mount(GalleryView);
  await flushPromises();
  for (const [hash, panel] of [
    ['#/photos/videos', 'videos'],
    ['#/photos', 'images'],
    ['#/files', 'files']
  ] as const) {
    globalThis.history.replaceState(null, '', hash);
    globalThis.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();
    expect(wrapper.find('[data-testid="' + panel + '-panel"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid$="-panel"]')).toHaveLength(1);
  }
});

it('does not expose or mount Files without permission', async () => {
  globalThis.history.replaceState(null, '', '#/files');
  wrapper = mount(GalleryView, { props: { filesAllowed: false } });
  await flushPromises();
  expect(wrapper.find('a[href="#/files"]').exists()).toBe(false);
  expect(wrapper.find('[data-testid="files-panel"]').exists()).toBe(false);
  expect(wrapper.get('a[href="#/photos"]').attributes('aria-current')).toBe('page');
  await wrapper.setProps({ filesAllowed: true });
  await flushPromises();
  expect(wrapper.get('a[href="#/files"]').attributes('aria-current')).toBe('page');
  expect(wrapper.find('[data-testid="files-panel"]').exists()).toBe(true);
});
