// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ProductCategoryPicker from '../src/components/ProductCategoryPicker.vue';

describe('ProductCategoryPicker', () => {
  it('shows an explicit placeholder and requests the selected parent branch', async () => {
    const wrapper = mount(ProductCategoryPicker, {
      props: {
        modelValue: '',
        search: '',
        categories: [
          { id: 10, name: 'Apparel', leaf: false, children: [] },
          { id: 20, name: 'Bags', leaf: true, children: [] }
        ]
      }
    });

    const select = wrapper.get('select[aria-label="商品类目"]');
    expect(select.text()).toContain('请选择商品类目');
    expect(select.text()).toContain('Apparel （选择后加载下级）');
    expect(select.text()).toContain('Bags');

    await select.setValue('10');

    expect(wrapper.emitted('update:modelValue')).toEqual([['10']]);
    expect(wrapper.emitted('select')).toEqual([[10]]);
  });

  it('keeps the exact category of an existing product visible outside the loaded root tree', () => {
    const wrapper = mount(ProductCategoryPicker, {
      props: {
        modelValue: '201712702',
        search: '',
        categories: [{ id: 10, name: 'Apparel', leaf: false, children: [] }],
        currentCategory: {
          id: 201712702,
          name: 'Solar Energy Systems',
          leaf: true,
          children: []
        },
        disabled: true
      }
    });

    expect(wrapper.get('select').element.value).toBe('201712702');
    expect(wrapper.text()).toContain('Solar Energy Systems（201712702）');
  });
});
