import type { IopBusinessPath } from '../../packages/core/src/alibaba-iop-registry';

interface Parameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
  children?: Parameter[];
}
interface Document {
  path: string;
  title: string;
  description: string;
  documentUrl: string;
  updatedAt: string;
  checkedAt?: string;
  chargeable: boolean;
  authorizationType: number | null;
  request: Parameter[];
  response: Parameter[];
}
type Schema = Record<string, unknown>;

export const referencePaths = [
  '/alibaba/icbu/category/predict/v2',
  '/alibaba/icbu/category/get/v2',
  '/alibaba/icbu/category/attribute/get/v2',
  '/alibaba/icbu/product/get/v2',
  '/alibaba/icbu/product/list/shipping/templates',
  '/alibaba/icbu/product/search/v2'
] as const satisfies readonly IopBusinessPath[];

function parameter(node: Parameter): Schema {
  const array = node.type.endsWith('[]');
  const base = node.type.replace(/\[\]$/u, '').toLowerCase();
  let schema: Schema = node.children?.length
    ? object(node.children, false)
    : base === 'boolean'
      ? { type: 'boolean' }
      : base === 'number'
        ? { type: 'number' }
        : base === 'object'
          ? { type: 'object', additionalProperties: true }
          : { type: 'string' };
  // Public IOP identifiers use both Number and String. Never coerce an unsafe JS number.
  if (/(?:^|_)id$/u.test(node.name) && !array)
    schema = {
      anyOf: [
        { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        { type: 'string', pattern: '^[1-9][0-9]*$' }
      ]
    };
  if (node.name === 'leaf_category') schema = { anyOf: [{ type: 'boolean' }, { enum: ['true', 'false'] }] };
  return {
    ...(array ? { type: 'array', items: schema } : schema),
    ...(node.description ? { description: node.description } : {})
  };
}
function object(nodes: Parameter[], request: boolean): Schema {
  return {
    type: 'object',
    additionalProperties: !request,
    properties: Object.fromEntries(nodes.map((node) => [node.name, parameter(node)])),
    ...(request ? { required: nodes.filter((node) => node.required).map((node) => node.name) } : {})
  };
}

/** Explicit response paths only: retain native numbers and documented strings without coercion. */
function allowObservedStringOrNumber(response: Schema, path: readonly string[]): void {
  let node = response;
  for (const key of path) {
    const next = key === '*' ? node.items : (node.properties as Record<string, Schema> | undefined)?.[key];
    if (typeof next !== 'object' || next === null || Array.isArray(next))
      throw new Error('Missing public product response schema: ' + path.join('/'));
    node = next as Schema;
  }
  node.type = ['string', 'number'];
}

/** Separate native IOP contracts; never advertise these paths as TOP methods. */
export function buildIopReferenceContracts(
  snapshot: { checkedAt: string; documents: Document[] },
  examples: Record<string, { request: unknown; response: unknown }>
): { schemas: Record<string, Schema>; definitions: Record<string, unknown> } {
  const schemas: Record<string, Schema> = {};
  const definitions: Record<string, unknown> = {};
  referencePaths.forEach((path, index) => {
    const doc = snapshot.documents.find((candidate) => candidate.path === path);
    const example = examples[path];
    if (!doc || doc.chargeable || !example)
      throw new Error('Missing free public IOP reference definition/example: ' + path);
    const requestSchema = 'AlibabaProductIopReference' + String(index) + 'Request';
    const responseSchema = 'AlibabaProductIopReference' + String(index) + 'Response';
    const request = object(doc.request, true);
    if (path.endsWith('/product/search/v2')) {
      const properties = request.properties as Record<string, Schema>;
      for (const name of ['model_number', 'sku_code'])
        properties[name] = { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' };
      properties.page_index = { type: 'integer', minimum: 1, maximum: 1000000 };
      properties.page_size = { type: 'integer', minimum: 1, maximum: 20 };
      request.oneOf = [
        {
          required: ['model_number'],
          properties: { model_number: properties.model_number },
          not: { properties: { sku_code: properties.sku_code }, required: ['sku_code'] }
        },
        {
          required: ['sku_code'],
          properties: { sku_code: properties.sku_code },
          not: { properties: { model_number: properties.model_number }, required: ['model_number'] }
        }
      ];
    }
    if (path.endsWith('/product/get/v2')) {
      const properties = request.properties as Record<string, Schema>;
      request.anyOf = [
        { required: ['product_id'], properties: { product_id: properties.product_id } },
        { required: ['sku_id'], properties: { sku_id: properties.sku_id } }
      ];
    }
    if (path.endsWith('/category/predict/v2')) {
      (request.properties as Record<string, Schema>).title = { type: 'string', minLength: 1 };
      (request.properties as Record<string, Schema>).image = {
        type: 'string',
        pattern: '^https://'
      };
    }
    // Actual successful IOP responses omit message/msg_code. Success and payload remain mandatory.
    const response = object(doc.response, false);
    if (path.endsWith('/product/get/v2') || path.endsWith('/product/search/v2')) {
      const productPath = path.endsWith('/product/search/v2') ? ['product_info', '*'] : ['product_info'];
      // Both native reads return numeric tier prices despite the documented String.
      allowObservedStringOrNumber(response, [
        ...productPath,
        'trade_info',
        'price',
        'tiered_price',
        '*',
        'price'
      ]);
      if (path.endsWith('/product/search/v2')) {
        // Search documents String, while get/v2 documents Number for this same scalar.
        // The search-only safe shape receipt confirms Number; no other field is widened.
        allowObservedStringOrNumber(response, [
          ...productPath,
          'logistics_info',
          'tiered_lead_time',
          '*',
          'lead_time'
        ]);
      }
    }
    response.required = path.endsWith('/category/predict/v2')
      ? ['result']
      : path.endsWith('/product/search/v2')
        ? ['success', 'page']
        : ['success'];
    if (path.endsWith('/category/predict/v2')) {
      const result = (response.properties as Record<string, Schema>).result;
      if (result) result.required = ['success', 'data'];
    } else {
      (response.required as string[]).push(
        path.endsWith('/product/get/v2') || path.endsWith('/product/search/v2')
          ? 'product_info'
          : path.endsWith('/shipping/templates')
            ? 'template_info_list'
            : 'data'
      );
    }
    schemas[requestSchema] = { ...request, title: path + ' request' };
    schemas[responseSchema] = { ...response, title: path + ' response' };
    definitions[path] = {
      requestSchema,
      responseSchema,
      source: 'catalog',
      lifecycle: 'active',
      risk: 'read',
      verification: 'documented',
      realCallEnabled: true,
      checkedAt: (doc.checkedAt ?? snapshot.checkedAt).slice(0, 10),
      updatedAt: doc.updatedAt.slice(0, 10) || null,
      title: doc.title,
      description: doc.description,
      errorCodes: [],
      requestExample: example.request,
      responseExample: example.response,
      docUrl: doc.documentUrl
    };
  });
  return { schemas, definitions };
}
