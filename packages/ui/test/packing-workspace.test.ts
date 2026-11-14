// @vitest-environment jsdom
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PackingWorkspace from '../src/components/PackingWorkspace.vue';
import { packCargo, type PackingInput, type PackingResult } from '../src/lib/packing-layout';
import { uiI18n } from '../src/i18n';
import '../src/i18n/logistics';

const sceneDisposed = vi.hoisted(() => vi.fn());
vi.mock('../src/components/PackingScene.vue', () => ({
  __esModule: true,
  default: defineComponent({
    name: 'PackingScene',
    setup: () => () => h('div', { 'data-testid': 'packing-scene-stub' }),
    beforeUnmount: sceneDisposed
  })
}));

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: MessageEvent<{ result: PackingResult }>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn<(input: PackingInput) => void>();
  constructor() {
    TestWorker.instances.push(this);
  }
  finish(): void {
    const input = this.postMessage.mock.calls[0]?.[0];
    if (!input) throw new Error('Missing worker input');
    this.onmessage?.({ data: { result: packCargo(input) } } as MessageEvent<{ result: PackingResult }>);
  }
}
function createWorkspace() {
  return mount(PackingWorkspace, { props: { active: true }, attachTo: document.body });
}
let wrapper: ReturnType<typeof createWorkspace>;
const button = (text: string) => {
  const target = wrapper.findAll('button').find((item) => item.text() === text);
  if (!target) throw new Error('Missing button ' + text);
  return target;
};
async function example(): Promise<void> {
  await wrapper.get('[data-testid="packing-example"]').trigger('click');
}
async function start(): Promise<TestWorker> {
  await wrapper.get('[data-testid="packing-generate"]').trigger('click');
  const worker = TestWorker.instances.at(-1);
  if (!worker) throw new Error('Worker not created');
  return worker;
}
beforeEach(() => {
  localStorage.clear();
  TestWorker.instances = [];
  sceneDisposed.mockClear();
  vi.stubGlobal('Worker', TestWorker);
  uiI18n.global.locale.value = 'zh-CN';
  wrapper = createWorkspace();
});
afterEach(() => {
  wrapper.unmount();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  uiI18n.global.locale.value = 'zh-CN';
});

describe('packing workspace', () => {
  it('starts empty, validates dimensions and counts before creating a worker', async () => {
    expect(wrapper.get<HTMLInputElement>('[data-testid="packing-container-length"]').element.value).toBe('');
    await wrapper.get('[data-testid="packing-generate"]').trigger('click');
    expect(wrapper.get('[role="alert"]').text()).toContain('0.1–10,000');
    expect(TestWorker.instances).toHaveLength(0);
    await example();
    await wrapper.get('[data-testid="packing-container-length"]').setValue('60.01');
    await wrapper.get('[data-testid="packing-generate"]').trigger('click');
    expect(wrapper.get('[role="alert"]').text()).toContain('一位小数');
    await wrapper.get('[data-testid="packing-container-length"]').setValue('60');
    await wrapper.get('[data-testid="packing-cargo-0"] input[inputmode="numeric"]').setValue('500');
    await wrapper.get('[data-testid="packing-generate"]').trigger('click');
    expect(wrapper.get('[role="alert"]').text()).toContain('500');
    expect(TestWorker.instances).toHaveLength(0);
  });

  it('renders actual worker statistics, invalidates edits, and disposes the scene on hide', async () => {
    await example();
    const worker = await start();
    expect(wrapper.find('[data-testid="packing-generate"]').exists()).toBe(false);
    worker.finish();
    await flushPromises();
    expect(wrapper.get('[data-testid="packing-results"]').text()).toContain('62.2%');
    expect(wrapper.get('[data-testid="packing-packed"]').text()).toBe('20');
    expect(wrapper.get('[data-testid="packing-results"]').text()).toContain('0.084 m³');
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="packing-scene-stub"]').exists()).toBe(true);
    });
    await wrapper.setProps({ active: false });
    expect(sceneDisposed).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-testid="packing-container-length"]').element).toHaveProperty('value', '60');
    await wrapper.setProps({ active: true });
    await flushPromises();
    expect(wrapper.find('[data-testid="packing-scene-stub"]').exists()).toBe(true);
    await wrapper.get('[data-testid="packing-container-length"]').setValue('61');
    expect(wrapper.find('[data-testid="packing-packed"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="packing-scene-stub"]').exists()).toBe(false);
  });

  it('stops and ignores late messages on stop, hide, edits, and unmount', async () => {
    await example();
    for (const action of ['stop', 'hide', 'edit'] as const) {
      const worker = await start();
      if (action === 'stop') await wrapper.get('[data-testid="packing-stop"]').trigger('click');
      if (action === 'hide') await wrapper.setProps({ active: false });
      if (action === 'edit') await wrapper.get('[data-testid="packing-container-length"]').setValue('62');
      expect(worker.terminate).toHaveBeenCalledOnce();
      worker.finish();
      await flushPromises();
      expect(wrapper.find('[data-testid="packing-packed"]').exists()).toBe(false);
      await wrapper.setProps({ active: true });
    }
    const last = await start();
    wrapper.unmount();
    expect(last.terminate).toHaveBeenCalledOnce();
  });

  it('does not apply replacement until confirmed, and does not recalculate for a locale change', async () => {
    await example();
    const worker = await start();
    worker.finish();
    await flushPromises();
    await button('清空').trigger('click');
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    const cancel = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (item) => item.textContent.trim() === '取消'
    );
    cancel?.click();
    await flushPromises();
    expect(wrapper.get('[data-testid="packing-packed"]').text()).toBe('20');
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(wrapper.text()).toContain('Packing results');
    expect(TestWorker.instances).toHaveLength(1);
    await button('Clear').trigger('click');
    const confirm = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')
    ).find((item) => item.textContent.trim() === 'Confirm');
    expect(confirm).toBeDefined();
    confirm?.click();
    await flushPromises();
    expect(wrapper.get('[data-testid="packing-container-length"]').element).toHaveProperty('value', '');
    wrapper.unmount();
    wrapper = createWorkspace();
    expect(wrapper.find('[data-testid="packing-packed"]').exists()).toBe(false);
  });

  it('handles worker errors without fallback results and stops in hidden documents', async () => {
    await example();
    const first = await start();
    first.onerror?.(new ErrorEvent('error', { cancelable: true }));
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('无法完成排布');
    expect(wrapper.find('[data-testid="packing-packed"]').exists()).toBe(false);
    const second = await start();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(second.terminate).toHaveBeenCalledOnce();
    second.finish();
    await flushPromises();
    expect(wrapper.find('[data-testid="packing-packed"]').exists()).toBe(false);
    hidden.mockRestore();
  });
});
