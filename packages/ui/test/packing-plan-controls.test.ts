// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import input from '../../../mock/data/logistics/packing-example.json';
import PackingPlanControls from '../src/components/PackingPlanControls.vue';
import {
  createPackingPlan,
  PACKING_PLANS_STORAGE_KEY,
  readSavedPackingPlans,
  savePackingPlan,
  serializePackingPlan
} from '../src/lib/packing-plans';
import { uiI18n } from '../src/i18n';
import '../src/i18n/logistics';

const feedback = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock('vue-sonner', () => ({ toast: feedback }));
const create = (hasInput = true) =>
  mount(PackingPlanControls, {
    props: { active: true, hasInput, readInput: () => structuredClone(input) },
    attachTo: document.body
  });
let wrapper: ReturnType<typeof create>;
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  uiI18n.global.locale.value = 'zh-CN';
  wrapper = create();
});
afterEach(() => {
  wrapper.unmount();
  document.body.innerHTML = '';
  localStorage.clear();
  vi.restoreAllMocks();
  uiI18n.global.locale.value = 'zh-CN';
});
async function click(text: string): Promise<void> {
  const target = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent.trim() === text
  );
  expect(target, text).toBeDefined();
  target?.click();
  await flushPromises();
}
async function save(name: string): Promise<void> {
  await wrapper.get('[data-testid="packing-plan-save"]').trigger('click');
  const field = document.querySelector<HTMLInputElement>('[data-testid="packing-plan-name"]');
  expect(field).not.toBeNull();
  if (!field) throw new Error('Missing name');
  field.value = name;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flushPromises();
}
async function importText(text: string | Promise<string>, size = 100): Promise<void> {
  const file = { size, text: () => Promise.resolve(text) };
  const field = wrapper.get<HTMLInputElement>('[data-testid="packing-plan-file"]');
  Object.defineProperty(field.element, 'files', { configurable: true, value: [file] });
  await field.trigger('change');
  await flushPromises();
}

describe('packing plan controls', () => {
  it('only persists after explicit save and opens a plan without restoring page edits automatically', async () => {
    await wrapper.get('[data-testid="packing-plan-save"]').trigger('click');
    await click('取消');
    expect(localStorage.getItem(PACKING_PLANS_STORAGE_KEY)).toBeNull();
    await save('Example');
    expect(readSavedPackingPlans()).toHaveLength(1);
    wrapper.unmount();
    wrapper = create(false);
    expect(wrapper.emitted('apply')).toBeUndefined();
    await wrapper.get('[data-testid="packing-plan-open"]').trigger('click');
    expect(document.querySelector('[aria-label="删除方案 Example"]')?.textContent.trim()).toBe('删除');
    await click('打开');
    expect(wrapper.emitted('apply')?.[0]?.[0]).toEqual(input);
    expect(feedback.info).not.toHaveBeenCalled();
  });
  it('confirms same-name overwrite and preserves the existing plan on cancel', async () => {
    await save('Example');
    const baseline = localStorage.getItem(PACKING_PLANS_STORAGE_KEY);
    await save('EXAMPLE');
    expect(document.body.textContent).toContain('覆盖同名方案');
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await click('取消');
    expect(localStorage.getItem(PACKING_PLANS_STORAGE_KEY)).toBe(baseline);
    await save('EXAMPLE');
    await click('确认');
    expect(readSavedPackingPlans()[0]?.plan.name).toBe('EXAMPLE');
    expect(readSavedPackingPlans()).toHaveLength(1);
  });
  it('validates import before confirming replacement and never trusts saved placements', async () => {
    const value = { ...createPackingPlan('Import', input), placements: ['not trusted'] };
    await importText(JSON.stringify(value));
    expect(wrapper.emitted('apply')).toBeUndefined();
    expect(document.body.textContent).toContain('替换当前输入');
    await click('取消');
    expect(wrapper.emitted('apply')).toBeUndefined();
    await importText(JSON.stringify(value));
    await click('确认');
    expect(wrapper.emitted('apply')?.[0]?.[0]).toEqual(input);
    expect(localStorage.getItem(PACKING_PLANS_STORAGE_KEY)).toBeNull();
    await importText('{invalid');
    expect(feedback.error).toHaveBeenCalled();
    expect(wrapper.emitted('apply')).toHaveLength(1);
  });
  it('rejects oversized imports and ignores a read that completes after the tab is hidden', async () => {
    await importText('{}', 65537);
    expect(feedback.error).toHaveBeenCalled();
    let finish: ((text: string) => void) | undefined;
    const text = new Promise<string>((resolve) => {
      finish = resolve;
    });
    await importText(text);
    await wrapper.setProps({ active: false });
    finish?.(serializePackingPlan(createPackingPlan('Late', input)));
    await flushPromises();
    expect(wrapper.emitted('apply')).toBeUndefined();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('shows storage errors without a success toast or overwriting old records', async () => {
    localStorage.setItem(PACKING_PLANS_STORAGE_KEY, '{broken');
    await save('Example');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('损坏');
    expect(localStorage.getItem(PACKING_PLANS_STORAGE_KEY)).toBe('{broken');
    expect(feedback.success).not.toHaveBeenCalled();
    await click('取消');
    localStorage.clear();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await save('Example');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('可用空间');
    expect(feedback.success).not.toHaveBeenCalled();
  });
  it('confirms deletion, supports English labels, and keeps only one modal visible', async () => {
    savePackingPlan(createPackingPlan('Example', input));
    uiI18n.global.locale.value = 'en-US';
    await wrapper.get('[data-testid="packing-plan-open"]').trigger('click');
    const remove = document.querySelector<HTMLButtonElement>('[aria-label="Delete plan Example"]');
    expect(remove?.textContent.trim()).toBe('Delete');
    remove?.click();
    await flushPromises();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.body.textContent).toContain('Delete this saved plan?');
    await click('Confirm');
    expect(readSavedPackingPlans()).toEqual([]);
    expect(document.body.textContent).toContain('No saved plans yet.');
  });
});
