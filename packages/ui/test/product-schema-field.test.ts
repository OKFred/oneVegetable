// @vitest-environment jsdom

import { defineComponent, h, ref, type Ref } from 'vue';
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { parseProductSchemaXml, type ProductSchemaField } from '@one-vegetable/core';

import ProductSchemaFieldComponent from '../src/components/ProductSchemaField.vue';

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

describe('ProductSchemaField', () => {
  it('edits multiInput values as stable addable and removable rows', async () => {
    const field = parseField(`<field id="keywords" name="关键词" type="multiInput">
      <rules><rule name="minInputNumRule" value="1"/><rule name="maxInputNumRule" value="3"/></rules>
      <values><value inputValue="first">one</value><value inputValue="second">two</value></values>
    </field>`);
    const { wrapper, current } = mountField(field);

    await wrapper.get('input[aria-label="关键词 第 2 项"]').setValue('updated two');
    expect(current.value.values[1]).toMatchObject({
      text: 'updated two',
      attributes: { inputValue: 'second' }
    });

    await wrapper.get('button[aria-label="删除 关键词 第 1 项"]').trigger('click');
    expect(current.value.values).toHaveLength(1);
    expect(current.value.values[0]).toMatchObject({
      text: 'updated two',
      attributes: { inputValue: 'second' }
    });

    await buttonWithText(wrapper, '新增 关键词').trigger('click');
    expect(current.value.values).toHaveLength(2);
    await wrapper.get('input[aria-label="关键词 第 2 项"]').setValue('three');
    expect(current.value.values.map((value) => value.text)).toEqual(['updated two', 'three']);
  });

  it('keeps multiCheck editable when Alibaba omits options', async () => {
    const field = parseField(`<field id="features" name="功能/特性" type="multiCheck">
      <rules><rule name="maxInputNumRule" value="3"/></rules>
      <values><value>feature-a</value><value>feature-b</value></values>
    </field>`);
    const { wrapper, current } = mountField(field);

    expect(wrapper.text()).toContain('Alibaba Schema 未返回候选项');
    await wrapper.get('input[aria-label="功能/特性 已选值 1"]').setValue('feature-a-updated');
    await wrapper.get('button[aria-label="删除 功能/特性 已选值 2"]').trigger('click');
    await wrapper.get('input[aria-label="新增 功能/特性 原始值"]').setValue('feature-c');
    await buttonWithText(wrapper, '新增').trigger('click');

    expect(current.value.values.map((value) => value.text)).toEqual(['feature-a-updated', 'feature-c']);
  });

  it('adds and removes repeatable complex product keywords within Schema limits', async () => {
    const field = parseField(`<field id="productKeywords" name="商品关键词" type="complex">
      <rules>
        <rule name="minInputNumRule" value="1"/>
        <rule name="maxInputNumRule" value="3"/>
      </rules>
      <complex-values><field id="productKeywords_0" type="input"><value>one</value></field></complex-values>
      <complex-values><field id="productKeywords_0" type="input"><value>two</value></field></complex-values>
      <fields><field id="productKeywords_0" type="input"><value/></field></fields>
    </field>`);
    const { wrapper, current } = mountField(field, false);

    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.get('input[aria-label="关键词 1"]').element).toBeInstanceOf(HTMLInputElement);
    await buttonWithText(wrapper, '新增 关键词').trigger('click');
    expect(current.value.instances).toHaveLength(3);
    await wrapper.get('input[aria-label="关键词 3"]').setValue('three');
    expect(buttonWithText(wrapper, '新增 关键词').attributes('disabled')).toBeDefined();

    const deleteButtons = wrapper.findAll('button').filter((button) => button.text().includes('删除'));
    await deleteButtons[1]?.trigger('click');
    expect(current.value.instances.map((instance) => instance.fields[0]?.values[0]?.text)).toEqual([
      'one',
      'three'
    ]);
  });

  it('uses the structured official hint renderer beside a field', async () => {
    const field = parseField(`<field id="productTitle" name="商品名称" type="input">
      <rules><rule name="tipRule" value="&lt;div&gt;避免堆砌关键词，查看&lt;a href=&quot;//service.alibaba.com/help&quot;&gt;标题规范&lt;/a&gt;&lt;/div&gt;"/></rules>
      <value>Portable product</value>
    </field>`);
    const { wrapper } = mountField(field);

    expect(wrapper.text()).toContain('避免堆砌关键词');
    expect(wrapper.find('a').exists()).toBe(false);
    await wrapper.get('button[aria-label^="展开官方提示"]').trigger('click');
    expect(wrapper.get('a').attributes('href')).toBe('https://service.alibaba.com/help');
  });

  it('maps template-only official rules onto visible complex instance fields', () => {
    const field = parseField(`<field id="attributes" name="商品属性" type="complex">
      <complex-value><field id="material" name="材质" type="input"><value>cotton</value></field></complex-value>
      <fields><field id="material" name="材质" type="input"><rules><rule name="tipRule" value="请填写准确材质"/></rules></field></fields>
    </field>`);
    const { wrapper } = mountField(field);

    expect(wrapper.text()).toContain('请填写准确材质');
    expect(wrapper.find('[data-field-key="field:0:instance:0:field:0"]').exists()).toBe(true);
  });
});

function parseField(xml: string): ProductSchemaField {
  const field = parseProductSchemaXml(`<itemSchema>${xml}</itemSchema>`).fields[0];
  if (!field) throw new Error('Test Schema field is missing');
  return field;
}

function mountField(
  field: ProductSchemaField,
  showTechnical = true
): { wrapper: VueWrapper; current: Ref<ProductSchemaField> } {
  const current = ref(field) as Ref<ProductSchemaField>;
  const Host = defineComponent({
    setup() {
      return () =>
        h(ProductSchemaFieldComponent, {
          field: current.value,
          issues: [],
          productDescriptionType: '2',
          showTechnical,
          onUpdate: (next: ProductSchemaField) => {
            current.value = next;
          }
        });
    }
  });
  return { wrapper: mount(Host), current };
}

function buttonWithText(wrapper: VueWrapper, text: string): DOMWrapper<Element> {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(text));
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}
