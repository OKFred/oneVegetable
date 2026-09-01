import { describe, expect, it } from 'vitest';

import { findReleaseNote, parseReleaseNotesDocument, renderReleaseNotesMarkdown } from '../lib/release-notes';

describe('release notes', () => {
  it('parses stable versions in descending order', () => {
    const document = parseReleaseNotesDocument(fixture());
    expect(document.releases.map((release) => release.version)).toEqual(['2.1.0', '2.0.3']);
    expect(findReleaseNote(document, 'v2.1.0').title).toBe('Major workflow');
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
        'A concise summary.',
        '',
        '## 新增',
        '- **New workflow**：Users can finish the workflow.',
        '',
        '## 修复',
        '- **Stable dialog**：Dialogs preserve state.',
        '',
        '[查看完整代码差异](https://github.com/OKFred/oneVegetable/compare/v2.0.3...v2.1.0)',
        ''
      ].join('\n')
    );
  });
});

function fixture() {
  return {
    schemaVersion: 1,
    repositoryUrl: 'https://github.com/OKFred/oneVegetable',
    releases: [
      {
        version: '2.1.0',
        releasedAt: '2026-08-31',
        title: 'Major workflow',
        summary: 'A concise summary.',
        source: 'release',
        githubUrl: 'https://github.com/OKFred/oneVegetable/releases/tag/v2.1.0',
        compareUrl: 'https://github.com/OKFred/oneVegetable/compare/v2.0.3...v2.1.0',
        changes: [
          {
            type: 'feature',
            title: 'New workflow',
            description: 'Users can finish the workflow.'
          },
          {
            type: 'fix',
            title: 'Stable dialog',
            description: 'Dialogs preserve state.'
          }
        ]
      },
      {
        version: '2.0.3',
        releasedAt: '2026-08-30',
        title: 'Patch',
        summary: 'A patch release.',
        source: 'tag',
        githubUrl: 'https://github.com/OKFred/oneVegetable/tree/v2.0.3',
        compareUrl: null,
        changes: [{ type: 'fix', title: 'Patch fix', description: 'A verified fix.' }]
      }
    ]
  };
}
