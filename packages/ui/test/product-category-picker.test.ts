// @vitest-environment jsdom

import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ProductCategoryPicker from '../src/components/ProductCategoryPicker.vue';

describe('ProductCategoryPicker', () => {
  it('browses parent categories and selects a publishable leaf', async () => {
    const wrapper = mount(ProductCategoryPicker, {
      attachTo: document.body,
      props: {
        modelValue: '',
        search: '',
        categories: [
          {
            id: 10,
            name: 'Apparel',
            leaf: false,
            children: [{ id: 11, name: 'Dresses', leaf: true, children: [] }]
          },
          { id: 20, name: 'Bags', leaf: true, children: [] }
        ]
      }
    });

    expect(wrapper.get('[role="combobox"]').text()).toContain('请选择商品类目');
    await wrapper.get('[role="combobox"]').trigger('click');
    await nextTick();

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    if (!dialog) throw new Error('Category dialog was not rendered');
    expect(dialog.textContent).toContain('Apparel');
    expect(dialog.textContent).toContain('Bags');

    const apparel = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent.includes('Apparel')
    );
    apparel?.click();
    await nextTick();
    expect(wrapper.emitted('update:modelValue')).toEqual([['10']]);
    expect(wrapper.emitted('select')).toEqual([[10]]);
    expect(document.body.textContent).toContain('Dresses');

    const dresses = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent.includes('Dresses')
    );
    dresses?.click();
    await nextTick();

    expect(wrapper.emitted('update:modelValue')).toEqual([['10'], ['11']]);
    expect(wrapper.emitted('select')).toEqual([[10], [11]]);
    wrapper.unmount();
  });

  it('keeps the exact category of an existing product visible outside the loaded root tree', () => {
    const wrapper = mount(ProductCategoryPicker, {
      props: {
        modelValue: '201712702',
        search: '',
        categories: [{ id: 10, name: 'Apparel', leaf: false, children: [] }],
        currentCategory: {
          id: 201712702,
          name: "Women's Tote Bags",
          leaf: true,
          children: []
        },
        disabled: true
      }
    });

    expect(wrapper.get('[role="combobox"]').text()).toContain("Women's Tote Bags");
    expect(wrapper.text()).toContain('可发布类目 · ID 201712702');
    expect(wrapper.get('[role="combobox"]').attributes('disabled')).toBeDefined();
  });

  it('keeps a failed branch retry available inside the category dialog', async () => {
    const wrapper = mount(ProductCategoryPicker, {
      attachTo: document.body,
      props: {
        modelValue: '10',
        search: '',
        categories: [{ id: 10, name: 'Apparel', leaf: false, children: [] }],
        error: '类目服务暂时不可用'
      }
    });

    await wrapper.get('[role="combobox"]').trigger('click');
    await nextTick();
    const retry = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent.includes('重新加载')
    );
    expect(retry).toBeDefined();
    retry?.click();
    await nextTick();
    expect(wrapper.emitted('retry')).toHaveLength(1);
    wrapper.unmount();
  });
});
