import { describe, expect, it } from 'vitest';

import { findReleaseNote, parseReleaseNotesDocument, renderReleaseNotesMarkdown } from '../lib/release-notes';

describe('release notes', () => {
  it('parses stable versions in descending order', () => {
    const document = parseReleaseNotesDocument(fixture());
    expect(document.releases.map((release) => release.version)).toEqual(['2.1.0', '2.0.3']);
    expect(findReleaseNote(document, 'v2.1.0').title['en-US']).toBe('Major workflow');
  });

  it('rejects duplicates and an ascending release list', () => {
    const value = fixture();
    const [latest, patch] = value.releases;
    if (!latest || !patch) throw new Error('Fixture must contain two releases.');
    value.releases = [patch, latest, patch];
    expect(() => parseReleaseNotesDocument(value)).toThrow(/sorted|duplicates/);
  });

  it('renders grouped Markdown with the full comparison link', () => {
    const release = findReleaseNote(parseReleaseNotesDocument(fixture()), '2.1.0');
    expect(renderReleaseNotesMarkdown(release)).toBe(
      [
        '简要摘要。',
        '',
        '## 新增',
        '- **新流程**：用户可以完成流程。',
        '',
        '## 修复',
        '- **稳定弹窗**：弹窗保留状态。',
        '',
        '[查看完整代码差异](https://github.com/OKFred/oneVegetable/compare/v2.0.3...v2.1.0)',
        ''
      ].join('\n')
    );
  });

  it('renders the English release-note variant', () => {
    const release = findReleaseNote(parseReleaseNotesDocument(fixture()), '2.1.0');
    expect(renderReleaseNotesMarkdown(release, 'en-US')).toContain(
      '- **New workflow**: Users can finish the workflow.'
    );
  });
});

function fixture() {
  return {
    schemaVersion: 2,
    repositoryUrl: 'https://github.com/OKFred/oneVegetable',
    releases: [
      {
        version: '2.1.0',
        releasedAt: '2026-08-31',
        title: localized('主要流程', 'Major workflow'),
        summary: localized('简要摘要。', 'A concise summary.'),
        source: 'release',
        githubUrl: 'https://github.com/OKFred/oneVegetable/releases/tag/v2.1.0',
        compareUrl: 'https://github.com/OKFred/oneVegetable/compare/v2.0.3...v2.1.0',
        changes: [
          {
            type: 'feature',
            title: localized('新流程', 'New workflow'),
            description: localized('用户可以完成流程。', 'Users can finish the workflow.')
          },
          {
            type: 'fix',
            title: localized('稳定弹窗', 'Stable dialog'),
            description: localized('弹窗保留状态。', 'Dialogs preserve state.')
          }
        ]
      },
      {
        version: '2.0.3',
        releasedAt: '2026-08-30',
        title: localized('补丁', 'Patch'),
        summary: localized('补丁版本。', 'A patch release.'),
        source: 'tag',
        githubUrl: 'https://github.com/OKFred/oneVegetable/tree/v2.0.3',
        compareUrl: null,
        changes: [
          {
            type: 'fix',
            title: localized('补丁修复', 'Patch fix'),
            description: localized('已验证修复。', 'A verified fix.')
          }
        ]
      }
    ]
  };
}

function localized(zhCN: string, enUS: string) {
  return { 'zh-CN': zhCN, 'en-US': enUS };
}
