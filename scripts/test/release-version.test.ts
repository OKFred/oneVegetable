import { describe, expect, it } from 'vitest';

import { releaseVersionIssues, type WorkspacePackageVersion } from '../lib/release-version';

function packages(version = '2.0.2'): WorkspacePackageVersion[] {
  return [
    { fileName: 'package.json', name: 'one-vegetable', version },
    { fileName: 'apps/api/package.json', name: '@one-vegetable/api', version },
    { fileName: 'apps/extension/package.json', name: '@one-vegetable/extension', version }
  ];
}

describe('formal release version validation', () => {
  it('accepts an exact stable semantic version tag', () => {
    expect(releaseVersionIssues('v2.0.2', packages())).toEqual([]);
  });

  it('rejects prerelease and loose tag names', () => {
    expect(releaseVersionIssues('v2.0.2-rc.1', packages()).join('\n')).toMatch(/稳定 SemVer|一致/);
    expect(releaseVersionIssues('release-2.0.2', packages()).join('\n')).toMatch(/稳定 SemVer|一致/);
  });

  it('rejects a tag that differs from the root package version', () => {
    expect(releaseVersionIssues('v2.0.3', packages())).toContain(
      'Tag 必须与 workspace 版本一致：期望 v2.0.2，当前为 v2.0.3'
    );
  });

  it('reports every workspace version mismatch', () => {
    const values = packages();
    const extensionPackage = values[2];
    if (!extensionPackage) throw new Error('missing extension package test fixture');
    values[2] = { ...extensionPackage, version: '2.0.1' };
    expect(releaseVersionIssues('v2.0.2', values).join('\n')).toContain('@one-vegetable/extension=2.0.1');
  });

  it('requires the root package version source', () => {
    expect(releaseVersionIssues('v2.0.2', packages().slice(1))).toContain('缺少根 package.json 的版本信息');
  });
});
