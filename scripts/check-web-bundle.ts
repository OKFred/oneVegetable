import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const MAX_JAVASCRIPT_CHUNK_BYTES = 500_000;
const LOCAL_ENDPOINT_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/giu;
const checkCloudflareBundle = process.argv.includes('--cloudflare');
const root = resolve(import.meta.dirname, '..');
const distributionDirectory = resolve(root, 'apps/web/dist');
const assetsDirectory = resolve(root, 'apps/web/dist/assets');
const assetNames = await readdir(assetsDirectory);
const javascriptChunks = await Promise.all(
  assetNames
    .filter((name) => name.endsWith('.js'))
    .map(async (name) => ({ name, size: (await stat(resolve(assetsDirectory, name))).size }))
);
const largest = javascriptChunks.toSorted((left, right) => right.size - left.size).slice(0, 10);
const oversized = javascriptChunks.filter(({ size }) => size > MAX_JAVASCRIPT_CHUNK_BYTES);

process.stdout.write(
  `${largest.map(({ name, size }) => `${name}\t${size}`).join('\n')}\n${javascriptChunks.length} web JavaScript chunks checked\n`
);
if (oversized.length > 0) {
  throw new Error(
    oversized
      .map(({ name, size }) => `${name} exceeds the 500 KB JavaScript chunk budget: ${size}`)
      .join('\n')
  );
}

if (checkCloudflareBundle) {
  const bundleFiles = [
    resolve(distributionDirectory, 'index.html'),
    ...assetNames
      .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
      .map((name) => resolve(assetsDirectory, name))
  ];
  const contaminatedFiles: string[] = [];
  for (const file of bundleFiles) {
    const content = await readFile(file, 'utf8');
    if (LOCAL_ENDPOINT_PATTERN.test(content)) contaminatedFiles.push(file);
    LOCAL_ENDPOINT_PATTERN.lastIndex = 0;
  }
  if (contaminatedFiles.length > 0) {
    throw new Error(`Cloudflare Web 产物包含本机 API 地址：\n${contaminatedFiles.join('\n')}`);
  }
  process.stdout.write('Cloudflare Web bundle contains no localhost API endpoints\n');
}
