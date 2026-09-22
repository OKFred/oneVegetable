// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import OrderListFilters from '../src/components/OrderListFilters.vue';

function button(label: string): HTMLButtonElement {
  const element = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
  if (!element) throw new Error(`Missing button: ${label}`);
  return element;
}
async function click(label: string): Promise<void> {
  button(label).click();
  await flushPromises();
}
async function input(label: string, value: string): Promise<void> {
  const element = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!element) throw new Error(`Missing input: ${label}`);
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  await flushPromises();
}
afterEach(() => {
  document.body.replaceChildren();
});
describe('order filter draft', () => {
  it('does not apply edits or reset until confirmed and discards cancelled changes', async () => {
    const wrapper = mount(OrderListFilters, { props: { modelValue: {} }, attachTo: document.body });
    await click('筛选');
    const text = document.querySelector<HTMLInputElement>('input:not([type="datetime-local"])');
    expect(text).not.toBeNull();
    const label = text?.getAttribute('aria-label') ?? '';
    await input(label, 'seller-one');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    await click('取消');
    await click('筛选');
    expect(document.querySelector<HTMLInputElement>('input:not([type="datetime-local"])')?.value).toBe('');
    await input(label, 'seller-two');
    await click('应用筛选');
    expect(wrapper.emitted('update:modelValue')).toEqual([[{ salesmanId: 'seller-two' }]]);
    wrapper.unmount();
  });
  it('rejects reversed ranges, counts one date interval, and preserves platform wall-clock semantics', async () => {
    const wrapper = mount(OrderListFilters, {
      props: { modelValue: { createDateStart: '2026-09-01 00:00:00', createDateEnd: '2026-09-02 23:59:59' } },
      attachTo: document.body
    });
    expect(wrapper.text()).toContain('· 1');
    button('筛选 · 1').click();
    await flushPromises();
    const dates = [...document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')];
    await input(dates[0]?.getAttribute('aria-label') ?? '', '2026-09-03T10:00');
    expect(button('应用筛选').disabled).toBe(true);
    await input(dates[1]?.getAttribute('aria-label') ?? '', '2026-09-04T11:00');
    await click('应用筛选');
    expect(wrapper.emitted('update:modelValue')).toEqual([
      [
        {
          createDateStart: '2026-09-03 10:00:00',
          createDateEnd: '2026-09-04 11:00:59'
        }
      ]
    ]);
    wrapper.unmount();
  });
});
