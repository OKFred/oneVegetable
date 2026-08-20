export interface RealSmokeIdentifiers {
  productId: string | null;
  productNumericId: number | null;
  draftProductNumericId: number | null;
  categoryId: number | null;
  groupId: number | null;
  attributeId: number | null;
  attributeValueId: number | null;
  rfqId: string | null;
  tradeId: string | null;
  supplierAccountId: string | null;
  encryptorId: string | null;
  buyerEmail: string | null;
}

export type SmokePlan =
  | { kind: 'call'; parameters: Record<string, unknown> }
  | { kind: 'skip'; reasonCode: 'MISSING_PREREQUISITE' };

export const EMPTY_IDENTIFIERS: RealSmokeIdentifiers = {
  productId: null,
  productNumericId: null,
  draftProductNumericId: null,
  categoryId: null,
  groupId: null,
  attributeId: null,
  attributeValueId: null,
  rfqId: null,
  tradeId: null,
  supplierAccountId: null,
  encryptorId: null,
  buyerEmail: null
};

const PRIORITY = new Map<string, number>([
  ['alibaba.icbu.category.get.new', 10],
  ['alibaba.icbu.product.list', 20],
  ['alibaba.icbu.photobank.group.list', 30],
  ['alibaba.icbu.photobank.list', 31],
  ['alibaba.icbu.rfq.recommend', 40],
  ['alibaba.icbu.rfq.search', 41],
  ['alibaba.seller.order.list', 50],
  ['alibaba.procurement.mysupplier.list', 60]
]);

export function sortSmokeMethods<T extends { method: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => {
    const priority = (PRIORITY.get(left.method) ?? 100) - (PRIORITY.get(right.method) ?? 100);
    return priority || left.method.localeCompare(right.method);
  });
}

export function planSmokeRequest(
  method: string,
  example: Record<string, unknown>,
  identifiers: RealSmokeIdentifiers
): SmokePlan {
  switch (method) {
    case 'alibaba.icbu.category.get.new':
      return call({ cat_id: 0 });
    case 'alibaba.icbu.product.list':
      return call({ current_page: 1, page_size: 10, language: 'ENGLISH' });
    case 'alibaba.icbu.photobank.list':
      return call({ current_page: 1, page_size: 10, location_type: 'ALL_GROUP' });
    case 'alibaba.seller.order.list':
      return call({
        param_trade_ecology_order_list_query: { role: 'seller', start_page: 0, page_size: 10 }
      });
    case 'alibaba.procurement.mysupplier.list':
      return call({ current_page: 0, page_size: 10, type: 'order' });
    case 'alibaba.icbu.product.get':
    case 'alibaba.icbu.product.id.decrypt':
      return identifiers.productId
        ? call({ language: 'ENGLISH', product_id: identifiers.productId })
        : skip();
    case 'alibaba.icbu.product.score.get':
      return identifiers.productId ? call({ product_id: identifiers.productId }) : skip();
    case 'alibaba.icbu.product.group.get':
      return call({ extra_context: {}, group_id: identifiers.groupId ?? -1 });
    case 'alibaba.icbu.category.attribute.get':
      return identifiers.categoryId ? call({ cat_id: identifiers.categoryId }) : skip();
    case 'alibaba.icbu.category.id.mapping':
      return identifiers.categoryId && identifiers.attributeId && identifiers.attributeValueId
        ? call({
            cat_id: identifiers.categoryId,
            attribute_id: identifiers.attributeId,
            attribute_value_id: identifiers.attributeValueId,
            convert_type: 1
          })
        : skip();
    case 'alibaba.icbu.product.schema.get':
      return identifiers.categoryId
        ? call({ param_product_top_publish_request: { cat_id: identifiers.categoryId, language: 'en_US' } })
        : skip();
    case 'alibaba.icbu.product.schema.render':
      return identifiers.categoryId && identifiers.productNumericId
        ? call({
            param_product_top_publish_request: {
              cat_id: identifiers.categoryId,
              language: 'en_US',
              product_id: identifiers.productNumericId
            }
          })
        : skip();
    case 'alibaba.icbu.product.schema.render.draft':
      return identifiers.categoryId && identifiers.draftProductNumericId
        ? call({
            param_product_top_publish_request: {
              cat_id: identifiers.categoryId,
              language: 'en_US',
              product_id: identifiers.draftProductNumericId
            }
          })
        : skip();
    case 'alibaba.icbu.category.schema.level.get':
      return identifiers.categoryId ? call({ ...example, cat_id: identifiers.categoryId }) : skip();
    case 'alibaba.icbu.rfq.read':
      return identifiers.rfqId ? call({ rfq_id_list: [identifiers.rfqId] }) : skip();
    case 'alibaba.icbu.rfqdetail.get':
      return identifiers.rfqId ? call({ ...example, rfq_query_dto: { rfq_id: identifiers.rfqId } }) : skip();
    case 'alibaba.order.trade.tt.get':
      return identifiers.tradeId ? call({ e_trade_id: identifiers.tradeId }) : skip();
    case 'alibaba.seller.order.fund.get':
      return identifiers.tradeId
        ? call({ e_trade_id: identifiers.tradeId, data_select: 'fund_serviceFee,fund_fundPay' })
        : skip();
    case 'alibaba.seller.order.logistics.get':
      return identifiers.tradeId
        ? call({ e_trade_id: identifiers.tradeId, data_select: 'logistic_order' })
        : skip();
    case 'alibaba.procurement.supplier.items.get':
      return identifiers.supplierAccountId
        ? call({
            product_list_query: {
              date_end: Date.now(),
              date_start: 0,
              page_index: 0,
              page_size: 10,
              seller_account_id: identifiers.supplierAccountId,
              type: 'order'
            }
          })
        : skip();
    case 'alibaba.seller.trade.decode':
      return identifiers.encryptorId ? call({ encryptor_id: identifiers.encryptorId }) : skip();
    case 'alibaba.trade.address.list.query':
      return identifiers.buyerEmail ? call({ buyer_email: identifiers.buyerEmail }) : skip();
    default:
      return call(structuredClone(example));
  }
}

export function collectSmokeIdentifiers(
  value: unknown,
  current: RealSmokeIdentifiers,
  method?: string
): RealSmokeIdentifiers {
  const next = { ...current };
  visit(value, 0, (key, candidate) => {
    const normalized = key.toLowerCase();
    if (method === 'alibaba.icbu.product.list' && !next.productNumericId && normalized === 'id') {
      next.productNumericId = numberValue(candidate);
    }
    if (!next.productId && ['product_id', 'productid', 'id_string'].includes(normalized)) {
      next.productId = stringValue(candidate);
    }
    if (!next.categoryId && ['category_id', 'cat_id', 'categoryid'].includes(normalized)) {
      next.categoryId = numberValue(candidate);
    }
    if (!next.groupId && ['group_id', 'groupid'].includes(normalized)) next.groupId = numberValue(candidate);
    if (!next.attributeId && ['attribute_id', 'attributeid'].includes(normalized)) {
      next.attributeId = numberValue(candidate);
    }
    if (!next.attributeValueId && ['attribute_value_id', 'attributevalueid'].includes(normalized)) {
      next.attributeValueId = numberValue(candidate);
    }
    if (!next.rfqId && ['rfq_id', 'rfqid'].includes(normalized)) next.rfqId = stringValue(candidate);
    if (!next.tradeId && ['e_trade_id', 'trade_id', 'order_id'].includes(normalized)) {
      next.tradeId = stringValue(candidate);
    }
    if (!next.supplierAccountId && ['seller_account_id', 'supplier_account_id'].includes(normalized)) {
      next.supplierAccountId = stringValue(candidate);
    }
    if (!next.encryptorId && normalized === 'encryptor_id') next.encryptorId = stringValue(candidate);
  });
  return next;
}

export function responseShape(value: unknown, depth = 0): unknown {
  if (depth >= 4) return typeName(value);
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      items: value[0] === undefined ? null : responseShape(value[0], depth + 1)
    };
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .slice(0, 100)
        .map((key) => [key, responseShape(value[key], depth + 1)])
    );
  }
  return typeName(value);
}

export function isNoData(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (!isRecord(value)) return false;
  const arrays = Object.values(value).filter(Array.isArray);
  const countEntries = Object.entries(value).filter(
    ([key, item]) => /(?:total|count|size)$/i.test(key) && typeof item === 'number'
  );
  if (arrays.length > 0 && arrays.every((item) => item.length === 0)) {
    return countEntries.length === 0 || countEntries.every(([, item]) => item === 0);
  }
  return false;
}

function call(parameters: Record<string, unknown>): SmokePlan {
  return { kind: 'call', parameters };
}

function skip(): SmokePlan {
  return { kind: 'skip', reasonCode: 'MISSING_PREREQUISITE' };
}

function visit(value: unknown, depth: number, onValue: (key: string, value: unknown) => void): void {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) visit(item, depth + 1, onValue);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    onValue(key, child);
    visit(child, depth + 1, onValue);
  }
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
