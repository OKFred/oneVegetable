type Schema = Record<string, unknown>;
interface Document {
  path: string;
  title: string;
  description: string;
  documentUrl: string;
  updatedAt: string;
  checkedAt?: string;
  chargeable: boolean;
}
export const maintenancePaths = [
  '/icbu/product/edit-price',
  '/icbu/product/edit-inventory',
  '/alibaba/icbu/draft/delete'
] as const;
const id: Schema = {
  anyOf: [
    { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    { type: 'string', pattern: '^[1-9][0-9]{0,18}$' }
  ]
};
const integer: Schema = {
  anyOf: [
    { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' }
  ]
};
const money: Schema = { type: 'string', maxLength: 128, pattern: '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' };
function object(properties: Record<string, Schema>, required: string[], extra = false): Schema {
  return { type: 'object', properties, required, additionalProperties: extra };
}
/** Native IOP mutations are catalogued, but never enabled in the generic debugger. */
export function buildIopMaintenanceContracts(snapshot: { checkedAt: string; documents: Document[] }) {
  const schemas: Record<string, Schema> = {};
  const definitions: Record<string, unknown> = {};
  maintenancePaths.forEach((path, index) => {
    const doc = snapshot.documents.find((value) => value.path === path);
    if (!doc || doc.chargeable) throw new Error('Missing free maintenance document');
    const requestSchema = 'AlibabaProductIopMaintenance' + String(index) + 'Request';
    const responseSchema = 'AlibabaProductIopMaintenance' + String(index) + 'Response';
    let request: Schema;
    let example: unknown;
    if (index === 0) {
      const tier = object({ quantity: id, price: money }, ['quantity', 'price']);
      const price = object(
        {
          price_type: { enum: ['TIERED', 'RANGE'] },
          currency: { const: 'USD' },
          tiered_price: { type: 'array', minItems: 1, items: tier },
          range_price: object({ min_price: money, max_price: money }, ['min_price', 'max_price'])
        },
        ['price_type', 'currency']
      );
      const skuPrice = {
        type: 'array',
        minItems: 1,
        items: object({ sku_id: id, price: money }, ['sku_id', 'price'])
      };
      request = object({ product_id: id, price, sku_price: skuPrice }, ['product_id']);
      request.oneOf = [
        {
          properties: { price },
          required: ['price'],
          not: { properties: { sku_price: skuPrice }, required: ['sku_price'] }
        },
        {
          properties: { sku_price: skuPrice },
          required: ['sku_price'],
          not: { properties: { price }, required: ['price'] }
        }
      ];
      example = {
        product_id: '880001',
        price: { price_type: 'TIERED', currency: 'USD', tiered_price: [{ quantity: '1', price: '12.50' }] }
      };
    } else if (index === 1) {
      // Use documented Object[] rather than its conflicting map example; do not
      // claim actual provider acceptance until controlled write/readback succeeds.
      const skus = {
        type: 'array',
        minItems: 1,
        items: object({ sku_id: id, inventory: integer }, ['sku_id', 'inventory'])
      };
      request = object({ product_id: id, inventory: integer, sku_inventory: skus }, ['product_id']);
      request.oneOf = [
        {
          properties: { inventory: integer },
          required: ['inventory'],
          not: { properties: { sku_inventory: skus }, required: ['sku_inventory'] }
        },
        {
          properties: { sku_inventory: skus },
          required: ['sku_inventory'],
          not: { properties: { inventory: integer }, required: ['inventory'] }
        }
      ];
      example = { product_id: '880001', inventory: '51' };
    } else {
      request = object(
        { product_id_list: { type: 'array', minItems: 1, maxItems: 1, uniqueItems: true, items: id } },
        ['product_id_list']
      );
      example = { product_id_list: ['770001'] };
    }
    const response =
      index === 2
        ? object(
            {
              success: { type: 'boolean' },
              deleted_draft_ids: { type: 'array', items: id },
              message: { type: 'string' },
              msg_code: { type: 'string' },
              errors: {
                type: 'array',
                items: object(
                  {
                    draft_id: id,
                    errors: {
                      type: 'array',
                      items: object({ message: { type: 'string' }, msg_code: { type: 'string' } }, [], true)
                    }
                  },
                  ['draft_id'],
                  true
                )
              }
            },
            ['success', 'deleted_draft_ids'],
            true
          )
        : object(
            {
              result: object(
                {
                  success: { type: 'boolean' },
                  data: { type: ['object', 'null'], additionalProperties: true },
                  message: { type: 'string' },
                  msg_code: { type: 'string' }
                },
                ['success'],
                true
              )
            },
            ['result'],
            true
          );
    schemas[requestSchema] = { ...request, title: path + ' request' };
    schemas[responseSchema] = { ...response, title: path + ' response' };
    definitions[path] = {
      requestSchema,
      responseSchema,
      source: 'catalog',
      lifecycle: 'active',
      risk: 'mutation',
      verification: 'documented',
      realCallEnabled: false,
      checkedAt: (doc.checkedAt ?? snapshot.checkedAt).slice(0, 10),
      updatedAt: doc.updatedAt.slice(0, 10),
      title: doc.title,
      description: doc.description,
      errorCodes: [],
      requestExample: example,
      responseExample:
        index === 2
          ? { success: true, deleted_draft_ids: [770001] }
          : { result: { success: true, data: null } },
      docUrl: doc.documentUrl
    };
  });
  return { schemas, definitions };
}
