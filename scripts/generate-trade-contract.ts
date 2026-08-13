import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { format } from 'prettier';

import { normalizeHttpContract } from './lib/normalize-http-contract';

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

type FeatureArea = 'order' | 'finance' | 'fulfillment' | 'address' | 'authorization' | 'partner-specific';

interface TradeDefinition {
  method: string;
  source: 'catalog';
  docId: number;
  title: string;
  description: string;
  lifecycle: 'active' | 'deprecated' | 'unlisted';
  risk: 'read' | 'mutation';
  featureArea: FeatureArea;
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
const contractPath = resolve(root, 'openapi/one-vegetable.json');
const registryPath = resolve(root, 'packages/core/src/generated/trade-capabilities.ts');
const sourceContract = JSON.parse(await readFile(contractPath, 'utf8')) as OpenApiDocument;
const snapshot = JSON.parse(await readFile(resolve(root, 'docs/alibaba-trade-api-docs.json'), 'utf8')) as {
  definitions: TradeDefinition[];
};
const overrides = JSON.parse(
  await readFile(resolve(root, 'config/alibaba-trade-overrides.json'), 'utf8')
) as Record<string, { responseExample?: unknown }>;

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

function isByteArray(rawType: string): boolean {
  return rawType.replaceAll(' ', '').toLowerCase() === 'byte[]';
}

function nodeSchema(node: ParamNode): JsonSchema {
  const isArray = /\[\]\s*$/.test(node.type) && !isByteArray(node.type);
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

function defaultScalarExample(type: string): unknown {
  const normalized = normalizedType(type);
  if (normalized === 'byte') return 'aGVsbG8=';
  if (['number', 'long', 'integer', 'bigdecimal', 'decimal', 'double', 'float'].includes(normalized)) {
    return 123;
  }
  if (normalized === 'boolean') return false;
  if (['json', 'object', 'map'].includes(normalized)) return {};
  return 'demo';
}

function scalarExample(rawType: string, demo: string): unknown {
  const type = normalizedType(rawType);
  if (type === 'byte') return 'aGVsbG8=';
  if (['number', 'long', 'integer', 'bigdecimal', 'decimal', 'double', 'float'].includes(type)) {
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

function responseExample(definition: TradeDefinition): unknown {
  const override = overrides[definition.method]?.responseExample;
  if (override !== undefined) return override;
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
  Object.entries(document.components.schemas).filter(([name]) => !name.startsWith('AlibabaTrade'))
);

const capabilityMap: Record<string, unknown> = {};
for (const definition of snapshot.definitions) {
  const baseName = schemaName(definition.method);
  const requestSchema = `AlibabaTrade${baseName}Request`;
  const responseSchema = `AlibabaTrade${baseName}Response`;
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
document['x-trade-capabilities'] = capabilityMap;

const decimalString = { type: 'string', pattern: '^-?\\d+(?:\\.\\d+)?$' };
const nullableDateTime = { type: ['string', 'null'], format: 'date-time' };
document.components.schemas.TradeOrderSummary = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'buyerLoginId', 'status', 'amount', 'currency', 'createdAt', 'modifiedAt'],
  properties: {
    id: { type: 'string' },
    buyerLoginId: { type: ['string', 'null'] },
    status: { type: 'string' },
    amount: decimalString,
    currency: { type: 'string' },
    createdAt: nullableDateTime,
    modifiedAt: nullableDateTime
  }
};
document.components.schemas.TradeOrderPage = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'page', 'pageSize', 'total', 'documentTimeZoneUnverified'],
  properties: {
    items: { type: 'array', items: { $ref: '#/components/schemas/TradeOrderSummary' } },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    total: { type: 'integer', minimum: 0 },
    documentTimeZoneUnverified: { type: 'boolean' }
  }
};
document.components.schemas.TradeFund = {
  type: 'object',
  additionalProperties: false,
  required: ['orderId', 'paidAmount', 'currency', 'status'],
  properties: {
    orderId: { type: 'string' },
    paidAmount: decimalString,
    currency: { type: 'string' },
    status: { type: 'string' }
  }
};
document.components.schemas.TradeLogistics = {
  type: 'object',
  additionalProperties: false,
  required: ['orderId', 'status', 'carrier', 'trackingNumber'],
  properties: {
    orderId: { type: 'string' },
    status: { type: 'string' },
    carrier: { type: ['string', 'null'] },
    trackingNumber: { type: ['string', 'null'] }
  }
};
document.components.schemas.TradeOrderAggregate = {
  type: 'object',
  additionalProperties: false,
  required: ['order', 'fund', 'logistics', 'availability'],
  properties: {
    order: { $ref: '#/components/schemas/TradeOrderSummary' },
    fund: { oneOf: [{ $ref: '#/components/schemas/TradeFund' }, { type: 'null' }] },
    logistics: { oneOf: [{ $ref: '#/components/schemas/TradeLogistics' }, { type: 'null' }] },
    availability: {
      type: 'object',
      additionalProperties: false,
      required: ['order', 'fund', 'logistics', 'fullDetail'],
      properties: {
        order: { type: 'string', enum: ['available', 'unavailable'] },
        fund: { type: 'string', enum: ['available', 'unavailable'] },
        logistics: { type: 'string', enum: ['available', 'unavailable'] },
        fullDetail: { type: 'string', enum: ['jushita-only'] }
      }
    }
  }
};
document.components.schemas.TradeFulfillmentChannel = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'name', 'enabled'],
  properties: {
    code: { type: 'string' },
    name: { type: 'string' },
    enabled: { type: 'boolean' },
    unavailableReason: { type: ['string', 'null'] }
  }
};
document.components.schemas.TradeServiceChargeItem = {
  type: 'object',
  additionalProperties: false,
  required: ['ratio', 'maxFee', 'exportServiceType', 'logisticsType'],
  properties: {
    ratio: { type: ['string', 'null'] },
    maxFee: { type: ['string', 'null'] },
    exportServiceType: { type: ['string', 'null'] },
    logisticsType: { type: ['string', 'null'] }
  }
};
document.components.schemas.TradeServiceCharge = {
  type: 'object',
  additionalProperties: false,
  required: ['currency', 'items'],
  properties: {
    currency: { type: 'string' },
    items: { type: 'array', items: { $ref: '#/components/schemas/TradeServiceChargeItem' } }
  }
};
document.components.schemas.TradeTtAccount = {
  type: 'object',
  additionalProperties: false,
  required: [
    'orderId',
    'payableAmount',
    'currency',
    'accountName',
    'accountNumber',
    'bankName',
    'guideContent'
  ],
  properties: {
    orderId: { type: 'string' },
    payableAmount: decimalString,
    currency: { type: 'string' },
    accountName: { type: ['string', 'null'] },
    accountNumber: { type: ['string', 'null'] },
    bankName: { type: ['string', 'null'] },
    guideContent: { type: ['string', 'null'] }
  }
};
document.components.schemas.TradeAddressSchemaField = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'type', 'required', 'readOnly', 'options'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    type: { type: 'string', enum: ['text', 'select', 'textarea'] },
    required: { type: 'boolean' },
    readOnly: { type: 'boolean' },
    pattern: { type: ['string', 'null'] },
    maxLength: { type: ['integer', 'null'] },
    options: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'value'],
        properties: { label: { type: 'string' }, value: { type: 'string' } }
      }
    }
  }
};
document.components.schemas.TradeAddressSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fields'],
  properties: {
    fields: { type: 'array', items: { $ref: '#/components/schemas/TradeAddressSchemaField' } }
  }
};
document.components.schemas.TradeAddress = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'values'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    values: { type: 'object', additionalProperties: { type: 'string' } }
  }
};
document.components.schemas.TradeOrderDraft = {
  type: 'object',
  additionalProperties: false,
  required: ['buyerLoginId', 'currency', 'items'],
  properties: {
    orderId: { type: 'string' },
    buyerLoginId: { type: 'string', minLength: 1 },
    currency: { type: 'string', minLength: 1 },
    addressId: { type: 'string' },
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['productId', 'subject', 'quantity', 'unitPrice'],
        properties: {
          productId: { type: 'string' },
          subject: { type: 'string' },
          quantity: decimalString,
          unitPrice: decimalString
        }
      }
    }
  }
};
document.components.schemas.TradeMutationResult = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'success'],
  properties: { id: { type: 'string' }, success: { type: 'boolean' } }
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
document.paths['/trade-orders'] = {
  get: {
    summary: 'List international trade orders',
    operationId: 'listTradeOrders',
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
      { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
      { name: 'status', in: 'query', schema: { type: 'string' } },
      { name: 'buyerLoginId', in: 'query', schema: { type: 'string' } },
      { name: 'createDateStart', in: 'query', schema: { type: 'string' } },
      { name: 'createDateEnd', in: 'query', schema: { type: 'string' } }
    ],
    responses: {
      '200': jsonResponse('Trade order page', { $ref: '#/components/schemas/TradeOrderPage' }),
      ...gatewayFailureResponses
    }
  },
  post: {
    summary: 'Create a trade assurance order',
    operationId: 'createTradeOrder',
    requestBody: jsonRequest({ $ref: '#/components/schemas/TradeOrderDraft' }),
    responses: {
      '200': jsonResponse('Created trade order', { $ref: '#/components/schemas/TradeMutationResult' }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/trade-orders/{orderId}'] = {
  get: {
    summary: 'Get an aggregate order detail without the Jushita-only API',
    operationId: 'getTradeOrderAggregate',
    parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      '200': jsonResponse('Aggregate trade order', {
        $ref: '#/components/schemas/TradeOrderAggregate'
      }),
      ...gatewayFailureResponses
    }
  },
  patch: {
    summary: 'Modify a trade assurance order',
    operationId: 'modifyTradeOrder',
    parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: jsonRequest({ $ref: '#/components/schemas/TradeOrderDraft' }),
    responses: {
      '200': jsonResponse('Modified trade order', {
        $ref: '#/components/schemas/TradeMutationResult'
      }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/trade-orders/{orderId}/fund'] = simpleOrderPath(
  'getTradeOrderFund',
  'TradeFund',
  'Get trade order fund information'
);
document.paths['/trade-orders/{orderId}/logistics'] = simpleOrderPath(
  'getTradeOrderLogistics',
  'TradeLogistics',
  'Get trade order logistics information'
);
document.paths['/trade-orders/{orderId}/tt-account'] = simpleOrderPath(
  'getTradeTtAccount',
  'TradeTtAccount',
  'Get trade order TT account'
);
document.paths['/trade-orders/{orderId}/service-charge'] = simpleOrderPath(
  'getTradeServiceCharge',
  'TradeServiceCharge',
  'Get trade service charge'
);
document.paths['/trade-fulfillment-channels'] = {
  get: {
    summary: 'List supported trade fulfillment channels',
    operationId: 'listTradeFulfillmentChannels',
    responses: {
      '200': jsonResponse('Fulfillment channels', {
        type: 'array',
        items: { $ref: '#/components/schemas/TradeFulfillmentChannel' }
      }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/trade-address-schema'] = {
  get: {
    summary: 'Get the declarative trade address form schema',
    operationId: 'getTradeAddressSchema',
    parameters: [
      { name: 'countryCode', in: 'query', required: true, schema: { type: 'string' } },
      { name: 'language', in: 'query', schema: { type: 'string', default: 'en_US' } }
    ],
    responses: {
      '200': jsonResponse('Trade address schema', {
        $ref: '#/components/schemas/TradeAddressSchema'
      }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/trade-addresses'] = {
  get: {
    summary: 'List trade addresses',
    operationId: 'listTradeAddresses',
    parameters: [
      { name: 'buyerEmail', in: 'query', required: true, schema: { type: 'string', format: 'email' } }
    ],
    responses: {
      '200': jsonResponse('Trade addresses', {
        type: 'array',
        items: { $ref: '#/components/schemas/TradeAddress' }
      }),
      ...gatewayFailureResponses
    }
  },
  post: {
    summary: 'Save a trade address form',
    operationId: 'saveTradeAddress',
    requestBody: jsonRequest({ $ref: '#/components/schemas/TradeAddress' }),
    responses: {
      '200': jsonResponse('Saved trade address', { $ref: '#/components/schemas/TradeAddress' }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/trade-addresses/{addressId}'] = {
  delete: {
    summary: 'Delete a trade address',
    operationId: 'deleteTradeAddress',
    parameters: [{ name: 'addressId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      '204': { description: 'Trade address deleted' },
      ...gatewayFailureResponses
    }
  }
};

function simpleOrderPath(operationId: string, schema: string, summary: string): Record<string, unknown> {
  return {
    get: {
      summary,
      operationId,
      parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': jsonResponse(summary, { $ref: `#/components/schemas/${schema}` }),
        ...gatewayFailureResponses
      }
    }
  };
}

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
const registry = `// Generated by scripts/generate-trade-contract.ts. Do not edit.\nimport type { components } from './api';\n\nexport interface TradeCapabilityRequestMap {\n${definitions
  .map(
    ([method, value]) =>
      `  '${method}': components['schemas']['${(value as { requestSchema: string }).requestSchema}'];`
  )
  .join('\n')}\n}\n\nexport interface TradeCapabilityResponseMap {\n${definitions
  .map(
    ([method, value]) =>
      `  '${method}': components['schemas']['${(value as { responseSchema: string }).responseSchema}'];`
  )
  .join(
    '\n'
  )}\n}\n\nexport const TRADE_CAPABILITY_DEFINITIONS = ${JSON.stringify(capabilityMap, null, 2)} as const;\n`;

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
    throw new Error('Generated trade contract is stale. Run pnpm generate:trade-contract.');
  }
} else {
  await Promise.all([
    writeFile(contractPath, contractOutput, 'utf8'),
    writeFile(registryPath, registry, 'utf8')
  ]);
}
