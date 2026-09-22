// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ProductListFilterDialog from '../src/components/ProductListFilterDialog.vue';
import ListFilterDialog from '../src/components/ListFilterDialog.vue';
import {
  emptyProductListFilters,
  invalidProductFilters,
  productFilterCount,
  productFilterPayload
} from '../src/composables/product-list-filters';

describe('product list filters', () => {
  it('counts a date range once, keeps page status out of provider payload, rejects invalid IDs/ranges', () => {
    const filters = {
      ...emptyProductListFilters(),
      productId: '16000001',
      modifiedFrom: '2026-09-01T12:00',
      modifiedTo: '2026-09-02T12:00',
      status: 'online'
    };
    expect(productFilterCount(filters)).toBe(3);
    expect(productFilterPayload(filters)).toEqual({
      productId: '16000001',
      modifiedDateStart: '2026-09-01 12:00:00',
      modifiedDateEnd: '2026-09-02 12:00:59'
    });
    expect(invalidProductFilters(filters)).toBe(false);
    expect(invalidProductFilters({ ...filters, productId: '-1' })).toBe(true);
    expect(invalidProductFilters({ ...filters, categoryId: '9007199254740993' })).toBe(true);
    expect(invalidProductFilters({ ...filters, modifiedTo: '2026-08-01T12:00' })).toBe(true);
    expect(invalidProductFilters({ ...filters, modifiedFrom: '2026-02-30T12:00' })).toBe(true);
    expect(productFilterPayload({ ...filters, modifiedFrom: '2026-09-01T12:00:12' }).modifiedDateStart).toBe(
      '2026-09-01 12:00:12'
    );
  });

  it('isolates edits and reset until Apply, and discards cancelled edits', async () => {
    const wrapper = mount(ProductListFilterDialog, {
      props: { modelValue: { ...emptyProductListFilters(), productId: '123' } },
      global: { stubs: { ListFilterDialog: { props: ['open', 'invalid'], template: '<div><slot /></div>' } } }
    });
    const dialog = wrapper.getComponent(ListFilterDialog);
    const emit = (event: string, value?: boolean) => {
      (dialog.vm as { $emit(event: string, value?: boolean): void }).$emit(event, value);
    };
    emit('update:open', true);
    await flushPromises();
    await wrapper.findAll('input')[0]?.setValue('456');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    emit('update:open', false);
    await flushPromises();
    emit('update:open', true);
    await flushPromises();
    expect((wrapper.findAll('input')[0]?.element as HTMLInputElement).value).toBe('123');
    emit('reset');
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    emit('apply');
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([emptyProductListFilters()]);
    wrapper.unmount();
  });
});
