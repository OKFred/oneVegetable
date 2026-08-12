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

interface ProductDefinition {
  method: string;
  source: 'catalog' | 'article';
  docId?: number;
  articleId?: number;
  title: string;
  description: string;
  lifecycle: 'active' | 'deprecated' | 'unlisted';
  risk: 'read' | 'mutation';
  checkedAt: string;
  updatedAt: string | null;
  requestParams: ParamNode[];
  responseParams: ParamNode[];
  errorCodes: unknown[];
  responseExample: string | null;
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
const registryPath = resolve(root, 'packages/core/src/generated/product-capabilities.ts');
const sourceContract = JSON.parse(await readFile(contractPath, 'utf8')) as OpenApiDocument;
const snapshot = JSON.parse(await readFile(resolve(root, 'docs/alibaba-product-api-docs.json'), 'utf8')) as {
  definitions: ProductDefinition[];
};

function schemaName(method: string): string {
  return method
    .split('.')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');
}

function scalarType(rawType: string): JsonSchema {
  const normalized = rawType.replaceAll(' ', '').replace(/\[\]$/, '').toLowerCase();
  if (normalized === 'number' || normalized === 'long' || normalized === 'integer') {
    return { type: 'number' };
  }
  if (normalized === 'boolean') return { type: 'boolean' };
  if (normalized === 'date') return { type: ['integer', 'string'] };
  if (normalized === 'json' || normalized === 'object' || normalized === 'map') {
    return { type: 'object', additionalProperties: true };
  }
  return { type: 'string' };
}

function nodeSchema(node: ParamNode): JsonSchema {
  const isArray = /\[\]\s*$/.test(node.type);
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

function exampleValue(node: ParamNode): unknown {
  if ((node.subParams?.length ?? 0) > 0) {
    const value = Object.fromEntries(
      (node.subParams ?? []).map((child) => [child.name, exampleValue(child)])
    );
    return /\[\]\s*$/.test(node.type) ? [value] : value;
  }
  const demo = node.demoValue ?? node.defaultValue;
  if (/\[\]\s*$/.test(node.type)) {
    if (demo === undefined) return node.required ? [defaultScalarExample(node.type)] : [];
    try {
      const parsed: unknown = JSON.parse(demo.replaceAll('“', '"').replaceAll('”', '"'));
      return Array.isArray(parsed) ? parsed : [scalarExample(node.type, demo)];
    } catch {
      const values = demo.split(',').map((value) => value.trim());
      return values.map((value) => scalarExample(node.type, value));
    }
  }
  if (demo === undefined) return defaultScalarExample(node.type);
  return scalarExample(node.type, demo);
}

function defaultScalarExample(type: string): unknown {
  const normalized = type.replaceAll(' ', '').replace(/\[\]$/, '').toLowerCase();
  if (normalized === 'number' || normalized === 'long' || normalized === 'integer') return 123;
  if (normalized === 'boolean') return false;
  if (normalized === 'json' || normalized === 'object' || normalized === 'map') return {};
  return 'demo';
}

function scalarExample(rawType: string, demo: string): unknown {
  const type = rawType.replaceAll(' ', '').replace(/\[\]$/, '').toLowerCase();
  if (type === 'number' || type === 'long' || type === 'integer') {
    const numeric = Number(demo);
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

function responseExample(definition: ProductDefinition): unknown {
  if (!definition.responseExample) {
    return Object.fromEntries(definition.responseParams.map((node) => [node.name, exampleValue(node)]));
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
  Object.entries(document.components.schemas).filter(([name]) => !name.startsWith('AlibabaProduct'))
);

const capabilityMap: Record<string, unknown> = {};
for (const definition of snapshot.definitions) {
  const baseName = schemaName(definition.method);
  const requestSchema = `AlibabaProduct${baseName}Request`;
  const responseSchema = `AlibabaProduct${baseName}Response`;
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
    requestExample: Object.fromEntries(
      definition.requestParams.map((node) => [node.name, exampleValue(node)])
    ),
    responseExample: responseExample(definition),
    docUrl:
      definition.source === 'catalog'
        ? `https://developer.alibaba.com/docs/api.htm?apiId=${definition.docId ?? ''}`
        : `https://developer.alibaba.com/docs/doc.htm?articleId=${definition.articleId ?? ''}&docType=1`
  };
}
document['x-product-capabilities'] = capabilityMap;

const apiCapability = document.components.schemas.ApiCapability;
apiCapability.required = [
  ...((apiCapability.required as string[] | undefined) ?? []),
  'source',
  'lifecycle',
  'risk',
  'verification',
  'realCallEnabled'
].filter((value, index, values) => values.indexOf(value) === index);
const apiProperties = apiCapability.properties as Record<string, JsonSchema>;
apiProperties.source = { type: 'string', enum: ['catalog', 'article'] };
apiProperties.lifecycle = { type: 'string', enum: ['active', 'deprecated', 'unlisted'] };
apiProperties.risk = { type: 'string', enum: ['read', 'mutation'] };
apiProperties.verification = { type: 'string', enum: ['documented', 'account-verified'] };
apiProperties.realCallEnabled = { type: 'boolean' };
apiProperties.requestSchema = { type: ['string', 'null'] };
apiProperties.responseSchema = { type: ['string', 'null'] };

document.components.schemas.CapabilityContractIssue = {
  type: 'object',
  additionalProperties: false,
  required: ['instancePath', 'keyword', 'message'],
  properties: {
    instancePath: { type: 'string' },
    keyword: { type: 'string' },
    message: { type: 'string' }
  }
};
document.components.schemas.CapabilityResponseEnvelope = {
  type: 'object',
  additionalProperties: false,
  required: ['method', 'traceId', 'data', 'contractValid', 'contractIssues'],
  properties: {
    method: { type: 'string' },
    traceId: { type: 'string' },
    data: {},
    contractValid: { type: 'boolean' },
    contractIssues: {
      type: 'array',
      items: { $ref: '#/components/schemas/CapabilityContractIssue' }
    }
  }
};
document.components.schemas.CapabilityCallResult = {
  $ref: '#/components/schemas/CapabilityResponseEnvelope'
};
document.components.schemas.CapabilityDefinition = {
  type: 'object',
  additionalProperties: false,
  required: [
    'method',
    'title',
    'description',
    'source',
    'lifecycle',
    'risk',
    'verification',
    'realCallEnabled',
    'requestSchema',
    'responseSchema',
    'requestExample',
    'responseExample',
    'errorCodes',
    'checkedAt',
    'docUrl'
  ],
  properties: {
    method: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    source: { type: 'string', enum: ['catalog', 'article'] },
    lifecycle: { type: 'string', enum: ['active', 'deprecated', 'unlisted'] },
    risk: { type: 'string', enum: ['read', 'mutation'] },
    verification: { type: 'string', enum: ['documented', 'account-verified'] },
    realCallEnabled: { type: 'boolean' },
    restricted: { type: 'boolean' },
    restrictionReason: { type: ['string', 'null'] },
    featureArea: { type: 'string' },
    requestSchema: { type: 'string' },
    responseSchema: { type: 'string' },
    requestExample: { type: 'object', additionalProperties: true },
    responseExample: {},
    errorCodes: { type: 'array', items: { type: 'object', additionalProperties: true } },
    checkedAt: { type: 'string', format: 'date' },
    updatedAt: { type: ['string', 'null'], format: 'date' },
    docUrl: { type: 'string', format: 'uri' }
  }
};

document.components.schemas.ProductCategory = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'leaf', 'children'],
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    leaf: { type: 'boolean' },
    children: { type: 'array', items: { $ref: '#/components/schemas/ProductCategory' } }
  }
};
document.components.schemas.ProductCategoryMapping = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceCategoryId', 'targetCategoryId'],
  properties: {
    sourceCategoryId: { type: 'number' },
    targetCategoryId: { type: 'number' }
  }
};
document.components.schemas.ProductGroup = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'children'],
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    children: { type: 'array', items: { $ref: '#/components/schemas/ProductGroup' } }
  }
};
document.components.schemas.ProductScore = {
  type: 'object',
  additionalProperties: false,
  required: ['productId', 'score', 'issues'],
  properties: {
    productId: { type: 'string' },
    score: { type: 'number' },
    issues: { type: 'array', items: { type: 'string' } },
    qualityIssues: {
      type: 'array',
      items: { $ref: '#/components/schemas/ProductDescriptionQualityIssue' },
      description:
        'Optional normalized official issues when the upstream response provides structured details.'
    }
  }
};

const gatewayFailureResponses = {
  '4XX': { $ref: '#/components/responses/GatewayFailure' },
  default: { $ref: '#/components/responses/GatewayFailure' }
};
document.paths['/product-categories'] = {
  get: {
    summary: 'List modern product categories',
    operationId: 'listProductCategories',
    parameters: [{ name: 'parentId', in: 'query', schema: { type: 'number' } }],
    responses: {
      '200': {
        description: 'Product category tree',
        content: {
          'application/json': {
            schema: { type: 'array', items: { $ref: '#/components/schemas/ProductCategory' } }
          }
        }
      },
      ...gatewayFailureResponses
    }
  }
};
document.paths['/product-categories/mapping'] = {
  post: {
    summary: 'Map a legacy category to the modern category system',
    operationId: 'mapProductCategory',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['categoryId'],
            properties: { categoryId: { type: 'number' } }
          }
        }
      }
    },
    responses: {
      '200': {
        description: 'Mapped category',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ProductCategoryMapping' } }
        }
      },
      ...gatewayFailureResponses
    }
  }
};
document.paths['/product-groups'] = {
  get: {
    summary: 'List product groups',
    operationId: 'listProductGroups',
    responses: {
      '200': {
        description: 'Product groups',
        content: {
          'application/json': {
            schema: { type: 'array', items: { $ref: '#/components/schemas/ProductGroup' } }
          }
        }
      },
      ...gatewayFailureResponses
    }
  },
  post: {
    summary: 'Create a product group',
    operationId: 'createProductGroup',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['name'],
            properties: { name: { type: 'string' }, parentId: { type: 'number' } }
          }
        }
      }
    },
    responses: {
      '201': {
        description: 'Created product group',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ProductGroup' } }
        }
      },
      ...gatewayFailureResponses
    }
  }
};
document.paths['/products/{productId}/score'] = {
  get: {
    summary: 'Get product quality score',
    operationId: 'getProductScore',
    parameters: [{ name: 'productId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      '200': {
        description: 'Product score',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ProductScore' } }
        }
      },
      ...gatewayFailureResponses
    }
  }
};

const definitions = Object.entries(capabilityMap);
const additionalDefinitions = ['x-rfq-capabilities', 'x-trade-capabilities'].flatMap((extension) =>
  Object.entries(
    (document[extension] ?? {}) as Record<string, { requestSchema: string; responseSchema: string }>
  )
);
const allDefinitions = [...definitions, ...additionalDefinitions];
const requestRefs = allDefinitions.map(([, value]) => ({
  $ref: `#/components/schemas/${(value as { requestSchema: string }).requestSchema}`
}));
const responseRefs = allDefinitions.map(([, value]) => ({
  $ref: `#/components/schemas/${(value as { responseSchema: string }).responseSchema}`
}));
const capabilityCallRequest = document.components.schemas.CapabilityCallRequest;
const capabilityRequestProperties = capabilityCallRequest.properties as Record<string, JsonSchema>;
// The runtime registry selects the strict request schema by method. Keeping the
// transport envelope generic avoids an ambiguous oneOf for structurally equal
// empty-object request schemas while CapabilityRequestMap preserves correlation.
capabilityRequestProperties.parameters = { type: 'object', additionalProperties: true };
const envelopeProperties = document.components.schemas.CapabilityResponseEnvelope.properties as Record<
  string,
  JsonSchema
>;
envelopeProperties.data = { oneOf: responseRefs };
document.paths['/capabilities/{method}'] = {
  get: {
    summary: 'Get a typed capability definition',
    operationId: 'getCapabilityDefinition',
    parameters: [
      {
        name: 'method',
        in: 'path',
        required: true,
        schema: { type: 'string' }
      }
    ],
    responses: {
      '200': {
        description: 'Capability definition',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/CapabilityDefinition' } }
        }
      },
      '4XX': { $ref: '#/components/responses/GatewayFailure' },
      default: { $ref: '#/components/responses/GatewayFailure' }
    }
  },
  post: {
    summary: 'Call a method-typed capability',
    operationId: 'callTypedCapability',
    parameters: [
      {
        name: 'method',
        in: 'path',
        required: true,
        schema: { type: 'string' }
      }
    ],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { oneOf: requestRefs } } }
    },
    responses: {
      '200': {
        description: 'Capability response envelope',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/CapabilityResponseEnvelope' } }
        }
      },
      '4XX': { $ref: '#/components/responses/GatewayFailure' },
      default: { $ref: '#/components/responses/GatewayFailure' }
    }
  }
};

const registry = `// Generated by scripts/generate-product-contract.ts. Do not edit.\nimport type { components } from './api';\n\nexport interface ProductCapabilityRequestMap {\n${definitions
  .map(
    ([method, value]) =>
      `  '${method}': components['schemas']['${(value as { requestSchema: string }).requestSchema}'];`
  )
  .join('\n')}\n}\n\nexport interface ProductCapabilityResponseMap {\n${definitions
  .map(
    ([method, value]) =>
      `  '${method}': components['schemas']['${(value as { responseSchema: string }).responseSchema}'];`
  )
  .join(
    '\n'
  )}\n}\n\nexport const PRODUCT_CAPABILITY_DEFINITIONS = ${JSON.stringify(capabilityMap, null, 2)} as const;\n`;

document.components.schemas = Object.fromEntries(
  Object.entries(document.components.schemas).sort(([left], [right]) => left.localeCompare(right))
);

const prettierJsonOptions = { parser: 'json', printWidth: 110, endOfLine: 'lf' } as const;
const contractOutput = await format(JSON.stringify(document), prettierJsonOptions);
if (process.argv.includes('--check')) {
  const currentRegistry = await readFile(registryPath, 'utf8');
  const currentContractOutput = await format(JSON.stringify(sourceContract), prettierJsonOptions);
  if (contractOutput !== currentContractOutput || currentRegistry !== registry) {
    throw new Error('Generated product contract is stale. Run pnpm generate:product-contract.');
  }
} else {
  await Promise.all([
    writeFile(contractPath, contractOutput, 'utf8'),
    writeFile(registryPath, registry, 'utf8')
  ]);
}
