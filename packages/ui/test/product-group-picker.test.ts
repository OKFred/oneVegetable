// @vitest-environment jsdom

import { defineComponent, h, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { describe, expect, it, vi } from 'vitest';

import {
  parseProductSchemaXml,
  productSchemaFieldText,
  productSchemaGroupLevel,
  type ProductSchemaField
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import ProductGroupPicker from '../src/components/ProductGroupPicker.vue';
import { provideServices } from '../src/lib/services';

const XML = `<itemSchema><field id="productGroup" name="Product group" type="complex">
  <complex-value>
    <field id="first_group_id" name="First group" type="input"><value>1001</value></field>
    <field id="second_group_id" name="Second group" type="input"><value>1101</value></field>
    <field id="third_group_id" name="Third group" type="input"><value>1111</value></field>
  </complex-value>
</field></itemSchema>`;

describe('ProductGroupPicker', () => {
  it('shows group names while preserving and updating the schema IDs', async () => {
    const field = ref(parseProductSchemaXml(XML).fields[0]);
    const Host = defineComponent({
      setup() {
        provideServices({
          gateway: new MockGatewayClient(0),
          settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
          mode: 'mock'
        });
        return () =>
          field.value
            ? h(ProductGroupPicker, {
                field: field.value,
                onUpdate: (value: ProductSchemaField) => {
                  field.value = value;
                }
              })
            : null;
      }
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Energy storage / Portable power / Solar generators');
    });
    expect(wrapper.text()).not.toContain('group_id');

    await wrapper.findAll('select')[0]?.setValue('1002');
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.findAll('select')[1]?.text()).toContain('Reusable bags');
    });
    expect(groupValues(field.value)).toEqual(['1002', '', '']);

    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('商品分组');
    wrapper.unmount();
  });
});

function groupValues(field: ProductSchemaField | undefined): string[] {
  if (!field) return [];
  return (field.instances[0]?.fields ?? field.children)
    .filter((child) => productSchemaGroupLevel(child) !== null)
    .map(productSchemaFieldText);
}

function settings() {
  return {
    appKey: '',
    appSecret: '',
    accessToken: '',
    endpoint: 'https://eco.taobao.com/router/rest',
    signMethod: 'hmac' as const
  };
}
