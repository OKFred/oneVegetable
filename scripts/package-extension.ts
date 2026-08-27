import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { unzipSync, zipSync, type Zippable } from 'fflate';

interface PackageManifest {
  version: string;
}

const root = resolve(import.meta.dirname, '..');
const extensionOutput = resolve(root, 'apps/extension/.output/chrome-mv3');
const artifactsDirectory = resolve(root, 'artifacts');
const manifest = JSON.parse(
  await readFile(resolve(extensionOutput, 'manifest.json'), 'utf8')
) as PackageManifest;
const rootPackage = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as PackageManifest;
const extensionPackage = JSON.parse(
  await readFile(resolve(root, 'apps/extension/package.json'), 'utf8')
) as PackageManifest;
if (manifest.version !== rootPackage.version || manifest.version !== extensionPackage.version) {
  throw new Error(
    `Version mismatch: manifest=${manifest.version}, root=${rootPackage.version}, extension=${extensionPackage.version}`
  );
}

const files = (await collectFiles(extensionOutput)).toSorted((left, right) => left.localeCompare(right));
const fixedMtime = new Date(1980, 0, 1, 0, 0, 0);
const zippable: Zippable = {};
for (const file of files) {
  const relativePath = file.slice(extensionOutput.length + 1).replaceAll('\\', '/');
  zippable[relativePath] = [await readFile(file), { level: 9, mtime: fixedMtime, os: 3, attrs: 0o644 << 16 }];
}

const archive = zipSync(zippable, { level: 9, mtime: fixedMtime });
const verificationArchive = zipSync(zippable, { level: 9, mtime: fixedMtime });
if (!Buffer.from(archive).equals(Buffer.from(verificationArchive))) {
  throw new Error('Extension ZIP is not reproducible within the same build.');
}
const archivedFiles = Object.keys(unzipSync(archive)).toSorted((left, right) => left.localeCompare(right));
const expectedFiles = Object.keys(zippable).toSorted((left, right) => left.localeCompare(right));
if (JSON.stringify(archivedFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error('Extension ZIP content verification failed.');
}

await mkdir(artifactsDirectory, { recursive: true });
const artifactName = `one-vegetable-v${manifest.version}-chrome-mv3.zip`;
const artifactPath = resolve(artifactsDirectory, artifactName);
const sha256 = createHash('sha256').update(archive).digest('hex');
await writeFile(artifactPath, archive);
await writeFile(`${artifactPath}.sha256`, `${sha256}  ${artifactName}\n`, 'utf8');
await writeFile(
  resolve(artifactsDirectory, 'release.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      extensionVersion: manifest.version,
      artifact: artifactName,
      sha256,
      size: archive.byteLength,
      fileCount: expectedFiles.length,
      storeListingDirectory: 'store-listing'
    },
    null,
    2
  )}\n`,
  'utf8'
);
const storeArtifactDirectory = resolve(artifactsDirectory, 'store-listing');
await rm(storeArtifactDirectory, { recursive: true, force: true });
await mkdir(storeArtifactDirectory, { recursive: true });
await Promise.all([
  copyFile(resolve(root, 'docs/privacy-policy.md'), resolve(storeArtifactDirectory, 'privacy-policy.md')),
  copyFile(
    resolve(root, 'docs/privacy-policy.en.md'),
    resolve(storeArtifactDirectory, 'privacy-policy.en.md')
  ),
  copyFile(resolve(root, 'store-listing/listing.json'), resolve(storeArtifactDirectory, 'listing.json')),
  copyFile(resolve(root, 'store-listing/zh_CN.md'), resolve(storeArtifactDirectory, 'zh_CN.md')),
  copyFile(resolve(root, 'store-listing/en.md'), resolve(storeArtifactDirectory, 'en.md')),
  cp(resolve(root, 'store-listing/assets'), resolve(storeArtifactDirectory, 'assets'), {
    recursive: true
  })
]);
process.stdout.write(
  `${basename(artifactPath)}\nsha256 ${sha256}\n${archive.byteLength} bytes, ${expectedFiles.length} files\nstore listing bundle copied\n`
);

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await collectFiles(path)));
    else if ((await stat(path)).isFile()) result.push(path);
  }
  return result;
}
