import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertPackingThreeBudget, assertPackingWorkerBudget } from './lib/extension-package-budget';
import { inspectExtensionWorkerGraph } from './lib/extension-worker-graph';

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
    .map(async (file) => ({ file, size: (await stat(resolve(assetsDirectory, file))).size }))
);
const indexHtml = await readFile(resolve(distributionDirectory, 'index.html'), 'utf8');
const eagerFiles = new Set<string>();
for (const match of indexHtml.matchAll(/(?:src|href)="\/?(assets\/[^"?]+\.js)"/gu)) {
  if (!match[1]) continue;
  // Web permits dynamic imports; only reuse the static dependency file list.
  const graph = await inspectExtensionWorkerGraph(match[1], (file) =>
    readFile(resolve(distributionDirectory, file), 'utf8')
  );
  for (const file of graph.files) eagerFiles.add(file.replace(/^assets\//u, ''));
}
const packingThreeChunk = assertPackingThreeBudget(javascriptChunks, [...eagerFiles]);
assertPackingWorkerBudget(javascriptChunks);
const largest = javascriptChunks.toSorted((left, right) => right.size - left.size).slice(0, 10);
const oversized = javascriptChunks.filter(
  ({ file, size }) => file !== packingThreeChunk && size > MAX_JAVASCRIPT_CHUNK_BYTES
);

process.stdout.write(
  `${largest.map(({ file, size }) => `${file}\t${size}`).join('\n')}\n${javascriptChunks.length} web JavaScript chunks checked\n`
);
if (oversized.length > 0) {
  throw new Error(
    oversized
      .map(({ file, size }) => `${file} exceeds the 500 KB JavaScript chunk budget: ${size}`)
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
