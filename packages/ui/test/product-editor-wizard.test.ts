// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { parseProductSchemaXml, validateProductSchemaModel } from '@one-vegetable/core';

import ProductEditorWizard from '../src/components/ProductEditorWizard.vue';

const XML = `<itemSchema>
  <field id="productTitle" name="Product title" type="input"><rules><rule name="requiredRule" value="true"/></rules><value/></field>
  <field id="material" name="Material" type="input"><rules><rule name="tipRule" value="Prefer an exact material"/></rules><value>ABS</value></field>
  <field id="unknownRequired" name="Unknown required" type="input"><rules><rule name="requiredRule" value="true"/></rules><value>x</value></field>
  <field id="unknownOptional" name="Unknown optional" type="input"><value/></field>
</itemSchema>`;

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

function mountWizard(step: 'basics' | 'attributes' | 'review' = 'basics') {
  const model = parseProductSchemaXml(XML);
  return mount(ProductEditorWizard, {
    props: {
      model,
      issues: validateProductSchemaModel(model),
      qualityIssues: [
        {
          code: 'schema-requiredRule',
          source: 'alibaba-schema',
          level: 'error',
          message: 'Product title is required',
          remediation: 'Complete the title.',
          fieldIds: ['productTitle']
        }
      ],
      productDescriptionType: undefined,
      mode: 'guided',
      step,
      mutationDisabled: true,
      submitPending: false,
      editing: false,
      scoreAvailable: false,
      scorePending: false,
      scoreError: undefined,
      schemaPreview: XML
    }
  });
}

describe('ProductEditorWizard', () => {
  it('shows six freely navigable steps and hides technical field types in guided mode', async () => {
    const wrapper = mountWizard();

    expect(wrapper.get('nav[aria-label="商品编辑步骤"]').findAll('button')).toHaveLength(6);
    expect(wrapper.text()).toContain('基础信息与类目');
    expect(wrapper.text()).not.toContain('input · productTitle');

    await wrapper.get('nav').findAll('button')[1]?.trigger('click');
    expect(wrapper.emitted('update:step')?.at(-1)).toEqual(['attributes']);
  });

  it('shows required and recommended fields before optional fields', async () => {
    const wrapper = mountWizard('attributes');

    expect(wrapper.text()).toContain('Material');
    expect(wrapper.text()).toContain('Unknown required');
    expect(wrapper.text()).not.toContain('Unknown optional');

    const moreButton = wrapper.findAll('button').find((button) => button.text().includes('更多选填信息'));
    if (!moreButton) throw new Error('Missing optional fields button');
    await moreButton.trigger('click');
    expect(wrapper.text()).toContain('Unknown optional');
  });

  it('keeps the advanced editor available and routes review issues back to their field step', async () => {
    const advanced = mountWizard();
    const advancedButton = advanced.findAll('button').find((button) => button.text() === '高级模式');
    if (!advancedButton) throw new Error('Missing advanced mode button');
    await advancedButton.trigger('click');
    expect(advanced.emitted('update:mode')?.at(-1)).toEqual(['advanced']);

    await advanced.setProps({ mode: 'advanced' });
    expect(advanced.text()).toContain('Schema XML 预览（只读）');
    expect(advanced.text()).toContain('Product title');

    const review = mountWizard('review');
    const issueButton = review
      .findAll('button')
      .find((button) => button.text().includes('Product title is required'));
    if (!issueButton) throw new Error('Missing review issue button');
    await issueButton.trigger('click');
    expect(review.emitted('update:mode')?.at(-1)).toEqual(['guided']);
    expect(review.emitted('update:step')?.at(-1)).toEqual(['basics']);
  });
});
