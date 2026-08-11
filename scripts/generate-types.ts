import { readFile, writeFile } from 'node:fs/promises';

import openapiTS, { astToString } from 'openapi-typescript';

const contract = new URL('../openapi/one-vegetable.json', import.meta.url);
const target = new URL('../packages/core/src/generated/api.ts', import.meta.url);
const output = astToString(await openapiTS(contract));

if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8');
  if (current !== output) {
    throw new Error('Generated OpenAPI types are stale. Run pnpm generate:types.');
  }
} else {
  await writeFile(target, output, 'utf8');
}
