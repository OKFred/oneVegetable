// @vitest-environment jsdom
import { defineComponent, h, nextTick, type Component, type PropType } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContentSkeleton from '../src/components/ContentSkeleton.vue';
import QueryState from '../src/components/QueryState.vue';
import { defineAsyncContent } from '../src/lib/async-content';
import { uiI18n } from '../src/i18n';

const mounted: VueWrapper[] = [];
const AsyncHost = defineComponent({
  props: { content: { type: Object as PropType<Component>, required: true } },
  setup: (props) => () => h(props.content)
});
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => {
    wrapper.unmount();
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
  uiI18n.global.locale.value = 'zh-CN';
});

describe('shared loading feedback', () => {
  it.each(['page', 'panel', 'table', 'authorization'] as const)(
    'renders an accessible %s skeleton with reduced-motion support',
    (layout) => {
      const wrapper = mount(ContentSkeleton, { props: { layout } });
      mounted.push(wrapper as VueWrapper);
      expect(wrapper.attributes('aria-busy')).toBe('true');
      expect(wrapper.attributes('role')).toBe('status');
      expect(wrapper.get('[aria-hidden="true"]').classes()).toContain('motion-safe:animate-pulse');
      expect(wrapper.text()).toContain('正在加载');
      expect(wrapper.findAll('button')).toHaveLength(0);
    }
  );

  it('explains a slow response after eight seconds and releases its timer on unmount', async () => {
    vi.useFakeTimers();
    const wrapper = mount(ContentSkeleton);
    mounted.push(wrapper as VueWrapper);
    await vi.advanceTimersByTimeAsync(7999);
    expect(wrapper.text()).not.toContain('加载时间较长');
    await vi.advanceTimersByTimeAsync(1);
    expect(wrapper.text()).toContain('加载时间较长');
    uiI18n.global.locale.value = 'en-US';
    await nextTick();
    expect(wrapper.text()).toContain('Taking longer than usual');
    const pending = mount(ContentSkeleton);
    expect(vi.getTimerCount()).toBe(1);
    pending.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not flash a skeleton for a fast lazy component', async () => {
    vi.useFakeTimers();
    const ready = { template: '<p>Ready content</p>' };
    const content = defineAsyncContent(() => Promise.resolve(ready), 'page');
    const wrapper = mount(AsyncHost, { props: { content } });
    mounted.push(wrapper);
    await flushPromises();
    expect(wrapper.text()).toBe('Ready content');
    expect(wrapper.find('[data-skeleton-layout]').exists()).toBe(false);
  });

  it('covers a slow module download without blocking other UI or starting another request', async () => {
    vi.useFakeTimers();
    const ready = { template: '<p>Ready content</p>' };
    let resolve!: (component: typeof ready) => void;
    const loader = vi.fn(
      () =>
        new Promise<typeof ready>((done) => {
          resolve = done;
        })
    );
    const content = defineAsyncContent(loader, 'page');
    const wrapper = mount(AsyncHost, { props: { content } });
    mounted.push(wrapper);
    await vi.advanceTimersByTimeAsync(150);
    expect(wrapper.find('[data-skeleton-layout="page"]').exists()).toBe(true);
    expect(loader).toHaveBeenCalledOnce();
    resolve(ready);
    await flushPromises();
    expect(wrapper.text()).toBe('Ready content');
    expect(wrapper.find('[data-skeleton-layout]').exists()).toBe(false);
  });

  it('shows a failed module explicitly instead of an endless loading skeleton', async () => {
    const failure = vi.fn();
    const content = defineAsyncContent(() => Promise.reject(new Error('module-unavailable')));
    const wrapper = mount(AsyncHost, {
      props: { content },
      global: { config: { errorHandler: failure }, stubs: { ErrorNotice: true } }
    });
    mounted.push(wrapper);
    await flushPromises();
    expect(wrapper.text()).toContain('页面模块加载失败');
    expect(wrapper.find('[data-skeleton-layout]').exists()).toBe(false);
  });

  it('keeps cached content and DOM state when a query refreshes or fails', async () => {
    const wrapper = mount(QueryState, {
      props: { hasContent: true },
      slots: { default: '<input value="unsaved text" />' },
      global: { stubs: { ErrorNotice: true } }
    });
    mounted.push(wrapper as VueWrapper);
    const input = wrapper.get('input').element;
    await wrapper.setProps({ loading: true, refreshing: true });
    expect(wrapper.get('input').element).toBe(input);
    expect(wrapper.find('[data-skeleton-layout]').exists()).toBe(false);
    expect(wrapper.attributes('aria-busy')).toBe('true');
    await wrapper.setProps({ loading: false, refreshing: false, error: new Error('offline') });
    expect(wrapper.get('input').element).toBe(input);
    expect(wrapper.findComponent({ name: 'ErrorNotice' }).exists()).toBe(true);
  });
});
