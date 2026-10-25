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
  '/alibaba/icbu/product/list/shipping/templates'
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
    if (path.endsWith('/product/get/v2')) {
      // Observed native IOP returns a JSON number for tiered_price[].price although
      // the public document says String. Preserve both representations, no rounding.
      let priceNode = response;
      for (const key of ['product_info', 'trade_info', 'price', 'tiered_price']) {
        const next = (priceNode.properties as Record<string, Schema>)[key];
        if (!next) throw new Error('Missing public product price schema: ' + key);
        priceNode = next;
      }
      const fields = (priceNode.items as Schema).properties as Record<string, Schema>;
      fields.price = { ...fields.price, type: ['string', 'number'] };
    }
    response.required = path.endsWith('/category/predict/v2') ? ['result'] : ['success'];
    if (path.endsWith('/category/predict/v2')) {
      const result = (response.properties as Record<string, Schema>).result;
      if (result) result.required = ['success', 'data'];
    } else {
      (response.required as string[]).push(
        path.endsWith('/product/get/v2')
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
      checkedAt: snapshot.checkedAt.slice(0, 10),
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
