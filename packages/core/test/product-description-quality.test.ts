// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import officialHintFixture from '../../../mock/data/product-schema/official-hints.json';

import { analyzeProductDescriptionQuality } from '../src/product-description-quality';
import {
  collectProductSchemaOfficialHints,
  createProductScoreOfficialHints,
  sanitizeOfficialProductHintHtml
} from '../src/product-official-hints';
import { parseProductSchemaXml } from '../src/product-schema';

describe('product description quality suggestions', () => {
  it('reports empty and short descriptions without producing blocking project issues', () => {
    const empty = analyzeProductDescriptionQuality({ html: '' });
    expect(empty.map((issue) => issue.code)).toContain('empty-description');
    const short = analyzeProductDescriptionQuality({ html: '<p>A compact power station.</p>' });
    expect(short.map((issue) => issue.code)).toContain('short-description');
    expect(short.every((issue) => issue.level !== 'error')).toBe(true);
  });

  it('reports long unstructured content and paragraphs', () => {
    const words = Array.from({ length: 301 }, () => 'power').join(' ');
    const issues = analyzeProductDescriptionQuality({ html: `<p>${words}</p>` });
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['long-description-without-heading', 'long-paragraph'])
    );
  });

  it('reports missing alt, load failure, duplicate, external and low-resolution images', () => {
    const source = 'https://images.example.com/detail.jpg';
    const issues = analyzeProductDescriptionQuality({
      html: `<p>Detail</p><img src="${source}"><img src="${source}" alt="Duplicate">`,
      imageMetadata: { [source]: { loaded: false, width: 640, height: 480 } }
    });
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'image-missing-alt',
        'image-load-failed',
        'duplicate-image',
        'external-image',
        'low-resolution-image'
      ])
    );
  });

  it('reports empty structures and contact or external traffic information', () => {
    const issues = analyzeProductDescriptionQuality({
      html: '<p>Contact sales@example.com or WhatsApp +1 202 555 0134.</p><ul><li></li></ul><table><tbody><tr><td></td></tr></tbody></table><a href="https://example.com">website</a>'
    });
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['empty-list', 'empty-table', 'contact-or-external-traffic'])
    );
  });

  it('distinguishes publish minimum blockers from advisory Alibaba Schema rules', () => {
    const officialHints = createProductScoreOfficialHints(['Use accurate keywords', 'Add scenario images']);
    const issues = analyzeProductDescriptionQuality({
      html: '<p>Short copy</p>',
      schemaIssues: [
        {
          fieldKey: 'field:0',
          severity: 'error',
          rule: 'publishMinimumProductTitle',
          message: 'Title is required'
        },
        {
          fieldKey: 'field:1',
          severity: 'warning',
          rule: 'requiredRule',
          message: 'Material is recommended'
        }
      ],
      officialHints
    });
    expect(issues.find((issue) => issue.source === 'alibaba-schema')?.level).toBe('error');
    expect(issues.find((issue) => issue.code === 'schema-requiredRule')).toMatchObject({
      level: 'warning',
      remediation: '建议提交前核对；本地预检不会阻止提交，最终以 Alibaba 接口返回为准。'
    });
    expect(
      issues.filter((issue) => issue.source === 'official').every((issue) => issue.level === 'warning')
    ).toBe(true);
    expect(issues.find((issue) => issue.code === officialHints[0]?.id)?.fieldIds).toEqual([]);
  });

  it('sanitizes official links and removes executable or remote content', () => {
    const result = sanitizeOfficialProductHintHtml(
      '<div onclick="run()">查看<a href="//service.alibaba.com/help">官方说明</a>' +
        '<a href="https://example.com">站外链接</a><script>alert(1)</script><img src="https://example.com/a.png"></div>'
    );
    const document = new DOMParser().parseFromString(result.html, 'text/html');

    expect(document.querySelector('script,img')).toBeNull();
    expect(document.querySelector('p')).not.toBeNull();
    const links = document.querySelectorAll('a');
    expect(links[0]?.getAttribute('href')).toBe('https://service.alibaba.com/help');
    expect(links[0]?.getAttribute('target')).toBe('_blank');
    expect(links[0]?.getAttribute('rel')).toBe('nofollow noopener noreferrer');
    expect(links[1]?.hasAttribute('href')).toBe(false);
  });

  it('groups duplicate schema hints by root field and keeps field references in source order', () => {
    const model = parseProductSchemaXml(officialHintFixture.schemaXml);
    const hints = collectProductSchemaOfficialHints(model.fields);
    const keywordFormat = hints.find((hint) => hint.summary.includes('修饰词'));

    expect(hints.map((hint) => hint.rootFieldName)).toEqual([
      '商品关键词',
      '商品关键词',
      '商品属性',
      '产品视频',
      '关联商品证书',
      '不安全提示'
    ]);
    expect(keywordFormat?.occurrenceCount).toBe(2);
    expect(keywordFormat?.fieldKeys).toHaveLength(2);
    expect(keywordFormat?.fieldIds).toEqual(['productKeywords_0', 'productKeywords_1']);

    const categoryProperty = hints.find((hint) => hint.rootFieldId === 'icbuCatProp');
    expect(categoryProperty?.occurrenceCount).toBe(2);
    expect(categoryProperty?.fieldIds).toEqual(['p-material', 'p-style']);
    expect(categoryProperty?.fieldKeys.every((key) => key.includes(':instance:'))).toBe(true);
  });

  it('renders instructional Schema XML as code instead of interpreting it as HTML', () => {
    const model = parseProductSchemaXml(officialHintFixture.schemaXml);
    const hint = collectProductSchemaOfficialHints(model.fields).find(
      (candidate) => candidate.rootFieldId === 'productCertificate'
    );
    if (!hint) throw new Error('Missing product certificate hint');

    expect(hint.codeSamples).toHaveLength(1);
    expect(hint.codeSamples[0]).toContain('<field id="productCertificate"');
    expect(hint.html).toContain('<pre><code>&lt;field');
    const document = new DOMParser().parseFromString(hint.html, 'text/html');
    expect(document.querySelector('field,values,value')).toBeNull();
    expect(document.querySelector('code')?.textContent).toContain('<value>30000739412</value>');
  });

  it('deduplicates product score messages without creating field targets', () => {
    const hints = createProductScoreOfficialHints(officialHintFixture.scoreIssues);

    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({
      source: 'product-score',
      rootFieldName: '平台评分',
      fieldKeys: [],
      occurrenceCount: 2
    });
  });
});
