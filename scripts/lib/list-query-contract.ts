/** Shared internal DTOs, regenerated with every domain contract (not Alibaba wire parameter names). */
export function addListQueryContract(schemas: Record<string, unknown>): void {
  const page = { type: 'integer', minimum: 1 };
  const pageSize = { type: 'integer', minimum: 1, maximum: 100 };
  const platformDate = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$' };
  const object = (properties: Record<string, unknown>) => ({
    type: 'object',
    additionalProperties: false,
    properties
  });
  schemas.ProductListQuery = object({
    page,
    pageSize: { ...pageSize, maximum: 30 },
    subject: { type: 'string' },
    productId: { type: 'string', pattern: '^[1-9][0-9]{0,15}$' },
    categoryId: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    groupId: { type: 'integer' },
    groupLevel: { type: 'integer', enum: [1, 2, 3] },
    language: { type: 'string', enum: ['zh_CN', 'en_US'] },
    modifiedDateStart: platformDate,
    modifiedDateEnd: platformDate
  });
  schemas.PhotoListQuery = object({
    page,
    pageSize,
    groupId: { type: 'string' },
    ungrouped: { type: 'boolean' }
  });
  schemas.TradeOrderListQuery = object({
    page,
    pageSize,
    status: { type: 'string' },
    buyerLoginId: { type: 'string' },
    salesmanId: { type: 'string' },
    createDateStart: platformDate,
    createDateEnd: platformDate,
    modifiedDateStart: platformDate,
    modifiedDateEnd: platformDate
  });
  schemas.PhotoPage = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'page', 'pageSize', 'total'],
    properties: {
      items: { type: 'array', items: { $ref: '#/components/schemas/Photo' } },
      page,
      pageSize,
      total: { type: ['integer', 'null'], minimum: 0 },
      hasNextPage: { type: 'boolean' }
    }
  };
}
