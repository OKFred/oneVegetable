import { browser } from 'wxt/browser';

import {
  ALIBABA_GATEWAY,
  AlibabaClient,
  downloadPhotoForUpload,
  findCapability,
  GatewayException,
  getCapabilityDefinition,
  InsightsAdapter,
  listCapabilities,
  LogisticsAdapter,
  normalizeGatewayError,
  sanitizeDiagnosticMessage,
  PhotoAdapter,
  RfqAdapter,
  TradeAdapter,
  validateCapabilityRequest,
  validateCapabilityResponse,
  type ApiCapability,
  type DiagnosticEntry,
  type DiagnosticsSnapshot,
  type GatewaySettings,
  type OperationId,
  type RequestOf,
  type RuntimeRequest,
  type RuntimeResponse
} from '@one-vegetable/core';

import { ProductAdapter } from '../lib/product-adapter';

const OPERATIONS = new Set<OperationId>([
  'getDashboard',
  'getDiagnostics',
  'clearDiagnostics',
  'listProducts',
  'getProduct',
  'getProductSchema',
  'publishProduct',
  'saveProductDraft',
  'updateProduct',
  'updateProductDisplay',
  'listPhotoGroups',
  'operatePhotoGroup',
  'listPhotos',
  'uploadPhoto',
  'transferPhotoFromUrl',
  'listOrders',
  'getOrderFund',
  'getOrderLogistics',
  'listCapabilities',
  'getCapabilityDefinition',
  'listProductCategories',
  'mapProductCategory',
  'getProductLevelSchema',
  'getProductDraft',
  'listProductGroups',
  'createProductGroup',
  'getProductScore',
  'listRfqs',
  'listRecommendedRfqs',
  'getRfq',
  'getRfqEquity',
  'getRfqReadStatus',
  'uploadRfqAttachment',
  'submitRfqQuotation',
  'listTradeOrders',
  'getTradeOrderAggregate',
  'getTradeOrderFund',
  'getTradeOrderLogistics',
  'listTradeFulfillmentChannels',
  'getTradeServiceCharge',
  'getTradeTtAccount',
  'getTradeAddressSchema',
  'listTradeAddresses',
  'saveTradeAddress',
  'deleteTradeAddress',
  'createTradeOrder',
  'modifyTradeOrder',
  'listLogisticsAddressNodes',
  'listLogisticsSpecialProductTypes',
  'listLogisticsProducts',
  'calculateLogisticsQuote',
  'listLogisticsOrders',
  'getLogisticsOrder',
  'listShippingTemplates',
  'createLogisticsOrder',
  'getInsightsSupplierRank',
  'listInsightsSuppliers',
  'listInsightsSupplierProducts',
  'callCapability'
]);

const MUTATION_OPERATIONS = new Set<OperationId>([
  'publishProduct',
  'saveProductDraft',
  'updateProduct',
  'updateProductDisplay',
  'uploadPhoto',
  'operatePhotoGroup',
  'transferPhotoFromUrl',
  'createProductGroup',
  'uploadRfqAttachment',
  'submitRfqQuotation',
  'saveTradeAddress',
  'deleteTradeAddress',
  'createTradeOrder',
  'modifyTradeOrder',
  'createLogisticsOrder'
]);

const QUALIFICATION_GATED_LOGISTICS_OPERATIONS = new Set<OperationId>([
  'listLogisticsAddressNodes',
  'listLogisticsSpecialProductTypes',
  'listLogisticsProducts',
  'calculateLogisticsQuote',
  'listLogisticsOrders',
  'getLogisticsOrder',
  'createLogisticsOrder'
]);

export default defineBackground(() => {
  // WebExtension runtime listeners support returning a promise for the response.
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  browser.runtime.onMessage.addListener((value: unknown) => {
    const message = asRuntimeRequest(value);
    if (!message) return undefined;
    return handleRequest(message);
  });
});

async function handleRequest(message: RuntimeRequest): Promise<RuntimeResponse> {
  if (message.operation === 'getDiagnostics' || message.operation === 'clearDiagnostics') {
    try {
      const data = await executeOperation(message.operation, message.payload);
      return { id: message.id, ok: true, data } as RuntimeResponse;
    } catch (error: unknown) {
      return { id: message.id, ok: false, error: normalizeGatewayError(error) };
    }
  }
  const startedAt = performance.now();
  try {
    const data = await executeOperation(message.operation, message.payload);
    await safelyRecordDiagnostic({
      operation: message.operation,
      method: diagnosticMethod(message.operation, message.payload),
      outcome: 'success',
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      errorCode: null,
      errorMessage: null,
      traceId: readResultTraceId(data)
    });
    return { id: message.id, ok: true, data } as RuntimeResponse;
  } catch (error: unknown) {
    const normalized = normalizeGatewayError(error);
    await safelyRecordDiagnostic({
      operation: message.operation,
      method: diagnosticMethod(message.operation, message.payload),
      outcome: 'error',
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      errorCode: normalized.code,
      errorMessage: sanitizeDiagnosticMessage(normalized.message),
      traceId: normalized.traceId ?? null
    });
    return { id: message.id, ok: false, error: normalized };
  }
}

async function executeOperation(operation: OperationId, payload: unknown): Promise<unknown> {
  if (operation === 'getDiagnostics') return getDiagnostics();
  if (operation === 'clearDiagnostics') {
    await clearDiagnostics();
    return undefined;
  }
  if (operation === 'listCapabilities') return listCapabilities();
  if (operation === 'getCapabilityDefinition') {
    const definition = getCapabilityDefinition(requiredString(asRecord(payload), 'method'));
    if (!definition) throw new Error('该能力尚无类型化定义');
    return definition;
  }

  const settings = await loadSettings();
  assertCredentials(settings);
  if (MUTATION_OPERATIONS.has(operation)) {
    throw new GatewayException({
      code: 'REAL_MUTATION_DISABLED',
      message: '真实写操作尚未通过账号 smoke test，当前扩展版本保持禁用',
      retryable: false
    });
  }
  if (QUALIFICATION_GATED_LOGISTICS_OPERATIONS.has(operation)) {
    throw new GatewayException({
      code: 'LOGISTICS_QUALIFICATION_REQUIRED',
      message: 'OneTouch 国际物流能力需要业务资格，当前账号尚未完成资格与真实接口验收',
      retryable: false
    });
  }
  const client = await AlibabaClient.create(settings);
  const products = new ProductAdapter(client);
  const rfqs = new RfqAdapter(client);
  const trades = new TradeAdapter(client);
  const logistics = new LogisticsAdapter(client);
  const insights = new InsightsAdapter(client);
  const photos = new PhotoAdapter(client);
  const request = asRecord(payload);

  switch (operation) {
    case 'getDashboard': {
      const [products, photos, orders] = await Promise.all([
        client.call('alibaba.icbu.product.list', { language: 'ENGLISH', current_page: 1, page_size: 1 }),
        client.call('alibaba.icbu.photobank.list', {
          current_page: 1,
          page_size: 1,
          location_type: 'ALL_GROUP'
        }),
        client.call('alibaba.seller.order.list', {
          param_trade_ecology_order_list_query: { current_page: 1, page_size: 1 }
        })
      ]);
      return {
        productCount: readNumber(unwrap(products.data, products.method), ['total_count', 'total']) ?? 0,
        photoCount: readNumber(unwrap(photos.data, photos.method), ['total_count', 'total']) ?? 0,
        pendingOrderCount: readNumber(unwrap(orders.data, orders.method), ['total_count', 'total']) ?? 0,
        enabledCapabilityCount: listCapabilities().filter((item) => item.enabled).length
      };
    }
    case 'listProducts':
      return products.list(payload as RequestOf<'listProducts'>);
    case 'getProduct':
      return products.get(requiredString(request, 'productId'));
    case 'getProductSchema':
      return products.getSchema(payload as RequestOf<'getProductSchema'>);
    case 'publishProduct':
      return products.mutate('alibaba.icbu.product.schema.add', payload as RequestOf<'publishProduct'>);
    case 'saveProductDraft':
      return products.mutate(
        'alibaba.icbu.product.schema.add.draft',
        payload as RequestOf<'saveProductDraft'>
      );
    case 'updateProduct':
      return products.mutate('alibaba.icbu.product.schema.update', payload as RequestOf<'updateProduct'>);
    case 'updateProductDisplay':
      return products.updateDisplay(payload as RequestOf<'updateProductDisplay'>);
    case 'listProductCategories':
      return products.listCategories(readNumber(request, ['parentId']));
    case 'mapProductCategory':
      return products.mapCategory(requiredNumber(request, 'categoryId'));
    case 'getProductLevelSchema':
      return products.getLevelSchema(payload as RequestOf<'getProductLevelSchema'>);
    case 'getProductDraft':
      return products.get(requiredString(request, 'productId'), true);
    case 'listProductGroups':
      return products.listGroups();
    case 'createProductGroup':
      return products.createGroup(payload as RequestOf<'createProductGroup'>);
    case 'getProductScore':
      return products.getScore(requiredString(request, 'productId'));
    case 'listRfqs':
      return rfqs.list(payload as RequestOf<'listRfqs'>);
    case 'listRecommendedRfqs':
      return rfqs.listRecommended(payload as RequestOf<'listRecommendedRfqs'>);
    case 'getRfq':
      return rfqs.get(requiredString(request, 'rfqId'));
    case 'getRfqEquity':
      return rfqs.getEquity();
    case 'getRfqReadStatus':
      return rfqs.getReadStatus(requiredStringArray(request, 'rfqIds'));
    case 'uploadRfqAttachment':
      return rfqs.uploadAttachment(payload as RequestOf<'uploadRfqAttachment'>);
    case 'submitRfqQuotation':
      return rfqs.submitQuotation(payload as RequestOf<'submitRfqQuotation'>);
    case 'listTradeOrders':
      return trades.list(payload as RequestOf<'listTradeOrders'>);
    case 'getTradeOrderAggregate':
      return trades.getAggregate((payload as RequestOf<'getTradeOrderAggregate'>).order);
    case 'getTradeOrderFund':
      return trades.getFund(requiredString(request, 'orderId'));
    case 'getTradeOrderLogistics':
      return trades.getLogistics(requiredString(request, 'orderId'));
    case 'listTradeFulfillmentChannels':
      return trades.listFulfillmentChannels(readString(request, ['language']));
    case 'getTradeServiceCharge':
      return trades.getServiceCharge(requiredString(request, 'currency'));
    case 'getTradeTtAccount':
      return trades.getTtAccount(requiredString(request, 'orderId'));
    case 'getTradeAddressSchema':
      return trades.getAddressSchema(
        requiredString(request, 'countryCode'),
        readString(request, ['language'])
      );
    case 'listTradeAddresses':
      return trades.listAddresses(requiredString(request, 'buyerEmail'));
    case 'saveTradeAddress':
      return trades.saveAddress(payload as RequestOf<'saveTradeAddress'>);
    case 'deleteTradeAddress':
      return trades.deleteAddress(requiredString(request, 'addressId'));
    case 'createTradeOrder':
    case 'modifyTradeOrder':
      throw new Error('信保订单写入需要真实账号逐方法验收，当前保持禁用');
    case 'listLogisticsAddressNodes':
      return logistics.listAddressNodes(payload as RequestOf<'listLogisticsAddressNodes'>);
    case 'listLogisticsSpecialProductTypes':
      return logistics.listSpecialProductTypes();
    case 'listLogisticsProducts':
      return logistics.listProducts();
    case 'calculateLogisticsQuote':
      return logistics.calculateQuote(payload as RequestOf<'calculateLogisticsQuote'>);
    case 'listLogisticsOrders':
      return logistics.listOrders(payload as RequestOf<'listLogisticsOrders'>);
    case 'getLogisticsOrder':
      return logistics.getOrder(requiredString(request, 'orderNumber'));
    case 'listShippingTemplates':
      return logistics.listShippingTemplates();
    case 'createLogisticsOrder':
      return logistics.createOrder(payload as RequestOf<'createLogisticsOrder'>);
    case 'getInsightsSupplierRank':
      return insights.getSupplierRank();
    case 'listInsightsSuppliers':
      return insights.listSuppliers(payload as RequestOf<'listInsightsSuppliers'>);
    case 'listInsightsSupplierProducts':
      return insights.listSupplierProducts(payload as RequestOf<'listInsightsSupplierProducts'>);
    case 'listPhotoGroups':
      return photos.listGroups();
    case 'operatePhotoGroup':
      return photos.operateGroup(payload as RequestOf<'operatePhotoGroup'>);
    case 'listPhotos':
      return photos.list(payload as RequestOf<'listPhotos'>);
    case 'uploadPhoto':
      return photos.upload(payload as RequestOf<'uploadPhoto'>);
    case 'transferPhotoFromUrl': {
      const downloaded = await downloadPhotoForUpload(payload as RequestOf<'transferPhotoFromUrl'>);
      return photos.upload({
        file: downloaded.file,
        fileName: downloaded.fileName,
        ...(downloaded.groupId ? { groupId: downloaded.groupId } : {})
      });
    }
    case 'listOrders': {
      const call = await client.call('alibaba.seller.order.list', {
        param_trade_ecology_order_list_query: {
          current_page: readNumber(request, ['page']) ?? 1,
          page_size: readNumber(request, ['pageSize']) ?? 20,
          status: readString(request, ['status'])
        }
      });
      const root = unwrap(call.data, call.method);
      const items = findRecords(root, ['orders', 'order_list', 'result_list']).map((item) => ({
        id: readString(item, ['e_trade_id', 'order_id']) ?? '',
        buyerName: readString(item, ['buyer_name', 'buyer_login_id']) ?? '未知买家',
        amount: readNumber(item, ['total_amount', 'amount']) ?? 0,
        currency: readString(item, ['currency']) ?? 'USD',
        status: readString(item, ['status', 'order_status']) ?? 'unknown',
        createdAt: normalizeDate(readString(item, ['gmt_create', 'create_time'])),
        detailAvailability: 'summary_only'
      }));
      return {
        items,
        page: readNumber(request, ['page']) ?? 1,
        pageSize: readNumber(request, ['pageSize']) ?? 20,
        total: readNumber(root, ['total_count', 'total']) ?? items.length
      };
    }
    case 'getOrderFund': {
      const orderId = requiredString(request, 'orderId');
      const call = await client.call('alibaba.seller.order.fund.get', { e_trade_id: orderId });
      const root = unwrap(call.data, call.method);
      return {
        orderId,
        paidAmount: readNumber(root, ['paid_amount', 'amount']) ?? 0,
        currency: readString(root, ['currency']) ?? 'USD',
        status: readString(root, ['status']) ?? 'unknown'
      };
    }
    case 'getOrderLogistics': {
      const orderId = requiredString(request, 'orderId');
      const call = await client.call('alibaba.seller.order.logistics.get', { e_trade_id: orderId });
      const root = unwrap(call.data, call.method);
      return {
        orderId,
        status: readString(root, ['status']) ?? 'unknown',
        carrier: readString(root, ['carrier', 'logistics_company']) ?? null,
        trackingNumber: readString(root, ['tracking_number', 'logistics_no']) ?? null
      };
    }
    case 'callCapability': {
      const method = requiredString(request, 'method');
      const capability = findCapability(method);
      assertCallable(capability);
      const parameters = asRecord(request.parameters);
      const requestIssues = validateCapabilityRequest(method, parameters);
      if (requestIssues.length > 0) {
        throw new GatewayException({
          code: 'REQUEST_CONTRACT_INVALID',
          message: requestIssues.map((issue) => `${issue.instancePath} ${issue.message}`).join('；'),
          retryable: false
        });
      }
      const call = await client.call(method, parameters);
      const data = unwrap(call.data, method);
      const contractIssues = validateCapabilityResponse(method, data);
      return {
        method,
        traceId: readTraceId(call.data) ?? crypto.randomUUID(),
        data,
        contractValid: contractIssues.length === 0,
        contractIssues
      };
    }
  }
}

const DIAGNOSTICS_KEY = 'diagnosticEntries';
const MAX_DIAGNOSTIC_ENTRIES = 100;
let diagnosticsWrite = Promise.resolve();

type DiagnosticInput = Omit<DiagnosticEntry, 'id' | 'timestamp'>;

async function safelyRecordDiagnostic(input: DiagnosticInput): Promise<void> {
  try {
    await recordDiagnostic(input);
  } catch (error: unknown) {
    console.warn('[oneVegetable] diagnostic write failed', normalizeGatewayError(error).code);
  }
}

function recordDiagnostic(input: DiagnosticInput): Promise<void> {
  diagnosticsWrite = diagnosticsWrite
    .catch(() => undefined)
    .then(async () => {
      const stored = await browser.storage.session.get(DIAGNOSTICS_KEY);
      const entries = diagnosticEntries(stored[DIAGNOSTICS_KEY]);
      entries.push({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...input });
      await browser.storage.session.set({
        [DIAGNOSTICS_KEY]: entries.slice(-MAX_DIAGNOSTIC_ENTRIES)
      });
    });
  return diagnosticsWrite;
}

async function getDiagnostics(): Promise<DiagnosticsSnapshot> {
  await diagnosticsWrite;
  const stored = await browser.storage.session.get(DIAGNOSTICS_KEY);
  return {
    generatedAt: new Date().toISOString(),
    extensionVersion: browser.runtime.getManifest().version,
    entries: diagnosticEntries(stored[DIAGNOSTICS_KEY])
  };
}

async function clearDiagnostics(): Promise<void> {
  await diagnosticsWrite;
  await browser.storage.session.remove(DIAGNOSTICS_KEY);
}

function diagnosticEntries(value: unknown): DiagnosticEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => (isDiagnosticEntry(entry) ? [entry] : [])).slice(-MAX_DIAGNOSTIC_ENTRIES);
}

function isDiagnosticEntry(value: unknown): value is DiagnosticEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.timestamp === 'string' &&
    typeof value.operation === 'string' &&
    (typeof value.method === 'string' || value.method === null) &&
    (value.outcome === 'success' || value.outcome === 'error') &&
    typeof value.durationMs === 'number' &&
    (typeof value.errorCode === 'string' || value.errorCode === null) &&
    (typeof value.errorMessage === 'string' || value.errorMessage === null) &&
    (typeof value.traceId === 'string' || value.traceId === null)
  );
}

function diagnosticMethod(operation: OperationId, payload: unknown): string | null {
  if (operation === 'callCapability') return readString(asRecord(payload), ['method']) ?? null;
  const methods: Partial<Record<OperationId, string>> = {
    listProducts: 'alibaba.icbu.product.list',
    listPhotoGroups: 'alibaba.icbu.photobank.group.list',
    listPhotos: 'alibaba.icbu.photobank.list',
    listTradeOrders: 'alibaba.seller.order.list',
    listRfqs: 'alibaba.icbu.rfq.search'
  };
  return methods[operation] ?? null;
}

function readResultTraceId(value: unknown): string | null {
  return readString(asRecord(value), ['traceId', 'trace_id', 'request_id']) ?? null;
}

async function loadSettings(): Promise<GatewaySettings> {
  const stored = await browser.storage.local.get('gatewaySettings');
  const value = asRecord(stored.gatewaySettings);
  return {
    appKey: readString(value, ['appKey']) ?? '',
    appSecret: readString(value, ['appSecret']) ?? '',
    accessToken: readString(value, ['accessToken']) ?? '',
    endpoint: readString(value, ['endpoint']) ?? ALIBABA_GATEWAY,
    signMethod: normalizeSignMethod(readString(value, ['signMethod']))
  };
}

function asRuntimeRequest(value: unknown): RuntimeRequest | null {
  if (!isRecord(value) || value.kind !== 'gateway-request' || typeof value.id !== 'string') return null;
  if (typeof value.operation !== 'string' || !OPERATIONS.has(value.operation as OperationId)) return null;
  return value as unknown as RuntimeRequest;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function unwrap(value: unknown, method: string): Record<string, unknown> {
  const record = asRecord(value);
  return asRecord(record[`${method.replaceAll('.', '_')}_response`]);
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
      return Number(value);
  }
  return undefined;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = readString(record, [key]);
  if (!value) throw new Error(`缺少必填参数 ${key}`);
  return value;
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = readNumber(record, [key]);
  if (value === undefined) throw new Error(`缺少必填参数 ${key}`);
  return value;
}

function requiredStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`缺少必填参数 ${key}`);
  }
  return value;
}

function findRecords(record: Record<string, unknown>, keys: string[]): Record<string, unknown>[] {
  const visit = (value: unknown, depth: number): Record<string, unknown>[] | null => {
    if (depth > 5) return null;
    if (Array.isArray(value) && value.every(isRecord)) return value;
    if (!isRecord(value)) return null;
    for (const key of keys)
      if (key in value) {
        const result = visit(value[key], depth + 1);
        if (result) return result;
      }
    for (const child of Object.values(value)) {
      const result = visit(child, depth + 1);
      if (result) return result;
    }
    return null;
  };
  return visit(record, 0) ?? [];
}

function normalizeDate(value: string | undefined): string {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeSignMethod(value: string | undefined): GatewaySettings['signMethod'] {
  return value === 'md5' || value === 'hmac-sha256' ? value : 'hmac';
}

function readTraceId(value: unknown): string | undefined {
  const record = asRecord(value);
  return readString(record, ['trace_id', 'request_id']);
}

function assertCredentials(settings: GatewaySettings): void {
  if (!settings.appKey || !settings.appSecret || !settings.accessToken) {
    throw new GatewayException({
      code: 'MISSING_CREDENTIALS',
      message: '请先在设置中填写 App Key、App Secret 和 Access Token',
      retryable: false
    });
  }
}

function assertCallable(capability: ApiCapability | undefined): asserts capability is ApiCapability {
  if (!capability) throw new Error('API 不在已审计的免费非聚石塔目录中');
  if (capability.restricted) throw new Error(capability.restrictionReason ?? 'API 需要额外业务权限');
  if (!capability.enabled) throw new Error('API 尚未完成契约、适配器与测试，当前不可调用');
  if (!capability.realCallEnabled) {
    throw new Error('该写能力尚未通过真实账号 smoke test，扩展中的真实调用保持禁用');
  }
}
