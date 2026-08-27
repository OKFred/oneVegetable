import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { inspectOpenApiQuality } from './lib/openapi-quality';

const openApiPath = resolve(import.meta.dirname, '..', 'openapi', 'one-vegetable.json');
const document: unknown = JSON.parse(await readFile(openApiPath, 'utf8'));
const issues = inspectOpenApiQuality(document);

if (issues.length > 0) {
  throw new Error(
    `OpenAPI project rules failed:\n${issues
      .map(({ pointer, message }) => `- ${pointer}: ${message}`)
      .join('\n')}`
  );
}

console.log('OpenAPI project rules passed: probes use GET; all other operations use POST JSON bodies.');
