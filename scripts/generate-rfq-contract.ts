import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { format } from 'prettier';

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

interface RfqDefinition {
  method: string;
  source: 'catalog';
  docId: number;
  title: string;
  description: string;
  lifecycle: 'active' | 'deprecated' | 'unlisted';
  risk: 'read' | 'mutation';
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
const contractPath = resolve(root, 'openapi/one-vegetable.json');
const registryPath = resolve(root, 'packages/core/src/generated/rfq-capabilities.ts');
const sourceContract = JSON.parse(await readFile(contractPath, 'utf8')) as OpenApiDocument;
const snapshot = JSON.parse(await readFile(resolve(root, 'docs/alibaba-rfq-api-docs.json'), 'utf8')) as {
  definitions: RfqDefinition[];
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
  if (normalized === 'byte') {
    return { type: 'string', contentEncoding: 'base64' };
  }
  if (
    normalized === 'number' ||
    normalized === 'long' ||
    normalized === 'integer' ||
    normalized === 'bigdecimal' ||
    normalized === 'decimal' ||
    normalized === 'double' ||
    normalized === 'float'
  ) {
    return { type: 'number' };
  }
  if (normalized === 'boolean') return { type: 'boolean' };
  if (normalized === 'date') return { type: ['integer', 'string'] };
  if (normalized === 'json' || normalized === 'object' || normalized === 'map') {
    return { type: 'object', additionalProperties: true };
  }
  return { type: 'string' };
}

function isByteArray(rawType: string): boolean {
  return rawType.replaceAll(' ', '').toLowerCase() === 'byte[]';
}

function nodeSchema(node: ParamNode): JsonSchema {
  const isArray = /\[\]\s*$/.test(node.type) && !isByteArray(node.type);
  let schema: JsonSchema;
  if ((node.subParams?.length ?? 0) > 0) {
    schema = objectSchema(node.subParams ?? []);
  } else {
    schema = scalarType(node.type);
  }
  if (node.description) schema.description = node.description;
  if (node.minValue !== undefined) schema.minimum = node.minValue;
  if (node.maxValue !== undefined) schema.maximum = node.maxValue;
  if (node.maxLength !== undefined && schema.type === 'string') schema.maxLength = node.maxLength;
  if (isArray) {
    return {
      type: 'array',
      ...(node.maxListSize !== undefined ? { maxItems: node.maxListSize } : {}),
      items: schema,
      ...(node.description ? { description: node.description } : {})
    };
  }
  return schema;
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

function defaultScalarExample(type: string): unknown {
  const normalized = normalizedType(type);
  if (normalized === 'byte') return 'aGVsbG8=';
  if (
    normalized === 'number' ||
    normalized === 'long' ||
    normalized === 'integer' ||
    normalized === 'bigdecimal' ||
    normalized === 'decimal' ||
    normalized === 'double' ||
    normalized === 'float'
  ) {
    return 123;
  }
  if (normalized === 'boolean') return false;
  if (normalized === 'json' || normalized === 'object' || normalized === 'map') return {};
  return 'demo';
}

function scalarExample(rawType: string, demo: string): unknown {
  const type = normalizedType(rawType);
  if (type === 'byte') return 'aGVsbG8=';
  if (
    type === 'number' ||
    type === 'long' ||
    type === 'integer' ||
    type === 'bigdecimal' ||
    type === 'decimal' ||
    type === 'double' ||
    type === 'float'
  ) {
    const numeric = Number(demo.replace(/L$/i, ''));
    return Number.isFinite(numeric) ? numeric : 0;
  }
  if (type === 'boolean') return demo === 'true';
  if (type === 'json') {
    try {
      return JSON.parse(demo) as unknown;
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
  if (/\[\]\s*$/.test(node.type) && !isByteArray(node.type)) {
    if (demo === undefined) return node.required ? [defaultScalarExample(node.type)] : [];
    try {
      const parsed: unknown = JSON.parse(demo.replaceAll('“', '"').replaceAll('”', '"'));
      return Array.isArray(parsed) ? parsed : [scalarExample(node.type, demo)];
    } catch {
      return demo.split(',').map((value) => scalarExample(node.type, value.trim()));
    }
  }
  return demo === undefined ? defaultScalarExample(node.type) : scalarExample(node.type, demo);
}

function parsedResponseExample(definition: RfqDefinition): unknown {
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
  Object.entries(document.components.schemas).filter(([name]) => !name.startsWith('AlibabaRfq'))
);

const capabilityMap: Record<string, unknown> = {};
for (const definition of snapshot.definitions) {
  const baseName = schemaName(definition.method);
  const requestSchema = `AlibabaRfq${baseName}Request`;
  const responseSchema = `AlibabaRfq${baseName}Response`;
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
    verification: 'documented',
    realCallEnabled: definition.risk === 'read',
    checkedAt: definition.checkedAt,
    updatedAt: definition.updatedAt,
    title: definition.title,
    description: definition.description,
    errorCodes: definition.errorCodes,
    requestExample:
      definition.requestExample ??
      Object.fromEntries(definition.requestParams.map((node) => [node.name, exampleValue(node)])),
    responseExample: parsedResponseExample(definition),
    docUrl: `https://developer.alibaba.com/docs/api.htm?apiId=${definition.docId}`
  };
}
document['x-rfq-capabilities'] = capabilityMap;

const rfqSummarySchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'subject',
    'description',
    'quantity',
    'quantityUnit',
    'countryCode',
    'categoryId',
    'categoryName',
    'imageUrl',
    'remainingQuotes',
    'openAt',
    'expiresAt',
    'read',
    'recommended'
  ],
  properties: {
    id: { type: 'string' },
    subject: { type: 'string' },
    description: { type: 'string' },
    quantity: { type: ['number', 'null'] },
    quantityUnit: { type: ['string', 'null'] },
    countryCode: { type: ['string', 'null'] },
    categoryId: { type: ['number', 'null'] },
    categoryName: { type: ['string', 'null'] },
    imageUrl: { type: ['string', 'null'] },
    remainingQuotes: { type: ['number', 'null'] },
    openAt: { type: ['string', 'null'], format: 'date-time' },
    expiresAt: { type: ['string', 'null'], format: 'date-time' },
    read: { type: 'boolean' },
    recommended: { type: 'boolean' }
  }
};
document.components.schemas.RfqSummary = rfqSummarySchema;
document.components.schemas.RfqPage = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'page', 'pageSize', 'total', 'source'],
  properties: {
    items: { type: 'array', items: { $ref: '#/components/schemas/RfqSummary' } },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1 },
    total: { type: 'integer', minimum: 0 },
    source: { type: 'string', enum: ['search', 'recommend'] }
  }
};
document.components.schemas.RfqAttachment = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'url'],
  properties: { name: { type: 'string' }, url: { type: 'string' } }
};
document.components.schemas.RfqDetail = {
  type: 'object',
  additionalProperties: false,
  required: [
    ...(rfqSummarySchema.required as string[]),
    'paymentTerms',
    'destinationPort',
    'shippingTerms',
    'attachments'
  ],
  properties: {
    ...rfqSummarySchema.properties,
    paymentTerms: { type: ['string', 'null'] },
    destinationPort: { type: ['string', 'null'] },
    shippingTerms: { type: ['string', 'null'] },
    attachments: {
      type: 'array',
      items: { $ref: '#/components/schemas/RfqAttachment' }
    }
  }
};
document.components.schemas.RfqEquity = {
  type: 'object',
  additionalProperties: false,
  required: ['remainingQuotes', 'remainingTopQuotes', 'score', 'beatSupplierPercent', 'expiresAt'],
  properties: {
    remainingQuotes: { type: 'number' },
    remainingTopQuotes: { type: 'number' },
    score: { type: 'number' },
    beatSupplierPercent: { type: ['string', 'null'] },
    expiresAt: { type: ['string', 'null'] }
  }
};
document.components.schemas.RfqReadStatus = {
  type: 'object',
  additionalProperties: false,
  required: ['statuses'],
  properties: {
    statuses: { type: 'object', additionalProperties: { type: 'boolean' } }
  }
};
document.components.schemas.RfqQuotationPrice = {
  type: 'object',
  additionalProperties: false,
  required: [
    'itemName',
    'unitPrice',
    'currency',
    'quantity',
    'quantityUnit',
    'shippingTerms',
    'port',
    'remark'
  ],
  properties: {
    itemName: { type: 'string', minLength: 1 },
    unitPrice: { type: 'string', minLength: 1 },
    currency: { type: 'string', minLength: 1 },
    quantity: { type: 'string', minLength: 1 },
    quantityUnit: { type: 'string', minLength: 1 },
    shippingTerms: { type: 'string', minLength: 1 },
    port: { type: 'string', minLength: 1 },
    remark: { type: 'string' },
    modelNumber: { type: 'string' },
    imageFilesString: { type: 'string' }
  }
};
document.components.schemas.RfqQuotationRequest = {
  type: 'object',
  additionalProperties: false,
  required: ['rfqId', 'message', 'paymentTerms', 'expiresAt', 'prices'],
  properties: {
    rfqId: { type: 'string', minLength: 1 },
    message: { type: 'string', minLength: 1 },
    paymentTerms: { type: 'string', minLength: 1 },
    expiresAt: { type: 'string', minLength: 1 },
    prices: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/components/schemas/RfqQuotationPrice' }
    },
    attachmentFilesString: { type: 'string' }
  }
};
document.components.schemas.RfqQuotationResult = {
  type: 'object',
  additionalProperties: false,
  required: ['quotationId', 'success'],
  properties: { quotationId: { type: 'string' }, success: { type: 'boolean' } }
};
document.components.schemas.RfqAttachmentUploadRequest = {
  type: 'object',
  additionalProperties: false,
  required: ['fileName', 'file'],
  properties: {
    fileName: { type: 'string', minLength: 1 },
    file: { type: 'string', minLength: 1, contentEncoding: 'base64' }
  }
};
document.components.schemas.RfqAttachmentUploadResult = {
  type: 'object',
  additionalProperties: false,
  required: ['filesString'],
  properties: { filesString: { type: 'string' } }
};

const gatewayFailureResponses = {
  '4XX': { $ref: '#/components/responses/GatewayFailure' },
  default: { $ref: '#/components/responses/GatewayFailure' }
};
const jsonResponse = (description: string, schema: JsonSchema) => ({
  description,
  content: { 'application/json': { schema } }
});
const jsonRequest = (schema: JsonSchema) => ({
  required: true,
  content: { 'application/json': { schema } }
});
document.paths['/rfqs'] = {
  get: {
    summary: 'Search RFQs',
    operationId: 'listRfqs',
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
      { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
      { name: 'keywords', in: 'query', schema: { type: 'string' } },
      { name: 'categoryId', in: 'query', schema: { type: 'string' } },
      { name: 'country', in: 'query', schema: { type: 'string' } },
      { name: 'unquotedOnly', in: 'query', schema: { type: 'boolean' } }
    ],
    responses: {
      '200': jsonResponse('RFQ search result', { $ref: '#/components/schemas/RfqPage' }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/rfqs/recommended'] = {
  get: {
    summary: 'List recommended RFQs',
    operationId: 'listRecommendedRfqs',
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
      { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } }
    ],
    responses: {
      '200': jsonResponse('Recommended RFQs', { $ref: '#/components/schemas/RfqPage' }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/rfqs/equity'] = {
  get: {
    summary: 'Get RFQ quotation equity',
    operationId: 'getRfqEquity',
    responses: {
      '200': jsonResponse('RFQ equity', { $ref: '#/components/schemas/RfqEquity' }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/rfqs/read-status'] = {
  post: {
    summary: 'Get RFQ read status for up to 20 IDs',
    operationId: 'getRfqReadStatus',
    requestBody: jsonRequest({
      type: 'object',
      additionalProperties: false,
      required: ['rfqIds'],
      properties: {
        rfqIds: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' } }
      }
    }),
    responses: {
      '200': jsonResponse('RFQ read status map', { $ref: '#/components/schemas/RfqReadStatus' }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/rfqs/{rfqId}'] = {
  get: {
    summary: 'Get an RFQ detail',
    operationId: 'getRfq',
    parameters: [{ name: 'rfqId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      '200': jsonResponse('RFQ detail', { $ref: '#/components/schemas/RfqDetail' }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/rfqs/attachments'] = {
  post: {
    summary: 'Upload an RFQ quotation attachment',
    operationId: 'uploadRfqAttachment',
    requestBody: jsonRequest({ $ref: '#/components/schemas/RfqAttachmentUploadRequest' }),
    responses: {
      '200': jsonResponse('RFQ attachment token', {
        $ref: '#/components/schemas/RfqAttachmentUploadResult'
      }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/rfqs/quotations'] = {
  post: {
    summary: 'Submit an RFQ quotation',
    operationId: 'submitRfqQuotation',
    requestBody: jsonRequest({ $ref: '#/components/schemas/RfqQuotationRequest' }),
    responses: {
      '200': jsonResponse('RFQ quotation result', {
        $ref: '#/components/schemas/RfqQuotationResult'
      }),
      ...gatewayFailureResponses
    }
  }
};

const productDefinitions = Object.values(
  (document['x-product-capabilities'] ?? {}) as Record<
    string,
    { requestSchema: string; responseSchema: string }
  >
);
const tradeDefinitions = Object.values(
  (document['x-trade-capabilities'] ?? {}) as Record<
    string,
    { requestSchema: string; responseSchema: string }
  >
);
const logisticsDefinitions = Object.values(
  (document['x-logistics-capabilities'] ?? {}) as Record<
    string,
    { requestSchema: string; responseSchema: string }
  >
);
const insightsDefinitions = Object.values(
  (document['x-insights-capabilities'] ?? {}) as Record<
    string,
    { requestSchema: string; responseSchema: string }
  >
);
const photoDefinitions = Object.values(
  (document['x-photo-capabilities'] ?? {}) as Record<
    string,
    { requestSchema: string; responseSchema: string }
  >
);
const platformDefinitions = Object.values(
  (document['x-platform-capabilities'] ?? {}) as Record<
    string,
    { requestSchema: string; responseSchema: string }
  >
);
const combinedDefinitions = [
  ...productDefinitions,
  ...(Object.values(capabilityMap) as { requestSchema: string; responseSchema: string }[]),
  ...tradeDefinitions,
  ...logisticsDefinitions,
  ...insightsDefinitions,
  ...photoDefinitions,
  ...platformDefinitions
];
const envelope = document.components.schemas.CapabilityResponseEnvelope;
const envelopeProperties = envelope.properties as Record<string, JsonSchema>;
envelopeProperties.data = {
  oneOf: combinedDefinitions.map((definition) => ({
    $ref: `#/components/schemas/${definition.responseSchema}`
  }))
};
const capabilityPath = document.paths['/capabilities/{method}'] as {
  post?: {
    summary?: string;
    operationId?: string;
    requestBody: { content: { 'application/json': { schema: JsonSchema } } };
  };
};
if (capabilityPath.post) {
  capabilityPath.post.summary = 'Call a method-typed capability';
  capabilityPath.post.operationId = 'callTypedCapability';
  capabilityPath.post.requestBody.content['application/json'].schema = {
    oneOf: combinedDefinitions.map((definition) => ({
      $ref: `#/components/schemas/${definition.requestSchema}`
    }))
  };
}

const definitions = Object.entries(capabilityMap);
const registry = `// Generated by scripts/generate-rfq-contract.ts. Do not edit.\nimport type { components } from './api';\n\nexport interface RfqCapabilityRequestMap {\n${definitions
  .map(
    ([method, value]) =>
      `  '${method}': components['schemas']['${(value as { requestSchema: string }).requestSchema}'];`
  )
  .join('\n')}\n}\n\nexport interface RfqCapabilityResponseMap {\n${definitions
  .map(
    ([method, value]) =>
      `  '${method}': components['schemas']['${(value as { responseSchema: string }).responseSchema}'];`
  )
  .join(
    '\n'
  )}\n}\n\nexport const RFQ_CAPABILITY_DEFINITIONS = ${JSON.stringify(capabilityMap, null, 2)} as const;\n`;

document.components.schemas = Object.fromEntries(
  Object.entries(document.components.schemas).sort(([left], [right]) => left.localeCompare(right))
);

const prettierJsonOptions = { parser: 'json', printWidth: 110, endOfLine: 'lf' } as const;
const contractOutput = await format(JSON.stringify(document), prettierJsonOptions);
if (process.argv.includes('--check')) {
  const currentRegistry = await readFile(registryPath, 'utf8');
  const currentContractOutput = await format(JSON.stringify(sourceContract), prettierJsonOptions);
  if (contractOutput !== currentContractOutput || currentRegistry !== registry) {
    throw new Error('Generated RFQ contract is stale. Run pnpm generate:rfq-contract.');
  }
} else {
  await Promise.all([
    writeFile(contractPath, contractOutput, 'utf8'),
    writeFile(registryPath, registry, 'utf8')
  ]);
}
