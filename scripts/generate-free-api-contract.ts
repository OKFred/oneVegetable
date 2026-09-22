import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { format } from 'prettier';
import {
  applySchemaPatches,
  withAlibabaResponseMetadata,
  type JsonSchema
} from './lib/alibaba-response-contract';
import {
  freeApiExample,
  freeApiObjectSchema,
  freeApiSchemaName,
  shareFreeApiSchemas,
  type FreeApiParam
} from './lib/free-api-contract';
import { normalizeHttpContract } from './lib/normalize-http-contract';
import { writeTextFileWithRetry } from './lib/safe-write';
import { readAccountVerifiedMethods } from './lib/account-verification';

interface Definition {
  method: string;
  docId: number;
  title: string;
  description: string;
  domain: string;
  risk: 'read' | 'mutation';
  featureArea: string;
  businessScope: string;
  permissionGroups: string[];
  auth: 'required' | 'optional' | 'none' | 'unknown';
  chargeLabel: string;
  restricted: boolean;
  restrictionReason: string | null;
  checkedAt: string;
  updatedAt: string | null;
  requestParams: FreeApiParam[];
  responseParams: FreeApiParam[];
  errorCodes: unknown[];
}
interface Override {
  reason: string;
  requestSchemaPatches?: Record<string, JsonSchema>;
  responseSchemaPatches?: Record<string, JsonSchema>;
}
interface Document {
  [key: string]: unknown;
  paths: Record<string, unknown>;
  components: { schemas: Record<string, JsonSchema> };
}
const root = resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');
if (!check) await mkdir(resolve(root, 'mock/data/free-api'), { recursive: true });
const snapshot = JSON.parse(await readFile(resolve(root, 'docs/alibaba-free-api-docs.json'), 'utf8')) as {
  definitions: Definition[];
};
const overrides = JSON.parse(
  await readFile(resolve(root, 'config/alibaba-free-api-overrides.json'), 'utf8')
) as Record<string, Override>;
const verified = await readAccountVerifiedMethods(root);
const original = await readFile(resolve(root, 'openapi/one-vegetable.json'), 'utf8');
const document = JSON.parse(original) as Document;
const schemas = Object.fromEntries(
  Object.entries(document.components.schemas).filter(([key]) => !key.startsWith('AlibabaFreeApi'))
);
document.components.schemas = schemas;
const map: Record<string, object> = {};
const auditEntries: object[] = [];
const fixtures: Record<string, { request: unknown; response: unknown }> = {};
for (const definition of snapshot.definitions) {
  const base = freeApiSchemaName(definition.method);
  const requestSchema = `${base}Request`;
  const responseSchema = `${base}Response`;
  const override = overrides[definition.method];
  schemas[requestSchema] = {
    ...applySchemaPatches(freeApiObjectSchema(definition.requestParams), override?.requestSchemaPatches),
    title: `${definition.method} request`
  };
  schemas[responseSchema] = {
    ...applySchemaPatches(
      withAlibabaResponseMetadata(freeApiObjectSchema(definition.responseParams, true)),
      override?.responseSchemaPatches
    ),
    minProperties: 1,
    title: `${definition.method} response`
  };
  const fixture = {
    request: freeApiExample(definition.requestParams),
    response: freeApiExample(definition.responseParams)
  };
  fixtures[definition.method] = fixture;
  const common = {
    requestSchema,
    responseSchema,
    source: 'catalog',
    lifecycle: 'active',
    risk: definition.risk,
    featureArea: definition.featureArea,
    businessScope: definition.businessScope,
    permissionGroups: definition.permissionGroups,
    auth: definition.auth,
    verification: verified.has(definition.method) ? 'account-verified' : 'documented',
    realCallEnabled: definition.risk === 'read' && !definition.restricted,
    restricted: definition.restricted,
    restrictionReason: definition.restrictionReason,
    checkedAt: definition.checkedAt,
    updatedAt: definition.updatedAt,
    docUrl: `https://open.taobao.com/api.htm?docId=${definition.docId}&docType=2`
  };
  map[definition.method] = {
    ...common,
    title: definition.title,
    description: definition.description,
    errorCodes: definition.errorCodes,
    requestExample: fixture.request,
    responseExample: fixture.response
  };
  auditEntries.push({
    method: definition.method,
    domain: definition.domain,
    chargeLabel: definition.chargeLabel,
    jushitaOnly: false,
    enabled: !definition.restricted,
    ...common
  });
}
shareFreeApiSchemas(schemas);
document['x-free-api-capabilities'] = map;
for (const name of ['ApiCapability', 'CapabilityDefinition']) {
  const properties = schemas[name]?.properties as Record<string, JsonSchema>;
  properties.permissionGroups = {
    type: 'array',
    items: { type: 'string' },
    description: 'Official application permission groups; not proof of account access.'
  };
  properties.businessScope = { type: 'string', description: 'Business qualification or prerequisite scope.' };
}
const envelope = schemas.CapabilityResponseEnvelope?.properties as Record<string, JsonSchema>;
envelope.data = {
  oneOf: Object.entries(document)
    .filter(([key]) => /^x-.*-capabilities$/.test(key))
    .flatMap(([, value]) =>
      Object.values(value as Record<string, { responseSchema: string }>).map((item) => ({
        $ref: `#/components/schemas/${item.responseSchema}`
      }))
    )
};
const registry = `// Generated by scripts/generate-free-api-contract.ts. Do not edit.\nimport type { components } from './api';\n\n${['Request', 'Response'].map((kind) => `export interface FreeApiCapability${kind}Map {\n${snapshot.definitions.map((d) => `  '${d.method}': components['schemas']['${freeApiSchemaName(d.method)}${kind}'];`).join('\n')}\n}`).join('\n\n')}\n\nexport const FREE_API_CAPABILITY_DEFINITIONS = ${JSON.stringify(map, null, 2)} as const;\n`;
normalizeHttpContract(document);
document.components.schemas = Object.fromEntries(
  Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b))
);
const outputs = new Map<string, string>([
  [
    'openapi/one-vegetable.json',
    await format(JSON.stringify(document), { parser: 'json', printWidth: 110, endOfLine: 'lf' })
  ],
  ['packages/core/src/generated/free-api-capabilities.ts', registry],
  [
    'mock/data/free-api/examples.json',
    await format(JSON.stringify(fixtures), { parser: 'json', printWidth: 110, endOfLine: 'lf' })
  ],
  [
    'docs/alibaba-free-api-audit.json',
    await format(JSON.stringify({ entries: auditEntries }), {
      parser: 'json',
      printWidth: 110,
      endOfLine: 'lf'
    })
  ]
]);
for (const [file, content] of outputs) {
  if (check) {
    const current = await readFile(resolve(root, file), 'utf8');
    if (current !== content) throw new Error(`Free API contract drift: ${file}`);
  } else await writeTextFileWithRetry(resolve(root, file), content);
}
