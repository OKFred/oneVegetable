import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const MAX_JAVASCRIPT_CHUNK_BYTES = 500_000;
const root = resolve(import.meta.dirname, '..');
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
