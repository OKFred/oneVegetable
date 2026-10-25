import { randomUUID } from 'node:crypto';
import { businessAccepted } from '../smoke-product-reference-real';
import { normalizeGatewayError } from '../../packages/core/src/errors';
import { sanitizeDiagnosticMessage } from '../../packages/core/src/diagnostics';
import { IOP_REFERENCE_METHODS } from '../../packages/core/src/product-reference-methods';
import type { GatewayClient, OperationId, RequestOf, ResponseOf } from '../../packages/core/src/types';

export const AUTHORIZATION_MODES = ['top-only', 'iop-only', 'dual-top', 'dual-iop'] as const;
export const READ_PROBE_IDS = [
  'diagnostics',
  'capabilities',
  'dashboard',
  'products-page',
  'products-exact',
  'product-groups',
  'categories',
  'product-detail',
  'schema-render',
  'schema-new',
  'product-score',
  'inventory-product',
  'inventory-sku',
  'photo-groups',
  'photos-all',
  'photos-group',
  'videos',
  'video-relations-main',
  'video-relations-detail',
  'showcase',
  'orders-seller',
  'orders-buyer',
  'order-aggregate-seller',
  'order-aggregate-buyer',
  'rfq-search',
  'rfq-recommended',
  'rfq-equity',
  'shipping-legacy',
  'supplier-rank',
  'suppliers',
  'native-product',
  'native-categories',
  'native-predict',
  'native-shipping',
  'native-attributes',
  'video-small-page'
] as const;
export type AuthorizationMode = (typeof AUTHORIZATION_MODES)[number];
export type Protocol = 'top' | 'iop';
export type Row = Record<string, unknown>;
export const isRow = (value: unknown): value is Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export interface ReadRule {
  top: string[];
  iop: string[];
  limit: number;
}
const rule = (top: string[], iop: string[] = [], limit = 1): ReadRule => ({ top, iop, limit });
const PRODUCT_LIST = 'alibaba.icbu.product.list';
const RENDER = 'alibaba.icbu.product.schema.render';
const PHOTO = 'alibaba.icbu.photobank.list';
const ORDER = 'alibaba.seller.order.list';
const FUND = 'alibaba.seller.order.fund.get';
const LOGISTICS = 'alibaba.seller.order.logistics.get';
/** Closed read allowlist, independent of the expanding production registry. */
const RULES: Partial<Record<OperationId, ReadRule>> = {
  getDiagnostics: rule([]),
  listCapabilities: rule([]),
  getCapabilityDefinition: rule([]),
  getDashboard: rule(
    [PRODUCT_LIST, PHOTO, ORDER],
    ['/rest/alibaba/icbu/product/list', '/rest/icbu/product/photobank/list', '/rest/alibaba/order/list'],
    3
  ),
  listProducts: rule([PRODUCT_LIST], ['/rest/alibaba/icbu/product/list']),
  getProduct: rule(
    [PRODUCT_LIST, RENDER],
    ['/rest/alibaba/icbu/product/list', '/rest/icbu/product/schema/render'],
    2
  ),
  listProductGroups: rule(['alibaba.icbu.product.group.get'], ['/rest/alibaba/icbu/product/group/get'], 30),
  listProductCategories: rule(['alibaba.icbu.category.get.new'], ['/rest/icbu/product/category/get'], 65),
  getProductSchema: rule(['alibaba.icbu.product.schema.get'], ['/rest/alibaba/icbu/product/schema/get']),
  renderProductSchema: rule([RENDER], ['/rest/icbu/product/schema/render']),
  getProductScore: rule(['alibaba.icbu.product.score.get'], ['/rest/icbu/product/score/get']),
  getProductInventory: rule(
    ['alibaba.icbu.product.inventory.get', 'alibaba.icbu.product.sku.inventory.get'],
    ['/rest/icbu/product/inventory/get']
  ),
  listPhotoGroups: rule(['alibaba.icbu.photobank.group.list'], ['/rest/icbu/product/photobank/group/list']),
  listPhotos: rule([PHOTO], ['/rest/icbu/product/photobank/list']),
  listVideos: rule(['alibaba.icbu.video.query'], ['/rest/alibaba/icbu/video/query']),
  listVideoRelatedProducts: rule(['alibaba.icbu.video.relation.product.list']),
  getProductShowcase: rule(['alibaba.scbp.showcase.status', 'alibaba.scbp.showcase.list'], [], 2),
  listTradeOrders: rule([ORDER], ['/rest/alibaba/order/list']),
  getTradeOrderAggregate: rule(
    [FUND, LOGISTICS],
    ['/rest/alibaba/order/get', '/rest/order/logistics/query'],
    2
  ),
  listRfqs: rule(['alibaba.icbu.rfq.search']),
  listRecommendedRfqs: rule(['alibaba.icbu.rfq.recommend']),
  getRfqEquity: rule(['alibaba.icbu.rfq.myequity']),
  listShippingTemplates: rule(['alibaba.wholesale.shippingline.template.list']),
  getInsightsSupplierRank: rule(['alibaba.icbu.diagnostic.supplier.rank.getpercent']),
  listInsightsSuppliers: rule(['alibaba.procurement.mysupplier.list'])
};
const DUAL_TOP = new Set<OperationId>([
  'getDashboard',
  'getProduct',
  'listPhotos',
  'listVideos',
  'listVideoRelatedProducts',
  'getProductShowcase',
  'getTradeOrderAggregate',
  'listRfqs',
  'listRecommendedRfqs',
  'getRfqEquity',
  'listShippingTemplates',
  'getInsightsSupplierRank',
  'listInsightsSuppliers'
]);
export function profiles(mode: AuthorizationMode): Protocol[] {
  return mode === 'top-only'
    ? ['top']
    : mode === 'iop-only'
      ? ['iop']
      : mode === 'dual-top'
        ? ['top', 'iop']
        : ['iop', 'top'];
}
export function readRule(operation: OperationId, payload: unknown): ReadRule {
  if (operation === 'callCapability') {
    const method = isRow(payload) ? payload.method : null;
    if (method === 'alibaba.icbu.video.query') return rule([method], ['/rest/alibaba/icbu/video/query']);
    if (typeof method !== 'string' || !Object.values(IOP_REFERENCE_METHODS).some((value) => value === method))
      throw new Error('READ_ONLY_OPERATION_DENIED');
    return rule([], ['/rest' + method]);
  }
  const result = RULES[operation];
  if (!result) throw new Error('READ_ONLY_OPERATION_DENIED');
  return result;
}
export function expectation(mode: AuthorizationMode, operation: OperationId, payload: unknown) {
  const rules = readRule(operation, payload);
  const local = rules.top.length === 0 && rules.iop.length === 0;
  const protocol: Protocol =
    mode === 'top-only'
      ? 'top'
      : mode === 'iop-only'
        ? 'iop'
        : DUAL_TOP.has(operation) ||
            (operation === 'getProductInventory' && isRow(payload) && payload.source === 'sku')
          ? 'top'
          : 'iop';
  const supported = local || rules[protocol].length > 0;
  const unavailableVariant =
    protocol === 'iop' &&
    ((operation === 'listPhotos' && (!isRow(payload) || !payload.groupId)) ||
      (operation === 'getProductInventory' && isRow(payload) && payload.source === 'sku'));
  return { protocol: local ? null : protocol, supported: supported && !unavailableVariant, rules };
}
export type ReadStatus =
  | 'passed'
  | 'empty'
  | 'permission-unavailable'
  | 'unsupported'
  | 'scope-protected'
  | 'credential-blocked'
  | 'failed'
  | 'skipped-prerequisite';
export interface Observation {
  id: string;
  operation: OperationId;
  expectedProtocol: Protocol | null;
  requestId: string;
  status: ReadStatus;
  count?: number;
  code?: string;
  subCode?: string;
  diagnosticHint?: string;
  requests: number;
}
export interface ReadWireEvent {
  protocol: Protocol;
  method: string;
  requestId: string;
  status: number;
}
export interface MatrixGuard {
  arm(requestId: string, rule: ReadRule, expected: Protocol | null): void | Promise<void>;
  disarm(): void | Promise<void>;
  snapshot():
    { events: ReadWireEvent[]; blocked: number } | Promise<{ events: ReadWireEvent[]; blocked: number }>;
}
const UNSUPPORTED = new Set([
  'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
  'ALIBABA_IOP_METHOD_UNSUPPORTED',
  'ALIBABA_IOP_PARAMETER_UNSUPPORTED',
  'ALIBABA_IOP_PHOTO_GROUP_REQUIRED',
  'LOGISTICS_QUALIFICATION_REQUIRED'
]);
export function classify(
  error: unknown,
  supported: boolean
): Pick<Observation, 'status' | 'code' | 'subCode'> {
  const value = normalizeGatewayError(error);
  const safe = (text: unknown) =>
    typeof text === 'string' && /^[a-z0-9_.:;-]{1,180}$/iu.test(text) ? text : undefined;
  const code = safe(value.code) ?? 'ERROR_REDACTED',
    subCode = safe(value.subCode);
  const marker = [value.code, value.subCode, value.message].join(' ');
  const status: ReadStatus =
    !supported && UNSUPPORTED.has(code)
      ? 'unsupported'
      : code === 'ALIBABA_IOP_PHOTO_SCOPE_MISMATCH'
        ? 'scope-protected'
        : /invalid.?token|expired.?token|invalid.?session|invalid.?grant|reauthoriz/iu.test(marker)
          ? 'credential-blocked'
          : ['11', 'PERMISSION_DENIED'].includes(code) ||
              /permission|access.?denied|insufficient.?scope|onlyforinvited|not.?authorized/iu.test(marker)
            ? 'permission-unavailable'
            : 'failed';
  return { status, code, ...(subCode ? { subCode } : {}) };
}
function rows(value: unknown): Row[] {
  const list = isRow(value) ? value.items : value;
  if (!Array.isArray(list) || !list.every(isRow)) throw new Error('READ_RESULT_INVALID');
  return list;
}
export function makeRunner(
  mode: AuthorizationMode,
  gateway: GatewayClient,
  guard: MatrixGuard,
  records: Observation[]
) {
  return async function run<K extends OperationId>(
    id: string,
    operation: K,
    payload: RequestOf<K>,
    inspect: (value: ResponseOf<K>) => number
  ): Promise<ResponseOf<K> | null> {
    const requestId = randomUUID(),
      expected = expectation(mode, operation, payload);
    const before = await guard.snapshot();
    await guard.arm(requestId, expected.rules, expected.protocol);
    let value: ResponseOf<K> | null;
    let record: Observation = {
      id,
      operation,
      expectedProtocol: expected.protocol,
      requestId,
      status: 'failed',
      requests: 0
    };
    try {
      const context =
        expected.protocol === null
          ? undefined
          : await gateway.galleryTransferContext?.(operation, isRow(payload) ? payload : {});
      if (expected.protocol !== null && !context) throw new Error('ACTUAL_OPERATION_CONTEXT_REQUIRED');
      value = await gateway.request(operation, payload, {
        requestId,
        ...(context ? { galleryContext: context } : {})
      });
      if (!expected.supported) throw new Error('UNEXPECTED_UNSUPPORTED_OPERATION_SUCCESS');
      const count = inspect(value);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('READ_RESULT_INVALID');
      record = { ...record, status: count ? 'passed' : 'empty', count };
    } catch (error: unknown) {
      record = { ...record, ...classify(error, expected.supported) };
      if (record.status === 'failed')
        record.diagnosticHint = sanitizeDiagnosticMessage(normalizeGatewayError(error).message)
          .replace(/\b\d{4,}\b/gu, '[id]')
          .replace(/[^\s@]+@[^\s@]+/gu, '[email]');
      value = null;
    } finally {
      await guard.disarm();
      const after = await guard.snapshot();
      record.requests = after.events.length - before.events.length;
      if (after.blocked !== before.blocked) {
        record.status = 'failed';
        record.code = 'READ_GUARD_DENIED';
      }
      records.push(record);
      console.log(
        JSON.stringify({
          mode,
          probe: id,
          status: record.status,
          code: record.code,
          requests: record.requests
        })
      );
    }
    return value;
  };
}
export type ReadRunner = ReturnType<typeof makeRunner>;

export async function runReadPlan(
  mode: AuthorizationMode,
  gateway: GatewayClient,
  guard: MatrixGuard,
  records: Observation[],
  options: { productId: string; predictionTitle: string; probes?: readonly string[] }
): Promise<void> {
  const execute = makeRunner(mode, gateway, guard, records);
  const run: ReadRunner = (id, operation, payload, inspect) =>
    options.probes && !options.probes.includes(id)
      ? Promise.resolve(null)
      : execute(id, operation, payload, inspect);
  const list = (value: unknown) => rows(value).length;
  await run('diagnostics', 'getDiagnostics', undefined, () => 1);
  await run('capabilities', 'listCapabilities', undefined, list);
  await run('dashboard', 'getDashboard', undefined, (value) => {
    if (!isRow(value.metricStatuses)) throw new Error('DASHBOARD_STATUS_MISSING');
    return Object.values(value.metricStatuses).filter((item) => isRow(item) && item.state === 'available')
      .length;
  });
  await run('products-page', 'listProducts', { page: 1, pageSize: 2, language: 'en_US' }, list);
  const exact = await run(
    'products-exact',
    'listProducts',
    { page: 1, pageSize: 1, language: 'en_US', productId: options.productId },
    (value) => {
      if (value.items.some((item) => item.id !== options.productId)) throw new Error('EXACT_ID_MISMATCH');
      return value.items.length;
    }
  );
  await run('product-groups', 'listProductGroups', {}, list);
  await run('categories', 'listProductCategories', {}, list);
  const product = exact?.items[0];
  if (product) {
    await run('product-detail', 'getProduct', { productId: product.id }, (value) => {
      if (value.id !== product.id || !value.schemaXml.trim()) throw new Error('PRODUCT_DETAIL_INVALID');
      return 1;
    });
    if (product.categoryId) {
      const schema = { categoryId: product.categoryId, language: 'en_US' };
      await run('schema-render', 'renderProductSchema', { ...schema, productId: product.id }, (value) =>
        value.xml.trim() ? 1 : 0
      );
      await run('schema-new', 'getProductSchema', { ...schema, market: 'wholesale' }, (value) =>
        value.xml.trim() ? 1 : 0
      );
    }
    await run('product-score', 'getProductScore', { productId: product.id }, () => 1);
    for (const source of ['product', 'sku'] as const)
      await run(
        'inventory-' + source,
        'getProductInventory',
        { productId: product.id, source, language: 'en_US' },
        (value) => {
          if (!['ready', 'no-data'].includes(value.status) || value.issues.length)
            throw new Error('INVENTORY_READ_INCOMPLETE');
          return value.records.length;
        }
      );
  }
  const groups = await run('photo-groups', 'listPhotoGroups', {}, list);
  await run('photos-all', 'listPhotos', { page: 1, pageSize: 2 }, list);
  if (groups?.[0])
    await run('photos-group', 'listPhotos', { page: 1, pageSize: 2, groupId: groups[0].id }, list);
  const videos = await run('videos', 'listVideos', { page: 1, pageSize: 20 }, list);
  const videoId = videos?.items.find((item) => item.encryptedId)?.encryptedId;
  if (videoId) {
    for (const type of ['main', 'detail'] as const)
      await run(
        'video-relations-' + type,
        'listVideoRelatedProducts',
        { videoId, type },
        (value) => value.encryptedProductIds.length
      );
  }
  await run('showcase', 'getProductShowcase', undefined, (value) => value.entries.length);
  for (const role of ['seller', 'buyer'] as const) {
    const orders = await run('orders-' + role, 'listTradeOrders', { page: 1, pageSize: 1, role }, (value) => {
      if (value.items.some((item) => item.role !== role)) throw new Error('ORDER_ROLE_MISMATCH');
      return value.items.length;
    });
    const order = orders?.items[0];
    if (order)
      await run(
        'order-aggregate-' + role,
        'getTradeOrderAggregate',
        { order, language: 'en_US' },
        (value) => {
          if (!value.fund && !value.logistics && !value.publicDetail) throw new Error('ORDER_DETAIL_EMPTY');
          return (
            Number(Boolean(value.fund)) +
            Number(Boolean(value.logistics)) +
            Number(Boolean(value.publicDetail))
          );
        }
      );
  }
  await run('rfq-search', 'listRfqs', { page: 1, pageSize: 2, keywords: 'glass' }, list);
  await run('rfq-recommended', 'listRecommendedRfqs', { page: 1, pageSize: 2 }, list);
  await run('rfq-equity', 'getRfqEquity', undefined, () => 1);
  await run('shipping-legacy', 'listShippingTemplates', undefined, list);
  await run('supplier-rank', 'getInsightsSupplierRank', undefined, list);
  await run(
    'suppliers',
    'listInsightsSuppliers',
    { page: 1, pageSize: 2 },
    (value) => value.supplierIds.length
  );
  const native = async (id: string, method: string, parameters: Record<string, unknown>) =>
    run(id, 'callCapability', { method, parameters }, (value) => {
      if (!value.contractValid || !businessAccepted(value.data)) throw new Error('NATIVE_CONTRACT_INVALID');
      return 1;
    });
  await native('native-product', IOP_REFERENCE_METHODS.getProduct, { product_id: options.productId });
  await native('native-categories', IOP_REFERENCE_METHODS.listCategories, {});
  await native('native-predict', IOP_REFERENCE_METHODS.predictCategory, { title: options.predictionTitle });
  await native('native-shipping', IOP_REFERENCE_METHODS.listShippingTemplates, {});
  if (options.probes?.includes('video-small-page'))
    await run(
      'video-small-page',
      'callCapability',
      { method: 'alibaba.icbu.video.query', parameters: { current_page: 1, page_size: 10 } },
      (value) => (value.contractValid ? 1 : 0)
    );
  if (product?.categoryId)
    await native('native-attributes', IOP_REFERENCE_METHODS.getAttributes, {
      category_id: String(product.categoryId)
    });
}
