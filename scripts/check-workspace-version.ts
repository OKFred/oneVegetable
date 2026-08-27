import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface PackageManifest {
  name: string;
  version: string;
}

const root = resolve(import.meta.dirname, '..');
const packageFiles = [
  'package.json',
  'apps/api/package.json',
  'apps/extension/package.json',
  'apps/web/package.json',
  'packages/core/package.json',
  'packages/ui/package.json'
] as const;

const manifests = await Promise.all(packageFiles.map((fileName) => readManifest(fileName)));
const rootVersion = manifests[0].version;
const mismatches = manifests.filter(({ version }) => version !== rootVersion);

if (mismatches.length > 0) {
  throw new Error(
    `Workspace package versions must match ${rootVersion}: ${mismatches
      .map(({ name, version }) => `${name}=${version}`)
      .join(', ')}`
  );
}

console.log(`${manifests.length} package manifests use version ${rootVersion}`);

async function readManifest(fileName: string): Promise<PackageManifest> {
  const value: unknown = JSON.parse(await readFile(resolve(root, fileName), 'utf8'));
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.version !== 'string') {
    throw new Error(`Invalid package manifest: ${fileName}`);
  }
  return { name: value.name, version: value.version };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
