import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import addErrors from 'ajv-errors';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

interface OpenApiDocument {
  components?: {
    schemas?: Record<string, object>;
  };
}

const root = resolve(import.meta.dirname, '..');
const document = parse(await readFile(resolve(root, 'openapi/one-vegetable.yaml'), 'utf8')) as OpenApiDocument;
const schemas = document.components?.schemas;
if (!schemas) throw new Error('OpenAPI components.schemas is missing');

const ajv = new Ajv2020({ allErrors: true, code: { esm: true, source: true }, strict: true });
addFormats(ajv);
addErrors(ajv);

const selected = {
  validateProductSchemaRequest: schemas.ProductSchemaRequest,
  validateSchemaPublishRequest: schemas.SchemaPublishRequest,
  validateCapabilityCallRequest: schemas.CapabilityCallRequest
};

function withAjvExtensions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withAjvExtensions);
  if (typeof value !== 'object' || value === null) return value;
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

const output = `// @ts-nocheck\n// Generated from openapi/one-vegetable.yaml. Do not edit.\n${standaloneCode(ajv, validators)}\n`;
await writeFile(resolve(root, 'packages/core/src/generated/validators.ts'), output, 'utf8');
