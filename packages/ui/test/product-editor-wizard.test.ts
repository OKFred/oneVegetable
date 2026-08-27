// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import officialHintFixture from '../../../mock/data/product-schema/official-hints.json';

import {
  analyzeProductDescriptionQuality,
  collectProductSchemaOfficialHints,
  parseProductSchemaXml,
  validateProductSchemaModel,
  type ProductDescriptionQualityIssue,
  type ProductSchemaModel,
  type ProductSchemaOfficialHint
} from '@one-vegetable/core';

import ProductEditorWizard from '../src/components/ProductEditorWizard.vue';

const XML = `<itemSchema>
  <field id="productTitle" name="Product title" type="input"><rules><rule name="requiredRule" value="true"/></rules><value/></field>
  <field id="material" name="Material" type="input"><rules><rule name="tipRule" value="Prefer an exact material"/></rules><value>ABS</value></field>
  <field id="unknownRequired" name="Unknown required" type="input"><rules><rule name="requiredRule" value="true"/></rules><value>x</value></field>
  <field id="unknownOptional" name="Unknown optional" type="input"><value/></field>
</itemSchema>`;

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

function mountWizard(
  step: 'basics' | 'attributes' | 'review' = 'basics',
  options: {
    model?: ProductSchemaModel;
    officialHints?: ProductSchemaOfficialHint[];
    qualityIssues?: ProductDescriptionQualityIssue[];
    mode?: 'quick' | 'guided' | 'advanced';
  } = {}
) {
  const model = options.model ?? parseProductSchemaXml(XML);
  return mount(ProductEditorWizard, {
    props: {
      model,
      issues: validateProductSchemaModel(model),
      qualityIssues: options.qualityIssues ?? [
        {
          code: 'schema-requiredRule',
          source: 'alibaba-schema',
          level: 'error',
          message: 'Product title is required',
          remediation: 'Complete the title.',
          fieldIds: ['productTitle']
        }
      ],
      officialHints: options.officialHints ?? [],
      productDescriptionType: undefined,
      mode: options.mode ?? 'guided',
      step,
      mutationDisabled: true,
      submitPending: false,
      editing: false,
      scoreAvailable: false,
      scorePending: false,
      scoreError: undefined,
      schemaPreview: XML,
      schemaInspection: {
        xml: XML,
        noOp: true,
        changedFieldKeys: [],
        structuralDiffs: [],
        safe: true
      }
    }
  });
}

async function settleLazyComponents(): Promise<void> {
  await vi.dynamicImportSettled();
  await flushPromises();
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
    await settleLazyComponents();
    expect(advanced.text()).toContain('Schema XML 预览（只读）');
    expect(advanced.text()).toContain('Product title');
    expect(advanced.find('pre').exists()).toBe(false);

    const xmlPreview = advanced.get('details');
    (xmlPreview.element as HTMLDetailsElement).open = true;
    await xmlPreview.trigger('toggle');
    await settleLazyComponents();
    expect(advanced.get('pre').text()).toContain('<itemSchema>');

    const review = mountWizard('review');
    const issueButton = review
      .findAll('button')
      .find((button) => button.text().includes('Product title is required'));
    if (!issueButton) throw new Error('Missing review issue button');
    await issueButton.trigger('click');
    expect(review.emitted('update:mode')?.at(-1)).toEqual(['guided']);
    expect(review.emitted('update:step')?.at(-1)).toEqual(['basics']);
  });

  it('shows XML source safety state and blocks structurally unsafe submissions', async () => {
    const wrapper = mountWizard();
    await wrapper.setProps({ mode: 'advanced' });
    await settleLazyComponents();
    expect(wrapper.text()).toContain('原样');
    const xmlPreview = wrapper.get('details');
    (xmlPreview.element as HTMLDetailsElement).open = true;
    await xmlPreview.trigger('toggle');
    await settleLazyComponents();

    await wrapper.setProps({
      issues: [],
      mutationDisabled: false,
      schemaInspection: {
        xml: XML,
        noOp: false,
        changedFieldKeys: ['field:0'],
        structuralDiffs: [],
        safe: true
      }
    });
    expect(wrapper.text()).toContain('安全补丁');
    expect(wrapper.text()).toContain('实际变化字段：Product title');
    const submit = wrapper.findAll('button').find((button) => button.text().includes('发布商品'));
    if (!submit) throw new Error('Missing publish button');
    expect(submit.attributes('disabled')).toBeUndefined();

    await wrapper.setProps({
      schemaInspection: {
        xml: XML,
        noOp: false,
        changedFieldKeys: ['field:0'],
        structuralDiffs: ['field:0 无法绑定到源字段'],
        safe: false
      }
    });
    expect(wrapper.text()).toContain('结构异常');
    expect(submit.attributes('disabled')).toBeDefined();
  });

  it('groups official hints, expands safe content and locates the related field', async () => {
    const model = parseProductSchemaXml(officialHintFixture.schemaXml);
    const officialHints = collectProductSchemaOfficialHints(model.fields);
    const qualityIssues = analyzeProductDescriptionQuality({
      html: '<h2>Product details</h2><p>' + `${'product '.repeat(160)}</p>`,
      officialHints
    });
    const wrapper = mountWizard('review', { model, officialHints, qualityIssues });

    expect(wrapper.text()).toContain('已按字段合并重复内容');
    expect(wrapper.text()).toContain('商品关键词');
    expect(wrapper.text()).toContain('2 条');
    expect(wrapper.text()).not.toContain('<div>');

    const expand = wrapper
      .findAll('button')
      .find((button) => button.attributes('aria-label')?.includes('展开官方提示：请准确填写'));
    if (!expand) throw new Error('Missing official hint expand button');
    await expand.trigger('click');
    expect(wrapper.get('a').attributes('href')).toBe('https://service.alibaba.com/page/knowledge?pageId=127');

    const locate = wrapper
      .findAll('button')
      .find((button) => button.attributes('aria-label') === '定位字段：商品关键词');
    if (!locate) throw new Error('Missing official hint locate button');
    await locate.trigger('click');
    expect(wrapper.emitted('update:step')?.at(-1)).toEqual(['basics']);
  });

  it('offers a fast draft-first page while keeping full and advanced modes available', async () => {
    const wrapper = mountWizard('basics', { mode: 'quick' });
    await wrapper.setProps({ mutationDisabled: false, publishDisabled: false, draftDisabled: false });
    await settleLazyComponents();

    expect(wrapper.text()).toContain('最快发品路径');
    expect(wrapper.text()).toContain('Product title');
    expect(wrapper.text()).toContain('Unknown required');
    expect(wrapper.text()).not.toContain('Unknown optional');
    const draft = wrapper.findAll('button').find((button) => button.text().includes('保存平台草稿'));
    const publish = wrapper.findAll('button').find((button) => button.text().includes('直接发布'));
    if (!draft || !publish) throw new Error('Missing quick publish actions');
    expect(draft.attributes('disabled')).toBeUndefined();
    expect(publish.attributes('disabled')).toBeDefined();

    await draft.trigger('click');
    expect(wrapper.emitted('submit')?.at(-1)).toEqual([true]);
    await wrapper.setProps({ platformDraftId: '1600000000001' });
    expect(wrapper.text()).toContain('平台草稿 1600000000001 已创建');
    expect(draft.attributes('disabled')).toBeDefined();
    const officialEditor = wrapper.get('a');
    expect(officialEditor.text()).toContain('在国际站继续编辑');
    expect(officialEditor.attributes('href')).toBe(
      'https://post.alibaba.com/product/publish.htm?itemId=1600000000001&pubAction=draft'
    );
    expect(officialEditor.attributes('rel')).toBe('noopener noreferrer');

    const full = wrapper.findAll('button').find((button) => button.text().includes('六步向导'));
    if (!full) throw new Error('Missing full editor action');
    await full.trigger('click');
    expect(wrapper.emitted('update:mode')?.at(-1)).toEqual(['guided']);
  });
});
