// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/template-composition.json' with { type: 'json' };
import type { ProductDescriptionTemplate, ProductDescriptionTemplateCategory } from '@one-vegetable/core';
import { parseProductSchemaXml } from '@one-vegetable/core';
import { descriptionTemplateValuesFromSchema } from '@one-vegetable/core/template-composition';
import DescriptionTemplateComposer from '../src/components/DescriptionTemplateComposer.vue';
import DescriptionTemplateVariablePicker from '../src/components/DescriptionTemplateVariablePicker.vue';
import { uiI18n } from '../src/i18n';

const templates: ProductDescriptionTemplate[] = fixture.templates.map((template) => ({
  ...template,
  category: template.category as ProductDescriptionTemplateCategory,
  language: 'en_US',
  status: 'active',
  remark: null,
  revision: 1,
  creatorId: 'test',
  updaterId: 'test',
  createTimeUtc: 1,
  updateTimeUtc: 1
}));
const firstTemplate = templates[0];
if (!firstTemplate) throw new Error('Missing template fixture');
beforeEach(() => {
  uiI18n.global.locale.value = 'en-US';
});
afterEach(() => {
  uiI18n.global.locale.value = 'zh-CN';
  document.body.replaceChildren();
});

function composer(mode: 'insert' | 'append' | 'replace' = 'append', parts = templates) {
  return mount(DescriptionTemplateComposer, {
    props: {
      templates: parts,
      initialValues: descriptionTemplateValuesFromSchema(parseProductSchemaXml(fixture.schemaXml)),
      currentHtml: '<p>Existing description</p>',
      mode
    }
  });
}
function button(wrapper: ReturnType<typeof composer>, label: string) {
  const found = wrapper
    .findAll('button')
    .find((item) => item.text() === label || item.attributes('aria-label') === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function fillMissing(wrapper: ReturnType<typeof composer>) {
  for (const variable of ['companyName', 'leadTime', 'packaging'] as const) {
    await wrapper.get(`input[id$="-${variable}"]`).setValue(fixture.values[variable]);
  }
}
describe('description template composer', () => {
  it('prefills only verified product values, requires missing details, and applies only after confirmation', async () => {
    const original = JSON.stringify(templates);
    const wrapper = composer();
    expect(wrapper.get<HTMLInputElement>('input[id$="-productName"]').element.value).toBe(
      fixture.values.productName
    );
    expect(wrapper.get<HTMLInputElement>('input[id$="-model"]').element.value).toBe(fixture.values.model);
    expect(wrapper.get<HTMLInputElement>('input[id$="-companyName"]').element.value).toBe('');
    expect(button(wrapper, 'Confirm append').attributes('disabled')).toBeDefined();
    await fillMissing(wrapper);
    expect(wrapper.get('[data-testid="template-filled-preview"]').text()).toContain('About Example Textile');
    expect(wrapper.emitted('apply')).toBeUndefined();
    await button(wrapper, 'Confirm append').trigger('click');
    const applied = wrapper.emitted<[{ mode: string; html: string }]>('apply')?.[0]?.[0];
    expect(applied?.mode).toBe('append');
    expect(applied?.html).toContain('Cotton T-shirt');
    expect(JSON.stringify(templates)).toBe(original);
    wrapper.unmount();
  });
  it('preserves selected ordering and supports keyboard-accessible move/remove controls', async () => {
    const wrapper = composer();
    await fillMissing(wrapper);
    await button(wrapper, 'Move Shipping up').trigger('click');
    expect(wrapper.findAll('li')[0]?.text()).toContain('Shipping');
    const preview = wrapper.get('[data-testid="template-filled-preview"]').text();
    expect(preview.indexOf('Shipping')).toBeLessThan(preview.indexOf('About'));
    await button(wrapper, 'Remove Packaging').trigger('click');
    expect(wrapper.find('input[id$="-packaging"]').exists()).toBe(false);
    await button(wrapper, 'Back').trigger('click');
    expect(wrapper.emitted('back')).toHaveLength(1);
    expect(wrapper.emitted('apply')).toBeUndefined();
    wrapper.unmount();
  });
  it.each([
    ['insert', 'Confirm insertion'],
    ['append', 'Confirm append'],
    ['replace', 'Confirm full replacement']
  ] as const)('confirms %s and shows replacement side-by-side only when replacing', async (mode, label) => {
    const wrapper = composer(mode);
    await fillMissing(wrapper);
    expect(wrapper.text().includes('Current description')).toBe(mode === 'replace');
    await button(wrapper, label).trigger('click');
    const applied = wrapper.emitted<[{ mode: string; html: string }]>('apply')?.[0]?.[0];
    expect(applied?.mode).toBe(mode);
    expect(applied?.html).toContain(fixture.values.companyName);
    wrapper.unmount();
  });
  it('switches modes and UI locale without resetting filled values', async () => {
    const wrapper = composer();
    await fillMissing(wrapper);
    await wrapper.get('select').setValue('replace');
    expect(wrapper.emitted('update:mode')).toEqual([['replace']]);
    await wrapper.setProps({ mode: 'replace' });
    uiI18n.global.locale.value = 'zh-CN';
    await nextTick();
    expect(wrapper.get<HTMLInputElement>('input[id$="-companyName"]').element.value).toBe(
      fixture.values.companyName
    );
    expect(wrapper.text()).toContain('当前详情');
    expect(wrapper.text()).toContain('已从商品带入');
    wrapper.unmount();
  });
  it('renders arbitrary user input as text and prevents unsupported expressions/attribute variables', async () => {
    const wrapper = composer('append', [firstTemplate]);
    await wrapper.get('input[id$="-companyName"]').setValue(fixture.unsafeValue);
    const preview = wrapper.get('[data-testid="template-filled-preview"]');
    expect(preview.find('img').exists()).toBe(false);
    expect(preview.text()).toContain(fixture.unsafeValue);
    wrapper.unmount();
    const invalid = composer('insert', [
      { ...firstTemplate, html: '<a href="https://example.com/{{model}}">{{notSupported}}</a>' }
    ]);
    expect(invalid.text()).toContain('Unsupported placeholders');
    expect(invalid.text()).toContain('not link or image attributes');
    expect(button(invalid, 'Confirm insertion').attributes('disabled')).toBeDefined();
    invalid.unmount();
  });
  it('keeps old plain templates usable with an explicit preview confirmation', async () => {
    const wrapper = composer('insert', [{ ...firstTemplate, html: '<p>Reusable content</p>' }]);
    expect(wrapper.findAll('input')).toHaveLength(0);
    expect(button(wrapper, 'Confirm insertion').attributes('disabled')).toBeUndefined();
    expect(wrapper.emitted('apply')).toBeUndefined();
    await button(wrapper, 'Confirm insertion').trigger('click');
    expect(wrapper.emitted('apply')?.[0]?.[0]).toEqual({ mode: 'insert', html: '<p>Reusable content</p>' });
    wrapper.unmount();
  });
  it('offers six fixed authoring placeholders without executing template expressions', async () => {
    const wrapper = mount(DescriptionTemplateVariablePicker);
    expect(wrapper.findAll('button')).toHaveLength(6);
    expect(wrapper.text()).toContain('{{productName}}');
    await wrapper.get('button[aria-label="Insert Product name placeholder"]').trigger('click');
    expect(wrapper.emitted('insert')).toEqual([['productName']]);
    wrapper.unmount();
  });
});
