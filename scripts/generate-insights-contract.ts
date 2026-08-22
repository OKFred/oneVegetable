import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { format } from 'prettier';

import { withAlibabaResponseMetadata } from './lib/alibaba-response-contract';
import { readAccountVerifiedMethods } from './lib/account-verification';
import { normalizeHttpContract } from './lib/normalize-http-contract';
import { writeTextFileWithRetry } from './lib/safe-write';

interface ParamNode {
  name: string;
  type: string;
  required: boolean;
  description: string;
  defaultValue?: string;
  demoValue?: string;
  minValue?: number;
  maxValue?: number;
  maxLength?: number;
  maxListSize?: number;
  subParams?: ParamNode[];
}

interface InsightsDefinition {
  method: string;
  source: 'catalog';
  sourceCategory: 'data' | 'buyer';
  docId: number;
  title: string;
  description: string;
  lifecycle: 'active' | 'deprecated' | 'unlisted';
  risk: 'read' | 'mutation';
  featureArea: 'performance' | 'partnerData' | 'suppliers' | 'supplierProducts';
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
  components: {
    schemas: Record<string, JsonSchema>;
    [key: string]: unknown;
  };
}

const root = resolve(import.meta.dirname, '..');
const accountVerifiedMethods = await readAccountVerifiedMethods(root);
const contractPath = resolve(root, 'openapi/one-vegetable.json');
const registryPath = resolve(root, 'packages/core/src/generated/insights-capabilities.ts');
const sourceContract = JSON.parse(await readFile(contractPath, 'utf8')) as OpenApiDocument;
const snapshot = JSON.parse(await readFile(resolve(root, 'docs/alibaba-insights-api-docs.json'), 'utf8')) as {
  definitions: InsightsDefinition[];
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

function scalarType(rawType: string): JsonSchema {
  const normalized = normalizedType(rawType);
  if (normalized === 'byte') return { type: 'string', contentEncoding: 'base64' };
  if (['number', 'long', 'integer', 'bigdecimal', 'decimal', 'double', 'float'].includes(normalized)) {
    return { type: 'number' };
  }
  if (normalized === 'boolean') return { type: 'boolean' };
  if (normalized === 'date') return { type: ['integer', 'string'] };
  if (['json', 'object', 'map'].includes(normalized)) {
    return { type: 'object', additionalProperties: true };
  }
  return { type: 'string' };
}

function nodeSchema(node: ParamNode): JsonSchema {
  const isArray = /\[\]\s*$/.test(node.type) && normalizedType(node.type) !== 'byte';
  const schema =
    (node.subParams?.length ?? 0) > 0 ? objectSchema(node.subParams ?? []) : scalarType(node.type);
  if (node.description) schema.description = node.description;
  if (node.minValue !== undefined) schema.minimum = node.minValue;
  if (node.maxValue !== undefined) schema.maximum = node.maxValue;
  if (node.maxLength !== undefined && schema.type === 'string') schema.maxLength = node.maxLength;
  if (!isArray) return schema;
  return {
    type: 'array',
    ...(node.maxListSize !== undefined ? { maxItems: node.maxListSize } : {}),
    items: schema,
    ...(node.description ? { description: node.description } : {})
  };
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

function scalarExample(rawType: string, demo: string): unknown {
  const type = normalizedType(rawType);
  if (['number', 'long', 'integer', 'bigdecimal', 'decimal', 'double', 'float'].includes(type)) {
    const numeric = Number(demo.replace(/L$/i, ''));
    return Number.isFinite(numeric) ? numeric : 0;
  }
  if (type === 'boolean') return demo === 'true';
  if (['json', 'object', 'map'].includes(type)) {
    try {
      return JSON.parse(demo.replaceAll('“', '"').replaceAll('”', '"')) as unknown;
    } catch {
      return {};
    }
  }
  return demo;
}

function exampleValue(node: ParamNode): unknown {
  if ((node.subParams?.length ?? 0) > 0) {
    const value = Object.fromEntries(
      (node.subParams ?? []).map((child) => [child.name, exampleValue(child)])
    );
    return /\[\]\s*$/.test(node.type) ? [value] : value;
  }
  const demo = node.demoValue ?? node.defaultValue;
  if (/\[\]\s*$/.test(node.type)) {
    if (demo === undefined) return [];
    try {
      const parsed: unknown = JSON.parse(demo.replaceAll("'", '"'));
      return Array.isArray(parsed) ? parsed : [scalarExample(node.type, demo)];
    } catch {
      return demo
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((value) => scalarExample(node.type, value.trim()));
    }
  }
  if (demo === undefined) return normalizedType(node.type) === 'boolean' ? false : 'demo';
  return scalarExample(node.type, demo);
}

function responseExample(definition: InsightsDefinition): unknown {
  if (typeof definition.responseExample !== 'string') {
    return (
      definition.responseExample ??
      Object.fromEntries(definition.responseParams.map((node) => [node.name, exampleValue(node)]))
    );
  }
  try {
    const parsed: unknown = JSON.parse(definition.responseExample);
    if (typeof parsed !== 'object' || parsed === null) return parsed;
    const wrapper = `${definition.method.replaceAll('.', '_')}_response`;
    return wrapper in parsed ? (parsed as Record<string, unknown>)[wrapper] : parsed;
  } catch {
    return Object.fromEntries(definition.responseParams.map((node) => [node.name, exampleValue(node)]));
  }
}

const document = structuredClone(sourceContract);
document.components.schemas = Object.fromEntries(
  Object.entries(document.components.schemas).filter(
    ([name]) => !name.startsWith('AlibabaInsights') && !name.startsWith('Insights')
  )
);

const capabilityMap: Record<string, unknown> = {};
for (const definition of snapshot.definitions) {
  const baseName = schemaName(definition.method);
  const requestSchema = `AlibabaInsights${baseName}Request`;
  const responseSchema = `AlibabaInsights${baseName}Response`;
  document.components.schemas[requestSchema] = {
    ...objectSchema(definition.requestParams),
    title: `${definition.method} request`
  };
  document.components.schemas[responseSchema] = {
    ...withAlibabaResponseMetadata(objectSchema(definition.responseParams)),
    title: `${definition.method} response`
  };
  capabilityMap[definition.method] = {
    requestSchema,
    responseSchema,
    source: definition.source,
    lifecycle: definition.lifecycle,
    risk: definition.risk,
    featureArea: definition.featureArea,
    verification: accountVerifiedMethods.has(definition.method) ? 'account-verified' : 'documented',
    realCallEnabled: !definition.restricted && definition.risk === 'read',
    restricted: definition.restricted,
    restrictionReason: definition.restrictionReason,
    checkedAt: definition.checkedAt,
    updatedAt: definition.updatedAt,
    title: definition.title,
    description: definition.description,
    errorCodes: definition.errorCodes,
    requestExample:
      definition.requestExample ??
      Object.fromEntries(definition.requestParams.map((node) => [node.name, exampleValue(node)])),
    responseExample: responseExample(definition),
    docUrl: `https://developer.alibaba.com/docs/api.htm?apiId=${definition.docId}`
  };
}
document['x-insights-capabilities'] = capabilityMap;

const nullableString = { type: ['string', 'null'] };
document.components.schemas.InsightsSupplierRankPoint = {
  type: 'object',
  additionalProperties: false,
  required: ['statDate', 'percent'],
  properties: {
    statDate: { type: 'string' },
    percent: { type: 'number', minimum: 0, maximum: 100 }
  }
};
document.components.schemas.InsightsSupplierRankTrend = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'latestPercent'],
  properties: {
    items: {
      type: 'array',
      items: { $ref: '#/components/schemas/InsightsSupplierRankPoint' }
    },
    latestPercent: { type: ['number', 'null'], minimum: 0, maximum: 100 }
  }
};
document.components.schemas.InsightsSupplierPage = {
  type: 'object',
  additionalProperties: false,
  required: ['supplierIds', 'page', 'pageSize', 'total'],
  properties: {
    supplierIds: { type: 'array', items: { type: 'string' } },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    total: { type: 'integer', minimum: 0 }
  }
};
document.components.schemas.InsightsSupplierProductAttribute = {
  type: 'object',
  additionalProperties: false,
  required: ['attributeId', 'attributeName', 'valueId', 'valueName', 'imageUrl', 'customValueName'],
  properties: {
    attributeId: { type: 'string' },
    attributeName: { type: 'string' },
    valueId: { type: 'string' },
    valueName: { type: 'string' },
    imageUrl: nullableString,
    customValueName: nullableString
  }
};
document.components.schemas.InsightsSupplierProduct = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'subject',
    'description',
    'categoryId',
    'priceRange',
    'priceUnit',
    'productUrl',
    'publishedAt',
    'attributes'
  ],
  properties: {
    id: { type: 'string' },
    subject: { type: 'string' },
    description: { type: 'string' },
    categoryId: { type: 'string' },
    priceRange: nullableString,
    priceUnit: nullableString,
    productUrl: { type: ['string', 'null'], format: 'uri' },
    publishedAt: nullableString,
    attributes: {
      type: 'array',
      items: { $ref: '#/components/schemas/InsightsSupplierProductAttribute' }
    }
  }
};
document.components.schemas.InsightsSupplierProductPage = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'page', 'pageSize', 'total'],
  properties: {
    items: {
      type: 'array',
      items: { $ref: '#/components/schemas/InsightsSupplierProduct' }
    },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    total: { type: 'integer', minimum: 0 }
  }
};

const gatewayFailureResponses = {
  '4XX': { $ref: '#/components/responses/GatewayFailure' },
  default: { $ref: '#/components/responses/GatewayFailure' }
};
const jsonResponse = (description: string, schema: JsonSchema) => ({
  description,
  content: { 'application/json': { schema } }
});
document.paths['/insights/supplier-rank'] = {
  get: {
    summary: 'Get the authenticated supplier global rank trend',
    operationId: 'getInsightsSupplierRank',
    responses: {
      '200': jsonResponse('Supplier rank trend', {
        $ref: '#/components/schemas/InsightsSupplierRankTrend'
      }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/insights/procurement-suppliers'] = {
  get: {
    summary: 'List suppliers with previous assurance orders',
    operationId: 'listInsightsSuppliers',
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
      { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } }
    ],
    responses: {
      '200': jsonResponse('Procurement supplier page', {
        $ref: '#/components/schemas/InsightsSupplierPage'
      }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/insights/procurement-supplier-products'] = {
  get: {
    summary: 'List products previously ordered from an encrypted supplier id',
    operationId: 'listInsightsSupplierProducts',
    parameters: [
      { name: 'supplierId', in: 'query', required: true, schema: { type: 'string' } },
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
      { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
      { name: 'dateStart', in: 'query', schema: { type: 'string', format: 'date-time' } },
      { name: 'dateEnd', in: 'query', schema: { type: 'string', format: 'date-time' } }
    ],
    responses: {
      '200': jsonResponse('Supplier product page', {
        $ref: '#/components/schemas/InsightsSupplierProductPage'
      }),
      ...gatewayFailureResponses
    }
  }
};

const capabilityExtensions = [
  'x-product-capabilities',
  'x-rfq-capabilities',
  'x-trade-capabilities',
  'x-logistics-capabilities',
  'x-insights-capabilities',
  'x-photo-capabilities',
  'x-platform-capabilities'
];
const combinedDefinitions = capabilityExtensions.flatMap((extension) =>
  Object.values(
    (document[extension] ?? {}) as Record<string, { requestSchema: string; responseSchema: string }>
  )
);
const envelope = document.components.schemas.CapabilityResponseEnvelope;
const envelopeProperties = envelope.properties as Record<string, JsonSchema>;
envelopeProperties.data = {
  oneOf: combinedDefinitions.map((definition) => ({
    $ref: `#/components/schemas/${definition.responseSchema}`
  }))
};
const capabilityPath = document.paths['/capabilities/{method}'] as
  | {
      post?: {
        summary?: string;
        operationId?: string;
        requestBody: { content: { 'application/json': { schema: JsonSchema } } };
      };
    }
  | undefined;
if (capabilityPath?.post) {
  capabilityPath.post.summary = 'Call a method-typed capability';
  capabilityPath.post.operationId = 'callTypedCapability';
  capabilityPath.post.requestBody.content['application/json'].schema = {
    oneOf: combinedDefinitions.map((definition) => ({
      $ref: `#/components/schemas/${definition.requestSchema}`
    }))
  };
}

const definitions = Object.entries(capabilityMap);
const registry = `// Generated by scripts/generate-insights-contract.ts. Do not edit.\nimport type { components } from './api';\n\nexport interface InsightsCapabilityRequestMap {\n${definitions
  .map(
    ([method, value]) =>
      `  '${method}': components['schemas']['${(value as { requestSchema: string }).requestSchema}'];`
  )
  .join('\n')}\n}\n\nexport interface InsightsCapabilityResponseMap {\n${definitions
  .map(
    ([method, value]) =>
      `  '${method}': components['schemas']['${(value as { responseSchema: string }).responseSchema}'];`
  )
  .join(
    '\n'
  )}\n}\n\nexport const INSIGHTS_CAPABILITY_DEFINITIONS = ${JSON.stringify(capabilityMap, null, 2)} as const;\n`;

document.components.schemas = Object.fromEntries(
  Object.entries(document.components.schemas).sort(([left], [right]) => left.localeCompare(right))
);
normalizeHttpContract(document);
const prettierJsonOptions = { parser: 'json', printWidth: 110, endOfLine: 'lf' } as const;
const contractOutput = await format(JSON.stringify(document), prettierJsonOptions);
if (process.argv.includes('--check')) {
  const currentRegistry = await readFile(registryPath, 'utf8');
  const currentContractOutput = await format(JSON.stringify(sourceContract), prettierJsonOptions);
  if (contractOutput !== currentContractOutput || currentRegistry !== registry) {
    throw new Error('Generated insights contract is stale. Run pnpm generate:insights-contract.');
  }
} else {
  await Promise.all([
    writeTextFileWithRetry(contractPath, contractOutput),
    writeTextFileWithRetry(registryPath, registry)
  ]);
}
