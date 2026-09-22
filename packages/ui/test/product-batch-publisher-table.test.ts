// @vitest-environment jsdom
import { defineComponent, h, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/product-batch-publish.json';
import ProductBatchPublisher from '../src/components/ProductBatchPublisher.vue';
import { upsertProductBatchPublishItem } from '../src/lib/product-batch-publish';
import { uiI18n } from '../src/i18n';

beforeEach(() => {
  localStorage.clear();
  uiI18n.global.locale.value = 'zh-CN';
});
afterEach(() => {
  document.body.innerHTML = '';
});

function mountQueue() {
  const items = Array.from({ length: 12 }, (_, index) =>
    upsertProductBatchPublishItem(
      localStorage,
      {
        title: `Queue item ${index + 1}`,
        categoryId: '201712702',
        language: 'en_US',
        market: 'wholesale',
        xml: fixture.validXml
      },
      { id: `queue-${index + 1}` }
    )
  );
  const last = items.at(-1);
  if (last) last.status = 'draft-saved';
  const selected = ref<string[]>([]);
  const edit = vi.fn();
  const remove = vi.fn();
  const wrapper = mount(
    defineComponent({
      setup() {
        return () =>
          h(ProductBatchPublisher, {
            items,
            selectedIds: selected.value,
            target: 'draft',
            results: {},
            activeItemId: '',
            running: false,
            draftAllowed: true,
            publishAllowed: true,
            draftDisabledReason: '',
            publishDisabledReason: '',
            categoryLabels: {},
            'onUpdate:selectedIds': (ids: string[]) => {
              selected.value = ids;
            },
            onEdit: edit,
            onRemove: remove
          });
      }
    }),
    { attachTo: document.body }
  );
  return { wrapper, selected, items, edit, remove };
}

describe('batch publisher shared table', () => {
  it('selects only eligible current-page items with a mixed header and clears on paging', async () => {
    const { wrapper, selected } = mountQueue();
    await wrapper.get('select[aria-label="每页条数"]').setValue('10');
    await wrapper.get('input[aria-label="选择 Queue item 1"]').setValue(true);
    const header = wrapper.get<HTMLInputElement>('input[aria-label="选择当前页"]');
    expect(header.element.indeterminate).toBe(true);
    expect(header.attributes('aria-checked')).toBe('mixed');
    await header.setValue(true);
    expect(selected.value).toHaveLength(10);
    expect(wrapper.text()).toContain('已选 10 个');
    await wrapper.get('button[aria-label="下一页"]').trigger('click');
    expect(selected.value).toEqual([]);
    await wrapper.get('input[aria-label="选择当前页"]').setValue(true);
    expect(selected.value).toEqual(['queue-11']);
    expect(wrapper.get('input[aria-label="选择 Queue item 12"]').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('keeps edit and remove in the action menu without changing emitted items', async () => {
    const { wrapper, items, edit, remove } = mountQueue();
    await wrapper.get('button[aria-label="queue-1的操作"]').trigger('click');
    await flushPromises();
    const action = (text: string) => {
      const found = Array.from(document.querySelectorAll<HTMLButtonElement>('.row-actions button')).find(
        (button) => button.textContent.trim() === text
      );
      if (!found) throw new Error(`Missing ${text}`);
      return found;
    };
    action('编辑').click();
    await flushPromises();
    expect(edit).toHaveBeenCalledWith(items[0]);
    await wrapper.get('button[aria-label="queue-1的操作"]').trigger('click');
    await flushPromises();
    action('移除').click();
    await flushPromises();
    expect(remove).toHaveBeenCalledWith(items[0]);
    wrapper.unmount();
  });
});
