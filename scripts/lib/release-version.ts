export interface WorkspacePackageVersion {
  fileName: string;
  name: string;
  version: string;
}

const stableSemanticVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function releaseTagFromArguments(arguments_: readonly string[], fallbackTagName = ''): string {
  return arguments_.find((argument) => argument !== '--') ?? fallbackTagName;
}

export function releaseVersionIssues(
  tagName: string,
  packages: readonly WorkspacePackageVersion[]
): string[] {
  const issues: string[] = [];
  const tagMatch = /^v(.+)$/.exec(tagName);
  const rootPackage = packages.find(({ fileName }) => fileName === 'package.json');

  if (!tagMatch || !stableSemanticVersion.test(tagMatch[1] ?? '')) {
    issues.push(`正式版本 Tag 必须使用稳定 SemVer，例如 v2.0.2；当前为 ${tagName || '(empty)'}`);
  }

  if (!rootPackage) {
    issues.push('缺少根 package.json 的版本信息');
    return issues;
  }

  if (!stableSemanticVersion.test(rootPackage.version)) {
    issues.push(`根 package.json 必须使用稳定 SemVer；当前为 ${rootPackage.version}`);
  }

  const mismatches = packages.filter(({ version }) => version !== rootPackage.version);
  if (mismatches.length > 0) {
    issues.push(
      `workspace 版本必须全部为 ${rootPackage.version}：${mismatches
        .map(({ name, version }) => `${name}=${version}`)
        .join(', ')}`
    );
  }

  const expectedTag = `v${rootPackage.version}`;
  if (tagName !== expectedTag) {
    issues.push(`Tag 必须与 workspace 版本一致：期望 ${expectedTag}，当前为 ${tagName || '(empty)'}`);
  }

  return issues;
}
