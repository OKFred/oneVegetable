import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import addErrors from 'ajv-errors';
import addFormats from 'ajv-formats';

type CapabilityDomain = 'product' | 'rfq' | 'trade' | 'logistics' | 'insights' | 'photo' | 'platform';

interface CapabilitySchemas {
  requestSchema: string;
  responseSchema: string;
}

interface OpenApiDocument {
  'x-product-capabilities'?: Record<string, CapabilitySchemas>;
  'x-rfq-capabilities'?: Record<string, CapabilitySchemas>;
  'x-trade-capabilities'?: Record<string, CapabilitySchemas>;
  'x-logistics-capabilities'?: Record<string, CapabilitySchemas>;
  'x-insights-capabilities'?: Record<string, CapabilitySchemas>;
  'x-photo-capabilities'?: Record<string, CapabilitySchemas>;
  'x-platform-capabilities'?: Record<string, CapabilitySchemas>;
  components?: { schemas?: Record<string, object> };
}

const root = resolve(import.meta.dirname, '..');
const generatedDirectory = resolve(root, 'packages/core/src/generated');
const rawDocument = await readFile(resolve(root, 'openapi/one-vegetable.json'), 'utf8');
const document = JSON.parse(rawDocument) as OpenApiDocument;
const schemas = document.components?.schemas;
if (!schemas) throw new Error('OpenAPI components.schemas is missing');

const coreValidators: Record<string, object | undefined> = {
  validateProductSchemaRequest: schemas.ProductSchemaRequest,
  validateProductSchemaRenderRequest: schemas.ProductSchemaRenderRequest,
  validateSchemaPublishRequest: schemas.SchemaPublishRequest,
  validateProductSchemaUpdateRequest: schemas.ProductSchemaUpdateRequest,
  validateProductDisplayRequest: schemas.ProductDisplayRequest,
  validateProductGroupCreateRequest: schemas.ProductGroupCreateRequest,
  validateCapabilityCallRequest: schemas.CapabilityCallRequest,
  validateLogisticsQuoteRequest: schemas.LogisticsQuoteRequest,
  validateLogisticsOrderDraft: schemas.LogisticsOrderDraft,
  validateOperationAvailabilityRequest: schemas.OperationAvailabilityRequest,
  validateProductDescriptionTemplateListRequest: schemas.ProductDescriptionTemplateListRequest,
  validateProductDescriptionTemplateCreateRequest: schemas.ProductDescriptionTemplateCreateRequest,
  validateProductDescriptionTemplateUpdateRequest: schemas.ProductDescriptionTemplateUpdateRequest,
  validateProductDescriptionTemplateStatusRequest: schemas.ProductDescriptionTemplateStatusRequest,
  validateProductMutationJobListRequest: schemas.ProductMutationJobListRequest,
  validateProductMutationJobGetRequest: schemas.ProductMutationJobGetRequest,
  validateProductMutationJobRefreshRequest: schemas.ProductMutationJobRefreshRequest
};

const domains: CapabilityDomain[] = ['product', 'rfq', 'trade', 'logistics', 'insights', 'photo', 'platform'];
const targets = new Map<string, string>();
targets.set('validators-core.ts', compileValidators(coreValidators));

for (const domain of domains) {
  const definitions = document[`x-${domain}-capabilities`] ?? {};
  const prefix = `${domain[0]?.toUpperCase()}${domain.slice(1)}`;
  const selected: Record<string, object | undefined> = {};
  for (const [index, definition] of Object.values(definitions).entries()) {
    selected[`validate${prefix}Capability${index}Request`] = schemas[definition.requestSchema];
    selected[`validate${prefix}Capability${index}Response`] = schemas[definition.responseSchema];
  }
  targets.set(`validators-${domain}.ts`, compileValidators(selected));
}

for (const [fileName, output] of targets) {
  const target = resolve(generatedDirectory, fileName);
  if (process.argv.includes('--check')) {
    const current = await readFile(target, 'utf8');
    if (current !== output) {
      throw new Error(`Generated AJV validators are stale: ${fileName}. Run pnpm generate:validators.`);
    }
  } else {
    await writeFile(target, output, 'utf8');
  }
}

function compileValidators(selected: Record<string, object | undefined>): string {
  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    code: { esm: true, source: true },
    strict: true
  });
  addFormats(ajv);
  addErrors(ajv);

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
  const browserSafeCode = standaloneCode(ajv, validators).replace(
    'require("ajv/dist/runtime/ucs2length").default',
    '((value) => [...value].length)'
  );
  if (browserSafeCode.includes('require(') || browserSafeCode.includes('eval(')) {
    throw new Error('AJV standalone output contains a browser-unsafe runtime dependency.');
  }
  return `// @ts-nocheck\n// Generated from openapi/one-vegetable.json. Do not edit.\n${browserSafeCode}\n`;
}

function withAjvExtensions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withAjvExtensions);
  if (typeof value !== 'object' || value === null) return value;
  if ('$ref' in value && typeof value.$ref === 'string') {
    const prefix = '#/components/schemas/';
    if (value.$ref.startsWith(prefix)) {
      const referenced = schemas?.[value.$ref.slice(prefix.length)];
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
