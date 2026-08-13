import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { format } from 'prettier';

interface ParamNode {
  name: string;
  type: string;
  required: boolean;
  description: string;
  subParams?: ParamNode[];
}

interface PhotoDefinition {
  method: string;
  source: 'catalog';
  docId: number;
  title: string;
  description: string;
  lifecycle: 'active' | 'deprecated' | 'unlisted';
  risk: 'read' | 'mutation';
  featureArea: 'groups' | 'assets';
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
const registryPath = resolve(root, 'packages/core/src/generated/photo-capabilities.ts');
const sourceContract = JSON.parse(await readFile(contractPath, 'utf8')) as OpenApiDocument;
const snapshot = JSON.parse(await readFile(resolve(root, 'docs/alibaba-photo-api-docs.json'), 'utf8')) as {
  definitions: PhotoDefinition[];
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
  Object.entries(document.components.schemas).filter(([name]) => !name.startsWith('AlibabaPhoto'))
);

const capabilityMap: Record<string, unknown> = {};
for (const definition of snapshot.definitions) {
  const baseName = schemaName(definition.method);
  const requestSchema = `AlibabaPhoto${baseName}Request`;
  const responseSchema = `AlibabaPhoto${baseName}Response`;
  document.components.schemas[requestSchema] = {
    ...objectSchema(definition.requestParams),
    title: `${definition.method} request`
  };
  document.components.schemas[responseSchema] = {
    ...objectSchema(definition.responseParams),
    title: `${definition.method} response`
  };
  if (definition.method === 'alibaba.icbu.photobank.list') {
    const responseProperties = document.components.schemas[responseSchema].properties as Record<
      string,
      JsonSchema
    >;
    const paginationProperties = responseProperties.pagination_query_list?.properties as Record<
      string,
      JsonSchema
    >;
    paginationProperties.total = { type: 'integer', minimum: 0 };
  }
  capabilityMap[definition.method] = {
    requestSchema,
    responseSchema,
    source: definition.source,
    lifecycle: definition.lifecycle,
    risk: definition.risk,
    featureArea: definition.featureArea,
    verification: 'documented',
    realCallEnabled: !definition.restricted && definition.risk === 'read',
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
document['x-photo-capabilities'] = capabilityMap;

document.components.schemas.PhotoGroup = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'photoCount', 'parentId', 'level'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    photoCount: { type: 'integer', minimum: 0 },
    parentId: { type: ['string', 'null'] },
    level: { type: 'integer', minimum: 1, maximum: 3 }
  }
};
document.components.schemas.PhotoGroupOperationRequest = {
  type: 'object',
  additionalProperties: false,
  required: ['operation', 'groupId', 'groupName'],
  properties: {
    operation: { type: 'string', enum: ['add', 'rename', 'delete'] },
    groupId: { type: ['string', 'null'] },
    groupName: { type: ['string', 'null'], maxLength: 128 }
  }
};

const gatewayFailureResponses = {
  '4XX': { $ref: '#/components/responses/GatewayFailure' },
  default: { $ref: '#/components/responses/GatewayFailure' }
};
document.paths['/photo-groups/operate'] = {
  post: {
    summary: 'Add, rename, or delete a gallery group',
    operationId: 'operatePhotoGroup',
    requestBody: {
      required: true,
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/PhotoGroupOperationRequest' } }
      }
    },
    responses: {
      '200': {
        description: 'Affected gallery group',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/PhotoGroup' } } }
      },
      ...gatewayFailureResponses
    }
  }
};

const extensions = [
  'x-product-capabilities',
  'x-rfq-capabilities',
  'x-trade-capabilities',
  'x-logistics-capabilities',
  'x-insights-capabilities',
  'x-photo-capabilities'
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
const registry = `// Generated by scripts/generate-photo-contract.ts. Do not edit.\nimport type { components } from './api';\n\nexport interface PhotoCapabilityRequestMap {\n${definitions
  .map(
    ([method, value]) =>
      `  '${method}': components['schemas']['${(value as { requestSchema: string }).requestSchema}'];`
  )
  .join('\n')}\n}\n\nexport interface PhotoCapabilityResponseMap {\n${definitions
  .map(
    ([method, value]) =>
      `  '${method}': components['schemas']['${(value as { responseSchema: string }).responseSchema}'];`
  )
  .join(
    '\n'
  )}\n}\n\nexport const PHOTO_CAPABILITY_DEFINITIONS = ${JSON.stringify(capabilityMap, null, 2)} as const;\n`;

document.components.schemas = Object.fromEntries(
  Object.entries(document.components.schemas).sort(([left], [right]) => left.localeCompare(right))
);
const options = { parser: 'json', printWidth: 110, endOfLine: 'lf' } as const;
const contractOutput = await format(JSON.stringify(document), options);
if (process.argv.includes('--check')) {
  const currentRegistry = await readFile(registryPath, 'utf8');
  const currentContractOutput = await format(JSON.stringify(sourceContract), options);
  if (contractOutput !== currentContractOutput || currentRegistry !== registry) {
    throw new Error('Generated photo contract is stale. Run pnpm generate:photo-contract.');
  }
} else {
  await Promise.all([
    writeFile(contractPath, contractOutput, 'utf8'),
    writeFile(registryPath, registry, 'utf8')
  ]);
}
