// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { analyzeProductDescriptionQuality } from '../src/product-description-quality';

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

  it('keeps Alibaba Schema errors blocking and official messages advisory', () => {
    const issues = analyzeProductDescriptionQuality({
      html: '<p>Short copy</p>',
      schemaIssues: [
        { fieldKey: 'field:0', severity: 'error', rule: 'requiredRule', message: 'Title is required' }
      ],
      officialTips: ['Use accurate keywords'],
      officialScoreIssues: ['Add scenario images']
    });
    expect(issues.find((issue) => issue.source === 'alibaba-schema')?.level).toBe('error');
    expect(
      issues.filter((issue) => issue.source === 'official').every((issue) => issue.level === 'warning')
    ).toBe(true);
  });
});
