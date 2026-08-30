import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { releaseVersionIssues, type WorkspacePackageVersion } from './lib/release-version';

const root = resolve(import.meta.dirname, '..');
const packageFiles = [
  'package.json',
  'apps/api/package.json',
  'apps/extension/package.json',
  'apps/web/package.json',
  'packages/core/package.json',
  'packages/ui/package.json'
] as const;
const tagName = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? '';
const packages = await Promise.all(packageFiles.map((fileName) => readPackageVersion(fileName)));
const issues = releaseVersionIssues(tagName, packages);

if (issues.length > 0) {
  throw new Error(`Release version validation failed:\n- ${issues.join('\n- ')}`);
}

console.log(`Release ${tagName} matches all ${packages.length} workspace package versions.`);

async function readPackageVersion(fileName: string): Promise<WorkspacePackageVersion> {
  const value: unknown = JSON.parse(await readFile(resolve(root, fileName), 'utf8'));
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.version !== 'string') {
    throw new Error(`Invalid package manifest: ${fileName}`);
  }
  return { fileName, name: value.name, version: value.version };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
