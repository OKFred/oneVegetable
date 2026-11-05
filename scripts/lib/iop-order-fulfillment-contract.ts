import {
  FULFILLMENT_READ_METHODS,
  ORDER_ATTACHMENT_METHOD
} from '../../packages/core/src/order-fulfillment-methods';

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
  errors: unknown[];
}
type Schema = Record<string, unknown>;
export const fulfillmentPaths = [...Object.values(FULFILLMENT_READ_METHODS), ORDER_ATTACHMENT_METHOD];
const integer = (minimum: number): Schema => ({
  anyOf: [
    { type: 'integer', minimum, maximum: Number.MAX_SAFE_INTEGER },
    { type: 'string', pattern: minimum ? '^[1-9][0-9]*$' : '^(0|[1-9][0-9]*)$' }
  ]
});
function object(nodes: Parameter[], request: boolean): Schema {
  return {
    type: 'object',
    properties: Object.fromEntries(nodes.map((node) => [node.name, parameter(node, request)])),
    required: nodes.filter((node) => node.required).map((node) => node.name),
    additionalProperties: !request
  };
}
function parameter(node: Parameter, request: boolean): Schema {
  let schema: Schema;
  if (node.type === 'byte[]') {
    schema = { type: 'array', minItems: 1, items: { type: 'integer', minimum: 0, maximum: 255 } };
  } else if (node.type === 'Object[]') {
    schema = {
      type: 'array',
      ...(request ? { minItems: 1 } : {}),
      items: object(node.children ?? [], request)
    };
  } else if (node.type === 'Object') {
    schema = object(node.children ?? [], request);
  } else if (node.type === 'Number') {
    schema = integer(request || ['warehouse_id', 'current_page', 'page_size'].includes(node.name) ? 1 : 0);
  } else if (node.type === 'Boolean') {
    schema = { type: 'boolean' };
  } else if (node.type === 'String') {
    schema = {
      type: 'string',
      ...(request ? { minLength: 1, pattern: '^(?=.*\\S)[^\\u0000-\\u001f\\u007f]+$' } : {})
    };
  } else {
    throw new Error('Unsupported fulfillment document type: ' + node.type);
  }
  return { ...schema, description: node.description };
}

/** Offline contracts only. The main generator owns registration, exports and generated validators. */
export function buildIopOrderFulfillmentContracts(
  snapshot: { checkedAt: string; documents: Document[] },
  examples: Record<string, { request: unknown; response: unknown }>
): { schemas: Record<string, Schema>; definitions: Record<string, unknown> } {
  const schemas: Record<string, Schema> = {};
  const definitions: Record<string, unknown> = {};
  fulfillmentPaths.forEach((path, index) => {
    const doc = snapshot.documents.find((candidate) => candidate.path === path);
    const example = examples[path];
    if (!doc || !example) throw new Error('Missing free public fulfillment document/example: ' + path);
    if ((doc.chargeable as unknown) !== false)
      throw new Error('Fulfillment document is not explicitly free: ' + path);
    const upload = path === ORDER_ATTACHMENT_METHOD;
    const output = doc.response[0];
    if (
      upload &&
      (doc.response.length !== 1 ||
        output?.name !== 'value' ||
        output.type !== 'String' ||
        (output.required as unknown) !== true)
    )
      throw new Error('Attachment output tree changed; review the public documentation');
    const requestSchema = 'AlibabaTradeIopFulfillment' + String(index) + 'Request';
    const responseSchema = 'AlibabaTradeIopFulfillment' + String(index) + 'Response';
    const response = object(doc.response, false);
    const properties = response.properties as Record<string, Schema>;
    properties.code = {
      anyOf: [
        { type: 'string', minLength: 1 },
        { type: 'integer', maximum: Number.MAX_SAFE_INTEGER }
      ],
      description:
        'IOP transport/business envelope code; only 0 is transport success, not proof of payload success.'
    };
    properties.request_id = { type: 'string' };
    (response.required as string[]).push('code');
    if (upload)
      properties.value = {
        type: 'string',
        minLength: 1,
        pattern: '\\S',
        description:
          'Top-level generated attachment filepath, not a URL, attachment ID or order binding receipt.'
      };
    schemas[requestSchema] = { ...object(doc.request, true), title: path + ' request' };
    schemas[responseSchema] = { ...response, title: path + ' response' };
    definitions[path] = {
      requestSchema,
      responseSchema,
      source: 'catalog',
      lifecycle: 'active',
      risk: upload ? 'mutation' : 'read',
      featureArea: 'fulfillment',
      restricted: false,
      restrictionReason: null,
      verification: 'documented',
      realCallEnabled: !upload,
      checkedAt: snapshot.checkedAt.slice(0, 10),
      updatedAt: doc.updatedAt.slice(0, 10) || null,
      title: doc.title,
      description: doc.description,
      errorCodes: doc.errors,
      requestExample: example.request,
      responseExample: example.response,
      docUrl:
        'https://openapi.alibaba.com/doc/api.htm#/api?' +
        new URLSearchParams({ cid: '8', path, methodType: 'GET/POST' }).toString()
    };
  });
  return { schemas, definitions };
}
