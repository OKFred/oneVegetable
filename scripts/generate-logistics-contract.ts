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

interface LogisticsDefinition {
  method: string;
  source: 'catalog';
  sourceCategory: 'logistics' | 'product';
  docId: number;
  title: string;
  description: string;
  lifecycle: 'active' | 'deprecated' | 'unlisted';
  risk: 'read' | 'mutation';
  featureArea: 'address' | 'quote' | 'configuration' | 'order' | 'template' | 'buyer';
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
const registryPath = resolve(root, 'packages/core/src/generated/logistics-capabilities.ts');
const sourceContract = JSON.parse(await readFile(contractPath, 'utf8')) as OpenApiDocument;
const snapshot = JSON.parse(
  await readFile(resolve(root, 'docs/alibaba-logistics-api-docs.json'), 'utf8')
) as { definitions: LogisticsDefinition[] };
const overrides = JSON.parse(
  await readFile(resolve(root, 'config/alibaba-logistics-overrides.json'), 'utf8')
) as Record<string, { requestExample?: unknown; responseExample?: unknown }>;

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

function responseExample(definition: LogisticsDefinition): unknown {
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
  Object.entries(document.components.schemas).filter(
    ([name]) => !name.startsWith('AlibabaLogistics') && !name.startsWith('Logistics')
  )
);

const capabilityMap: Record<string, unknown> = {};
for (const definition of snapshot.definitions) {
  const baseName = schemaName(definition.method);
  const requestSchema = `AlibabaLogistics${baseName}Request`;
  const responseSchema = `AlibabaLogistics${baseName}Response`;
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
      overrides[definition.method]?.requestExample ??
      definition.requestExample ??
      Object.fromEntries(definition.requestParams.map((node) => [node.name, exampleValue(node)])),
    responseExample: responseExample(definition),
    docUrl: `https://developer.alibaba.com/docs/api.htm?apiId=${definition.docId}`
  };
}
document['x-logistics-capabilities'] = capabilityMap;

const decimalString = { type: 'string', pattern: '^\\d+(?:\\.\\d+)?$' };
const nullableString = { type: ['string', 'null'] };
document.components.schemas.LogisticsAddressNode = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'code', 'name', 'level'],
  properties: {
    id: { type: 'string' },
    code: { type: 'string' },
    name: { type: 'string' },
    level: { type: 'string', enum: ['province', 'city', 'division', 'street'] }
  }
};
document.components.schemas.LogisticsSpecialProductType = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'name', 'children'],
  properties: {
    code: { type: 'string' },
    name: { type: 'string' },
    children: {
      type: 'array',
      items: { $ref: '#/components/schemas/LogisticsSpecialProductType' }
    }
  }
};
document.components.schemas.LogisticsProduct = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'name', 'warehouseCode', 'enabled', 'unavailableReason'],
  properties: {
    code: { type: 'string' },
    name: { type: 'string' },
    warehouseCode: nullableString,
    enabled: { type: 'boolean' },
    unavailableReason: nullableString
  }
};
document.components.schemas.LogisticsContact = {
  type: 'object',
  additionalProperties: false,
  required: ['contactPerson', 'mobileNo', 'email', 'companyName'],
  properties: {
    contactPerson: { type: 'string', minLength: 1 },
    mobileNo: { type: 'string', minLength: 1 },
    email: nullableString,
    companyName: nullableString
  }
};
document.components.schemas.LogisticsAddress = {
  type: 'object',
  additionalProperties: false,
  required: [
    'countryCode',
    'provinceCode',
    'cityCode',
    'divisionCode',
    'streetCode',
    'address1',
    'address2',
    'zipCode',
    'contact'
  ],
  properties: {
    countryCode: { type: 'string', minLength: 2 },
    provinceCode: nullableString,
    cityCode: nullableString,
    divisionCode: nullableString,
    streetCode: nullableString,
    address1: { type: 'string', minLength: 1 },
    address2: nullableString,
    zipCode: { type: 'string', minLength: 1 },
    contact: { $ref: '#/components/schemas/LogisticsContact' }
  }
};
document.components.schemas.LogisticsCargo = {
  type: 'object',
  additionalProperties: false,
  required: [
    'nameCn',
    'nameEn',
    'hsCode',
    'quantity',
    'unit',
    'declarationValue',
    'currency',
    'purpose',
    'material',
    'productTypeCodes'
  ],
  properties: {
    nameCn: { type: 'string', minLength: 1 },
    nameEn: { type: 'string', minLength: 1 },
    hsCode: { type: 'string', minLength: 6 },
    quantity: decimalString,
    unit: { type: 'string', minLength: 1 },
    declarationValue: decimalString,
    currency: { type: 'string', minLength: 3 },
    purpose: { type: 'string', minLength: 1 },
    material: { type: 'string', minLength: 1 },
    productTypeCodes: { type: 'array', items: { type: 'string' } }
  }
};
document.components.schemas.LogisticsPackage = {
  type: 'object',
  additionalProperties: false,
  required: ['quantity', 'lengthCm', 'widthCm', 'heightCm', 'weightKg', 'type'],
  properties: {
    quantity: decimalString,
    lengthCm: decimalString,
    widthCm: decimalString,
    heightCm: decimalString,
    weightKg: decimalString,
    type: { type: 'string', minLength: 1 }
  }
};
document.components.schemas.LogisticsCustoms = {
  type: 'object',
  additionalProperties: false,
  required: [
    'declarationAmount',
    'declarationCurrency',
    'needCustomsClearance',
    'vatType',
    'vatNumber',
    'taxpayerId',
    'eoriNumber'
  ],
  properties: {
    declarationAmount: decimalString,
    declarationCurrency: { type: 'string', minLength: 3 },
    needCustomsClearance: { type: 'boolean' },
    vatType: nullableString,
    vatNumber: nullableString,
    taxpayerId: nullableString,
    eoriNumber: nullableString
  }
};
document.components.schemas.LogisticsQuoteRequest = {
  type: 'object',
  additionalProperties: false,
  required: [
    'originZipCode',
    'destinationCountryCode',
    'destinationZipCode',
    'warehouseCode',
    'productCode',
    'cargo',
    'packages',
    'consignor',
    'consignee',
    'customs',
    'needPickup',
    'supplyChainBizId',
    'tradeBizId',
    'tradePlatform'
  ],
  properties: {
    originZipCode: { type: 'string', minLength: 1 },
    destinationCountryCode: { type: 'string', minLength: 2 },
    destinationZipCode: { type: 'string', minLength: 1 },
    warehouseCode: { type: 'string', minLength: 1 },
    productCode: { type: 'string', minLength: 1 },
    cargo: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/LogisticsCargo' } },
    packages: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/components/schemas/LogisticsPackage' }
    },
    consignor: { $ref: '#/components/schemas/LogisticsAddress' },
    consignee: { $ref: '#/components/schemas/LogisticsAddress' },
    customs: { $ref: '#/components/schemas/LogisticsCustoms' },
    needPickup: { type: 'boolean' },
    supplyChainBizId: { type: 'string', minLength: 1 },
    tradeBizId: nullableString,
    tradePlatform: { type: 'string', default: 'ICBU' }
  }
};
document.components.schemas.LogisticsQuoteOption = {
  type: 'object',
  additionalProperties: false,
  required: [
    'productCode',
    'productName',
    'totalAmount',
    'currency',
    'estimatedDays',
    'warehouseCode',
    'available',
    'unavailableReason'
  ],
  properties: {
    productCode: { type: 'string' },
    productName: { type: 'string' },
    totalAmount: decimalString,
    currency: { type: 'string' },
    estimatedDays: nullableString,
    warehouseCode: nullableString,
    available: { type: 'boolean' },
    unavailableReason: nullableString
  }
};
document.components.schemas.LogisticsQuoteResult = {
  type: 'object',
  additionalProperties: false,
  required: ['options', 'issues'],
  properties: {
    options: { type: 'array', items: { $ref: '#/components/schemas/LogisticsQuoteOption' } },
    issues: { type: 'array', items: { type: 'string' } }
  }
};
document.components.schemas.LogisticsOrderDraft = {
  type: 'object',
  additionalProperties: false,
  required: ['quoteRequest', 'confirmedProductCode'],
  properties: {
    quoteRequest: { $ref: '#/components/schemas/LogisticsQuoteRequest' },
    confirmedProductCode: { type: 'string', minLength: 1 }
  }
};
document.components.schemas.LogisticsOrderSummary = {
  type: 'object',
  additionalProperties: false,
  required: ['orderNumber', 'status', 'freightAmount', 'currency', 'placedAt'],
  properties: {
    orderNumber: { type: 'string' },
    status: { type: 'string' },
    freightAmount: decimalString,
    currency: { type: 'string' },
    placedAt: { type: ['string', 'null'], format: 'date-time' }
  }
};
document.components.schemas.LogisticsOrderPage = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'page', 'pageSize', 'total'],
  properties: {
    items: { type: 'array', items: { $ref: '#/components/schemas/LogisticsOrderSummary' } },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    total: { type: 'integer', minimum: 0 }
  }
};
document.components.schemas.LogisticsOrderDetail = {
  type: 'object',
  additionalProperties: false,
  required: ['order', 'warehouseName', 'warehouseAddress', 'labelUrl', 'labelBase64', 'trackingNumber'],
  properties: {
    order: { $ref: '#/components/schemas/LogisticsOrderSummary' },
    warehouseName: nullableString,
    warehouseAddress: nullableString,
    labelUrl: { type: ['string', 'null'], format: 'uri', pattern: '^https://' },
    labelBase64: nullableString,
    trackingNumber: nullableString
  }
};
document.components.schemas.LogisticsOrderMutationResult = {
  type: 'object',
  additionalProperties: false,
  required: ['orderNumber', 'success'],
  properties: { orderNumber: { type: 'string' }, success: { type: 'boolean' } }
};
document.components.schemas.ShippingTemplate = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name'],
  properties: { id: { type: 'string' }, name: { type: 'string' } }
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
document.paths['/logistics/address-nodes'] = {
  get: {
    summary: 'List logistics address nodes',
    operationId: 'listLogisticsAddressNodes',
    parameters: [
      { name: 'level', in: 'query', required: true, schema: { type: 'string' } },
      { name: 'parentId', in: 'query', schema: { type: 'string' } },
      { name: 'countryCode', in: 'query', schema: { type: 'string' } },
      { name: 'searchText', in: 'query', schema: { type: 'string' } }
    ],
    responses: {
      '200': jsonResponse('Address nodes', {
        type: 'array',
        items: { $ref: '#/components/schemas/LogisticsAddressNode' }
      }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/logistics/special-product-types'] = {
  get: {
    summary: 'List special product type configuration',
    operationId: 'listLogisticsSpecialProductTypes',
    responses: {
      '200': jsonResponse('Special product types', {
        type: 'array',
        items: { $ref: '#/components/schemas/LogisticsSpecialProductType' }
      }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/logistics/products'] = {
  get: {
    summary: 'List logistics products',
    operationId: 'listLogisticsProducts',
    responses: {
      '200': jsonResponse('Logistics products', {
        type: 'array',
        items: { $ref: '#/components/schemas/LogisticsProduct' }
      }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/logistics/quotes'] = {
  post: {
    summary: 'Calculate a logistics quote and validate order parameters',
    operationId: 'calculateLogisticsQuote',
    requestBody: jsonRequest({ $ref: '#/components/schemas/LogisticsQuoteRequest' }),
    responses: {
      '200': jsonResponse('Logistics quote result', {
        $ref: '#/components/schemas/LogisticsQuoteResult'
      }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/logistics/orders'] = {
  get: {
    summary: 'List logistics orders',
    operationId: 'listLogisticsOrders',
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
      { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
      { name: 'orderNumber', in: 'query', schema: { type: 'string' } }
    ],
    responses: {
      '200': jsonResponse('Logistics order page', {
        $ref: '#/components/schemas/LogisticsOrderPage'
      }),
      ...gatewayFailureResponses
    }
  },
  post: {
    summary: 'Create a logistics order',
    operationId: 'createLogisticsOrder',
    requestBody: jsonRequest({ $ref: '#/components/schemas/LogisticsOrderDraft' }),
    responses: {
      '200': jsonResponse('Created logistics order', {
        $ref: '#/components/schemas/LogisticsOrderMutationResult'
      }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/logistics/orders/{orderNumber}'] = {
  get: {
    summary: 'Get logistics order detail, label and warehouse data',
    operationId: 'getLogisticsOrder',
    parameters: [{ name: 'orderNumber', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      '200': jsonResponse('Logistics order detail', {
        $ref: '#/components/schemas/LogisticsOrderDetail'
      }),
      ...gatewayFailureResponses
    }
  }
};
document.paths['/logistics/shipping-templates'] = {
  get: {
    summary: 'List international shipping templates',
    operationId: 'listShippingTemplates',
    responses: {
      '200': jsonResponse('Shipping templates', {
        type: 'array',
        items: { $ref: '#/components/schemas/ShippingTemplate' }
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
  'x-insights-capabilities'
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
const registry = `// Generated by scripts/generate-logistics-contract.ts. Do not edit.\nimport type { components } from './api';\n\nexport interface LogisticsCapabilityRequestMap {\n${definitions
  .map(
    ([method, value]) =>
      `  '${method}': components['schemas']['${(value as { requestSchema: string }).requestSchema}'];`
  )
  .join('\n')}\n}\n\nexport interface LogisticsCapabilityResponseMap {\n${definitions
  .map(
    ([method, value]) =>
      `  '${method}': components['schemas']['${(value as { responseSchema: string }).responseSchema}'];`
  )
  .join(
    '\n'
  )}\n}\n\nexport const LOGISTICS_CAPABILITY_DEFINITIONS = ${JSON.stringify(capabilityMap, null, 2)} as const;\n`;

document.components.schemas = Object.fromEntries(
  Object.entries(document.components.schemas).sort(([left], [right]) => left.localeCompare(right))
);
const prettierJsonOptions = { parser: 'json', printWidth: 110, endOfLine: 'lf' } as const;
const contractOutput = await format(JSON.stringify(document), prettierJsonOptions);
if (process.argv.includes('--check')) {
  const currentRegistry = await readFile(registryPath, 'utf8');
  const currentContractOutput = await format(JSON.stringify(sourceContract), prettierJsonOptions);
  if (contractOutput !== currentContractOutput || currentRegistry !== registry) {
    throw new Error('Generated logistics contract is stale. Run pnpm generate:logistics-contract.');
  }
} else {
  await Promise.all([
    writeFile(contractPath, contractOutput, 'utf8'),
    writeFile(registryPath, registry, 'utf8')
  ]);
}
