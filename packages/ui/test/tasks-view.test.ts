// @vitest-environment jsdom
import { computed, defineComponent, h, ref } from 'vue';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/task-center/summaries.json';
import TasksView from '../src/views/TasksView.vue';
import { provideServices } from '../src/lib/services';
import { provideListIdentityScope } from '../src/lib/list-identity-scope';
import { loadTaskCenterSnapshot, type TaskSummary } from '../src/lib/task-center';
import type * as TaskCenterModule from '../src/lib/task-center';
import { uiI18n } from '../src/i18n';

vi.mock('../src/lib/task-center', async (original) => ({
  ...(await original<typeof TaskCenterModule>()),
  loadTaskCenterSnapshot: vi.fn()
}));
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const load = vi.mocked(loadTaskCenterSnapshot);
const snapshot = () => ({
  ...structuredClone(fixture),
  items: structuredClone(fixture.items) as TaskSummary[],
  errors: []
});
const wrappers: VueWrapper[] = [];
function setup() {
  const scope = ref('fixture-scope');
  const request = vi.fn(),
    current = vi.fn().mockResolvedValue(fixture.context);
  const Host = defineComponent({
    setup() {
      provideServices({
        mode: 'bff',
        gateway: { request, galleryTransferContext: current },
        settings: { load: vi.fn(), save: vi.fn() }
      });
      provideListIdentityScope(computed(() => scope.value));
      return () => h(TasksView);
    }
  });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      stubs: {
        ProductVideoAssociation: defineComponent({
          emits: ['busy'],
          setup(_, { emit }) {
            return () =>
              h(
                'button',
                {
                  onClick: () => {
                    emit('busy', true);
                  }
                },
                'Hold verification'
              );
          }
        })
      }
    }
  });
  wrappers.push(wrapper);
  return { wrapper, scope, request, current, body: new DOMWrapper(document.body) };
}
function button(body: DOMWrapper<Element> | VueWrapper, text: string) {
  const result = body.findAll('button').find((value) => value.text() === text);
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}
async function openDetails(s: ReturnType<typeof setup>, id: string) {
  await s.wrapper.get(`button[aria-label="${id}的操作"]`).trigger('click');
  await flushPromises();
  await button(s.body, '查看详情').trigger('click');
  await flushPromises();
}
beforeEach(() => {
  load.mockReset().mockImplementation(() => Promise.resolve(snapshot()));
  localStorage.clear();
  location.hash = '#/tasks';
  uiI18n.global.locale.value = 'zh-CN';
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => {
    wrapper.unmount();
  });
  vi.restoreAllMocks();
});
describe('unified task center', () => {
  it('prioritizes attention, filters a draft on apply, preserves selection and never executes a task', async () => {
    const s = setup();
    await flushPromises();
    expect(s.request).not.toHaveBeenCalled();
    expect(button(s.wrapper, '搜索').exists()).toBe(true);
    expect(s.wrapper.text()).toContain('需要处理 2');
    expect(s.wrapper.findAll('tbody tr')[0]?.text()).toContain('10000002');
    await button(s.wrapper, '筛选').trigger('click');
    await flushPromises();
    await s.body.get('[role="dialog"] select').setValue('video-upload');
    expect(s.wrapper.text()).toContain('Fixture gallery transfer');
    await button(s.body, '取消').trigger('click');
    await flushPromises();
    expect(s.wrapper.text()).toContain('Fixture gallery transfer');
    await button(s.wrapper, '筛选').trigger('click');
    await flushPromises();
    await s.body.get('[role="dialog"] select').setValue('video-upload');
    await button(s.body, '应用筛选').trigger('click');
    await flushPromises();
    expect(s.wrapper.text()).not.toContain('Fixture gallery transfer');
    expect(s.wrapper.text()).toContain('Fixture video');
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('shows receipts and unknown ownership, then opens a read-only source history route', async () => {
    const s = setup();
    await flushPromises();
    await openDetails(s, 'product:product-task');
    expect(s.body.get('[role="dialog"]').text()).toContain('历史账号归属待确认');
    expect(s.body.get('[role="dialog"]').text()).toContain('fixture-trace');
    expect(s.body.get('[role="dialog"]').text()).toContain('2026-09-27');
    await button(s.body, '打开原任务').trigger('click');
    await flushPromises();
    expect(location.hash).toBe('#/products/tasks/product-task/history');
    expect(s.request).not.toHaveBeenCalled();
  });
  it('does not refetch for UI language changes and supports English details', async () => {
    const s = setup();
    await flushPromises();
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(s.wrapper.text()).toContain('Task center');
    expect(button(s.wrapper, 'Search').exists()).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(s.request).not.toHaveBeenCalled();
  });
  it('discards late results after identity changes and clears details', async () => {
    let finish: ((value: ReturnType<typeof snapshot>) => void) | undefined;
    load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const s = setup();
    await flushPromises();
    load.mockResolvedValue({ ...snapshot(), items: [] });
    s.scope.value = 'other';
    await flushPromises();
    finish?.(snapshot());
    await flushPromises();
    expect(s.wrapper.text()).not.toContain('Fixture video');
    expect(s.wrapper.findAll('[role="dialog"]')).toHaveLength(0);
  });
  it('refuses a source handoff after credential replacement', async () => {
    const s = setup();
    await flushPromises();
    await openDetails(s, 'product:product-task');
    s.current.mockResolvedValue({ ...fixture.context, gateway: 'different' });
    await button(s.body, '打开原任务').trigger('click');
    await flushPromises();
    expect(location.hash).toBe('#/tasks');
    expect(s.wrapper.text()).not.toContain('Fixture video');
    expect(s.request).not.toHaveBeenCalled();
  });
  it('discards a source handoff after closing details without clearing a newer snapshot', async () => {
    const s = setup();
    await flushPromises();
    await openDetails(s, 'product:product-task');
    let finish: ((value: typeof fixture.context) => void) | undefined;
    s.current.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await button(s.body, '打开原任务').trigger('click');
    await s.body.get('button[aria-label="关闭详情"]').trigger('click');
    await flushPromises();
    await s.wrapper.get('form').trigger('submit');
    await flushPromises();
    finish?.({ ...fixture.context, gateway: 'changed-after-close' });
    await flushPromises();
    expect(location.hash).toBe('#/tasks');
    expect(s.wrapper.text()).toContain('Fixture video');
    expect(s.body.find('[role="dialog"]').exists()).toBe(false);
  });
  it('marks partial results, keeps errors visible and explicitly loads older product records', async () => {
    load.mockResolvedValue({
      ...snapshot(),
      productHasMore: true,
      errors: [{ source: 'video-upload', code: 'FORBIDDEN' }],
      unscopedQueueCount: 2
    });
    const s = setup();
    await flushPromises();
    expect(s.wrapper.text()).toContain('部分记录未能读取');
    expect(s.wrapper.text()).toContain('本机有 2 条旧队列记录');
    load.mockResolvedValue({ ...snapshot(), items: [] });
    await button(s.wrapper, '加载更多商品任务').trigger('click');
    await flushPromises();
    expect(load.mock.calls[1]?.[4]).toBe(2);
    expect(s.wrapper.text()).toContain('product-task');
    expect(s.request).not.toHaveBeenCalled();
  });
  it('clears association busy state when an account invalidates the mounted detail', async () => {
    const s = setup();
    await flushPromises();
    const association = fixture.items.find((item) => item.source === 'video-association');
    if (!association) throw new Error('Missing association fixture');
    await openDetails(s, association.id);
    await button(s.body, '查看关联回执与核对').trigger('click');
    await flushPromises();
    await button(s.body, 'Hold verification').trigger('click');
    s.scope.value = 'changed-during-verification';
    await flushPromises();
    await openDetails(s, 'product:product-task');
    await s.body.get('button[aria-label="关闭详情"]').trigger('click');
    await flushPromises();
    expect(s.body.find('[role="dialog"]').exists()).toBe(false);
  });
});
