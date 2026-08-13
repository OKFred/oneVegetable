import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { format } from 'prettier';

import { normalizeHttpContract } from './lib/normalize-http-contract';

interface ParamNode {
  name: string;
  type: string;
  required: boolean;
  description: string;
  subParams?: ParamNode[];
}

interface PlatformDefinition {
  method: string;
  source: 'catalog';
  docId: number;
  title: string;
  description: string;
  lifecycle: 'active' | 'deprecated' | 'unlisted';
  risk: 'read' | 'mutation';
  featureArea: 'fileTransfer' | 'riskAssessment' | 'taskCallback';
  restricted: boolean;
  restrictionReason: string | null;
  checkedAt: string;
  updatedAt: string | null;
  requestParams: ParamNode[];
  responseParams: ParamNode[];
  errorCodes: unknown[];
  requestExample: unknown;
  responseExample: unknown;
}

type JsonSchema = Record<string, unknown>;
interface OpenApiDocument {
  [key: string]: unknown;
  paths: Record<string, unknown>;
  components: { schemas: Record<string, JsonSchema>; [key: string]: unknown };
}

const root = resolve(import.meta.dirname, '..');
const contractPath = resolve(root, 'openapi/one-vegetable.json');
const registryPath = resolve(root, 'packages/core/src/generated/platform-capabilities.ts');
const sourceContract = JSON.parse(await readFile(contractPath, 'utf8')) as OpenApiDocument;
const snapshot = JSON.parse(await readFile(resolve(root, 'docs/alibaba-platform-api-docs.json'), 'utf8')) as {
  definitions: PlatformDefinition[];
};

function schemaName(method: string): string {
  return method
    .split('.')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');
}

function normalizedType(rawType: string): string {
  return rawType.replaceAll(' ', '').replace(/\[\]$/, '').toLowerCase();
}

function scalarSchema(rawType: string): JsonSchema {
  const type = normalizedType(rawType);
  if (type === 'byte') return { type: 'string', contentEncoding: 'base64' };
  if (['number', 'long', 'integer', 'double', 'float'].includes(type)) return { type: 'number' };
  if (type === 'boolean') return { type: 'boolean' };
  if (type === 'date') return { type: ['integer', 'string'] };
  if (['json', 'object', 'map'].includes(type)) return { type: 'object', additionalProperties: true };
  return { type: 'string' };
}

function nodeSchema(node: ParamNode): JsonSchema {
  const array = /\[\]\s*$/.test(node.type) && normalizedType(node.type) !== 'byte';
  const item =
    (node.subParams?.length ?? 0) > 0 ? objectSchema(node.subParams ?? []) : scalarSchema(node.type);
  const schema = array ? { type: 'array', items: item } : item;
  return node.description ? { ...schema, description: node.description } : schema;
}

function objectSchema(nodes: ParamNode[]): JsonSchema {
  const required = nodes.filter((node) => node.required).map((node) => node.name);
  return {
    type: 'object',
    additionalProperties: false,
    ...(required.length > 0 ? { required } : {}),
    properties: Object.fromEntries(nodes.map((node) => [node.name, nodeSchema(node)]))
  };
}

const document = structuredClone(sourceContract);
document.components.schemas = Object.fromEntries(
  Object.entries(document.components.schemas).filter(([name]) => !name.startsWith('AlibabaPlatform'))
);
const capabilityMap: Record<string, unknown> = {};
for (const definition of snapshot.definitions) {
  const baseName = schemaName(definition.method);
  const requestSchema = `AlibabaPlatform${baseName}Request`;
  const responseSchema = `AlibabaPlatform${baseName}Response`;
  document.components.schemas[requestSchema] = {
    ...objectSchema(definition.requestParams),
    title: `${definition.method} request`
  };
  document.components.schemas[responseSchema] = {
    ...objectSchema(definition.responseParams),
    title: `${definition.method} response`
  };
  capabilityMap[definition.method] = {
    requestSchema,
    responseSchema,
    source: definition.source,
    lifecycle: definition.lifecycle,
    risk: definition.risk,
    featureArea: definition.featureArea,
    verification: 'documented',
    realCallEnabled: false,
    restricted: definition.restricted,
    restrictionReason: definition.restrictionReason,
    checkedAt: definition.checkedAt,
    updatedAt: definition.updatedAt,
    title: definition.title,
    description: definition.description,
    errorCodes: definition.errorCodes,
    requestExample: definition.requestExample ?? {},
    responseExample: definition.responseExample ?? {},
    docUrl: `https://developer.alibaba.com/docs/api.htm?apiId=${definition.docId}`
  };
}
document['x-platform-capabilities'] = capabilityMap;

const extensions = [
  'x-product-capabilities',
  'x-rfq-capabilities',
  'x-trade-capabilities',
  'x-logistics-capabilities',
  'x-insights-capabilities',
  'x-photo-capabilities',
  'x-platform-capabilities'
];
const allDefinitions = extensions.flatMap((extension) =>
  Object.values(
    (document[extension] ?? {}) as Record<string, { requestSchema: string; responseSchema: string }>
  )
);
const envelopeProperties = document.components.schemas.CapabilityResponseEnvelope.properties as Record<
  string,
  JsonSchema
>;
envelopeProperties.data = {
  oneOf: allDefinitions.map((definition) => ({
    $ref: `#/components/schemas/${definition.responseSchema}`
  }))
};

const definitions = Object.entries(capabilityMap);
const registry = `// Generated by scripts/generate-platform-contract.ts. Do not edit.\nimport type { components } from './api';\n\nexport interface PlatformCapabilityRequestMap {\n${definitions
  .map(
    ([method, value]) =>
      `  '${method}': components['schemas']['${(value as { requestSchema: string }).requestSchema}'];`
  )
  .join('\n')}\n}\n\nexport interface PlatformCapabilityResponseMap {\n${definitions
  .map(
    ([method, value]) =>
      `  '${method}': components['schemas']['${(value as { responseSchema: string }).responseSchema}'];`
  )
  .join(
    '\n'
  )}\n}\n\nexport const PLATFORM_CAPABILITY_DEFINITIONS = ${JSON.stringify(capabilityMap, null, 2)} as const;\n`;

document.components.schemas = Object.fromEntries(
  Object.entries(document.components.schemas).sort(([left], [right]) => left.localeCompare(right))
);
const options = { parser: 'json', printWidth: 110, endOfLine: 'lf' } as const;
normalizeHttpContract(document);
const contractOutput = await format(JSON.stringify(document), options);
if (process.argv.includes('--check')) {
  const currentRegistry = await readFile(registryPath, 'utf8');
  const currentContractOutput = await format(JSON.stringify(sourceContract), options);
  if (contractOutput !== currentContractOutput || currentRegistry !== registry) {
    throw new Error('Generated platform contract is stale. Run pnpm generate:platform-contract.');
  }
} else {
  await Promise.all([
    writeFile(contractPath, contractOutput, 'utf8'),
    writeFile(registryPath, registry, 'utf8')
  ]);
}
