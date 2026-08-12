import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import addErrors from 'ajv-errors';
import addFormats from 'ajv-formats';

interface OpenApiDocument {
  'x-product-capabilities'?: Record<string, { requestSchema: string; responseSchema: string }>;
  'x-rfq-capabilities'?: Record<string, { requestSchema: string; responseSchema: string }>;
  'x-trade-capabilities'?: Record<string, { requestSchema: string; responseSchema: string }>;
  components?: {
    schemas?: Record<string, object>;
  };
}

const root = resolve(import.meta.dirname, '..');
const rawDocument = await readFile(resolve(root, 'openapi/one-vegetable.json'), 'utf8');
const parsedDocument: unknown = JSON.parse(rawDocument);
const document = parsedDocument as OpenApiDocument;
const schemas = document.components?.schemas;
if (!schemas) throw new Error('OpenAPI components.schemas is missing');

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  code: { esm: true, source: true },
  strict: true
});
addFormats(ajv);
addErrors(ajv);

const selected: Record<string, object | undefined> = {
  validateProductSchemaRequest: schemas.ProductSchemaRequest,
  validateSchemaPublishRequest: schemas.SchemaPublishRequest,
  validateCapabilityCallRequest: schemas.CapabilityCallRequest
};

for (const [index, definition] of Object.values(document['x-product-capabilities'] ?? {}).entries()) {
  selected[`validateProductCapability${index}Request`] = schemas[definition.requestSchema];
  selected[`validateProductCapability${index}Response`] = schemas[definition.responseSchema];
}

for (const [index, definition] of Object.values(document['x-rfq-capabilities'] ?? {}).entries()) {
  selected[`validateRfqCapability${index}Request`] = schemas[definition.requestSchema];
  selected[`validateRfqCapability${index}Response`] = schemas[definition.responseSchema];
}

for (const [index, definition] of Object.values(document['x-trade-capabilities'] ?? {}).entries()) {
  selected[`validateTradeCapability${index}Request`] = schemas[definition.requestSchema];
  selected[`validateTradeCapability${index}Response`] = schemas[definition.responseSchema];
}

function withAjvExtensions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withAjvExtensions);
  if (typeof value !== 'object' || value === null) return value;
  if ('$ref' in value && typeof value.$ref === 'string') {
    const prefix = '#/components/schemas/';
    if (value.$ref.startsWith(prefix)) {
      const referenced = schemas[value.$ref.slice(prefix.length)];
      if (!referenced) throw new Error(`OpenAPI schema ${value.$ref} is missing`);
      return withAjvExtensions(referenced);
    }
  }
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key === 'x-ajv-errorMessage' ? 'errorMessage' : key] = withAjvExtensions(child);
  }
  return result;
}

for (const [name, schema] of Object.entries(selected)) {
  if (!schema) throw new Error(`OpenAPI schema ${name} is missing`);
  ajv.addSchema({ ...(withAjvExtensions(schema) as object), $id: name }, name);
}

const validators = Object.fromEntries(
  Object.keys(selected).map((name) => {
    if (!ajv.getSchema(name)) throw new Error(`Could not compile ${name}`);
    return [name, name];
  })
);

const unicodeLengthRuntime = 'require("ajv/dist/runtime/ucs2length").default';
const browserSafeCode = standaloneCode(ajv, validators).replace(
  unicodeLengthRuntime,
  '((value) => [...value].length)'
);
if (browserSafeCode.includes('require(') || browserSafeCode.includes('eval(')) {
  throw new Error('AJV standalone output contains a browser-unsafe runtime dependency.');
}
const output = `// @ts-nocheck\n// Generated from openapi/one-vegetable.json. Do not edit.\n${browserSafeCode}\n`;
const target = resolve(root, 'packages/core/src/generated/validators.ts');

if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8');
  if (current !== output) {
    throw new Error('Generated AJV validators are stale. Run pnpm generate:validators.');
  }
} else {
  await writeFile(target, output, 'utf8');
}
