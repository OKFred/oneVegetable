import {
  AlibabaClient,
  findCapability,
  GatewayException,
  getCapabilityDefinition,
  InsightsAdapter,
  listCapabilities,
  LogisticsAdapter,
  NetworkManager,
  PhotoAdapter,
  ProductAdapter,
  RfqAdapter,
  TradeAdapter,
  validateCapabilityRequest,
  validateCapabilityResponse
} from '@one-vegetable/core';

import type {
  CapabilityCallRequest,
  GatewayClient,
  GatewayCredentials,
  NetworkTransport,
  OperationId,
  RequestOf,
  ResponseOf
} from '@one-vegetable/core';

export interface GatewayRequestContext {
  requestId: string;
}

export interface AlibabaReadGatewayOptions {
  transport?: NetworkTransport;
  wait?: (milliseconds: number) => Promise<void>;
  maxAttempts?: 1 | 2 | 3;
}

export class AlibabaReadGatewayClient implements GatewayClient {
  readonly #credentials: GatewayCredentials;
  readonly #network: NetworkManager;
  readonly #wait: ((milliseconds: number) => Promise<void>) | undefined;
  readonly #maxAttempts: 1 | 2 | 3;

  constructor(credentials: GatewayCredentials, options: AlibabaReadGatewayOptions = {}) {
    this.#credentials = credentials;
    this.#wait = options.wait;
    this.#maxAttempts = options.maxAttempts ?? 3;
    this.#network = new NetworkManager({
      ...(options.transport ? { transport: options.transport } : {}),
      ...(options.wait ? { wait: options.wait } : {}),
      policies: {
        alibaba: {
          allowedOrigins: [new URL(credentials.endpoint).origin],
          timeoutMilliseconds: 30_000,
          maxRequestBytes: 30 * 1024 * 1024,
          maxResponseBytes: 30 * 1024 * 1024,
          defaultHeaders: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
          redirect: 'error'
        },
        bff: { allowedOrigins: [] },
        'external-photo': { allowedOrigins: [] }
      }
    });
  }

  async request<K extends OperationId>(
    operation: K,
    request: RequestOf<K>,
    context?: GatewayRequestContext
  ): Promise<ResponseOf<K>> {
    if (operation === 'listCapabilities') return listCapabilities();
    if (operation === 'getCapabilityDefinition') {
      const method = readString(readRecord(request), 'method');
      const definition = getCapabilityDefinition(method);
      if (!definition) throw gatewayError('CAPABILITY_UNKNOWN', '该能力尚无类型化定义');
      return definition;
    }
    const client = this.createClient(context);
    if (operation !== 'callCapability') {
      return this.requestDedicated(operation, request, client);
    }
    return this.callCapability(request as CapabilityCallRequest, client, context) as Promise<ResponseOf<K>>;
  }

  private createClient(context?: GatewayRequestContext): AlibabaClient {
    return new AlibabaClient(this.#credentials, this.#network, {
      maxAttempts: this.#maxAttempts,
      shouldRetry: (_method, error) => error.retryable,
      ...(this.#wait ? { wait: this.#wait } : {}),
      ...(context ? { requestId: context.requestId } : {})
    });
  }

  private async callCapability(
    payload: CapabilityCallRequest,
    client: AlibabaClient,
    context?: GatewayRequestContext
  ): Promise<unknown> {
    const capability = findCapability(payload.method);
    if (!capability) throw gatewayError('CAPABILITY_UNKNOWN', '该能力不在审计目录中');
    if (!capability.enabled || capability.lifecycle !== 'active') {
      throw gatewayError('CAPABILITY_NOT_ACTIVE', '该能力未处于可调用状态');
    }
    if (capability.restricted) {
      throw gatewayError('CAPABILITY_RESTRICTED', capability.restrictionReason ?? '该能力需要额外资格');
    }
    if (capability.risk !== 'read' || !capability.realCallEnabled) {
      throw gatewayError('REAL_MUTATION_DISABLED', 'BFF 真实写能力保持关闭');
    }

    const requestIssues = await validateCapabilityRequest(payload.method, payload.parameters);
    if (requestIssues.length > 0) {
      throw gatewayError(
        'REQUEST_CONTRACT_INVALID',
        requestIssues.map((issue) => `${issue.instancePath} ${issue.message}`).join('；')
      );
    }
    const call = await client.call(payload.method, payload.parameters);
    const data = unwrapAlibabaResponse(call.data, payload.method);
    const contractIssues = await validateCapabilityResponse(payload.method, data);
    return {
      method: payload.method,
      traceId: readTraceId(call.data) ?? context?.requestId ?? crypto.randomUUID(),
      data,
      contractValid: contractIssues.length === 0,
      contractIssues
    };
  }

  private async requestDedicated<K extends OperationId>(
    operation: K,
    request: RequestOf<K>,
    client: AlibabaClient
  ): Promise<ResponseOf<K>> {
    const products = new ProductAdapter(client);
    const rfqs = new RfqAdapter(client);
    const trades = new TradeAdapter(client);
    const logistics = new LogisticsAdapter(client);
    const insights = new InsightsAdapter(client);
    const photos = new PhotoAdapter(client);
    const record = readRecord(request);
    switch (operation) {
      case 'getDashboard':
        return await dashboard(client);
      case 'getDiagnostics':
        return {
          generatedAt: new Date().toISOString(),
          extensionVersion: '2.0.0-bff',
          entries: []
        } as ResponseOf<K>;
      case 'listProducts':
        return await products.list(request as RequestOf<'listProducts'>);
      case 'getProduct':
        return await products.get(requiredString(record, 'productId'));
      case 'getProductSchema':
        return await products.getSchema(request as RequestOf<'getProductSchema'>);
      case 'renderProductSchema':
        return await products.renderSchema(request as RequestOf<'renderProductSchema'>);
      case 'listProductCategories':
        return await products.listCategories(optionalNumber(record, 'parentId'));
      case 'mapProductCategory':
        return await products.mapCategory(requiredNumber(record, 'categoryId'));
      case 'getProductLevelSchema':
        return await products.getLevelSchema(request as RequestOf<'getProductLevelSchema'>);
      case 'getProductDraft':
        return await products.get(requiredString(record, 'productId'), true);
      case 'listProductGroups':
        return await products.listGroups();
      case 'getProductScore':
        return await products.getScore(requiredString(record, 'productId'));
      case 'listRfqs':
        return await rfqs.list(request as RequestOf<'listRfqs'>);
      case 'listRecommendedRfqs':
        return await rfqs.listRecommended(request as RequestOf<'listRecommendedRfqs'>);
      case 'getRfq':
        return await rfqs.get(requiredString(record, 'rfqId'));
      case 'getRfqEquity':
        return await rfqs.getEquity();
      case 'getRfqReadStatus':
        return await rfqs.getReadStatus(requiredStringArray(record, 'rfqIds'));
      case 'listTradeOrders':
        return await trades.list(request as RequestOf<'listTradeOrders'>);
      case 'getTradeOrderAggregate':
        return await trades.getAggregate((request as RequestOf<'getTradeOrderAggregate'>).order);
      case 'getTradeOrderFund':
        return await trades.getFund(requiredString(record, 'orderId'));
      case 'getTradeOrderLogistics':
        return await trades.getLogistics(requiredString(record, 'orderId'));
      case 'listTradeFulfillmentChannels':
        return await trades.listFulfillmentChannels(optionalString(record, 'language'));
      case 'getTradeServiceCharge':
        return await trades.getServiceCharge(requiredString(record, 'currency'));
      case 'getTradeTtAccount':
        return await trades.getTtAccount(requiredString(record, 'orderId'));
      case 'getTradeAddressSchema':
        return await trades.getAddressSchema(
          requiredString(record, 'countryCode'),
          optionalString(record, 'language')
        );
      case 'listTradeAddresses':
        return await trades.listAddresses(requiredString(record, 'buyerEmail'));
      case 'getInsightsSupplierRank':
        return await insights.getSupplierRank();
      case 'listInsightsSuppliers':
        return await insights.listSuppliers(request as RequestOf<'listInsightsSuppliers'>);
      case 'listInsightsSupplierProducts':
        return await insights.listSupplierProducts(request as RequestOf<'listInsightsSupplierProducts'>);
      case 'listPhotoGroups':
        return await photos.listGroups();
      case 'listPhotos':
        return await photos.list(request as RequestOf<'listPhotos'>);
      case 'listShippingTemplates':
        return await logistics.listShippingTemplates();
      case 'listOrders':
        return await listLegacyOrders(client, request as RequestOf<'listOrders'>);
      case 'getOrderFund':
        return await getLegacyOrderFund(client, requiredString(record, 'orderId'));
      case 'getOrderLogistics':
        return await getLegacyOrderLogistics(client, requiredString(record, 'orderId'));
      case 'listLogisticsAddressNodes':
      case 'listLogisticsSpecialProductTypes':
      case 'listLogisticsProducts':
      case 'calculateLogisticsQuote':
      case 'listLogisticsOrders':
      case 'getLogisticsOrder':
        throw gatewayError(
          'LOGISTICS_QUALIFICATION_REQUIRED',
          'OneTouch 国际物流能力需要业务资格，当前账号尚未完成资格与真实接口验收'
        );
      default:
        throw gatewayError('REAL_MUTATION_DISABLED', 'BFF 真实写能力保持关闭');
    }
  }
}

async function dashboard(client: AlibabaClient): Promise<{
  productCount: number;
  photoCount: number;
  pendingOrderCount: number;
  enabledCapabilityCount: number;
}> {
  const [products, photos, orders] = await Promise.all([
    client.call('alibaba.icbu.product.list', { language: 'ENGLISH', current_page: 1, page_size: 1 }),
    client.call('alibaba.icbu.photobank.list', {
      current_page: 1,
      page_size: 1,
      location_type: 'ALL_GROUP'
    }),
    client.call('alibaba.seller.order.list', {
      param_trade_ecology_order_list_query: { role: 'seller', start_page: 0, page_size: 1 }
    })
  ]);
  return {
    productCount:
      optionalNumber(readRecord(unwrapAlibabaResponse(products.data, products.method)), 'total_count') ?? 0,
    photoCount:
      optionalNumber(readRecord(unwrapAlibabaResponse(photos.data, photos.method)), 'total_count') ?? 0,
    pendingOrderCount:
      optionalNumber(readRecord(unwrapAlibabaResponse(orders.data, orders.method)), 'total_count') ?? 0,
    enabledCapabilityCount: listCapabilities().filter((item) => item.enabled).length
  };
}

async function listLegacyOrders(client: AlibabaClient, request: RequestOf<'listOrders'>) {
  const call = await client.call('alibaba.seller.order.list', {
    param_trade_ecology_order_list_query: {
      role: 'seller',
      start_page: Math.max(0, (request.page ?? 1) - 1),
      page_size: request.pageSize ?? 20,
      ...(request.status ? { status: request.status } : {})
    }
  });
  const root = readRecord(unwrapAlibabaResponse(call.data, call.method));
  const items = findRecords(root, ['orders', 'order_list', 'result_list']).map((item) => ({
    id: optionalString(item, 'e_trade_id') ?? optionalString(item, 'order_id') ?? '',
    buyerName: optionalString(item, 'buyer_name') ?? optionalString(item, 'buyer_login_id') ?? '未知买家',
    amount: optionalNumber(item, 'total_amount') ?? optionalNumber(item, 'amount') ?? 0,
    currency: optionalString(item, 'currency') ?? 'USD',
    status: optionalString(item, 'status') ?? optionalString(item, 'order_status') ?? 'unknown',
    createdAt: normalizeDate(optionalString(item, 'gmt_create') ?? optionalString(item, 'create_time')),
    detailAvailability: 'summary_only' as const
  }));
  return {
    items,
    page: request.page ?? 1,
    pageSize: request.pageSize ?? 20,
    total: optionalNumber(root, 'total_count') ?? optionalNumber(root, 'total') ?? items.length
  };
}

async function getLegacyOrderFund(client: AlibabaClient, orderId: string) {
  const call = await client.call('alibaba.seller.order.fund.get', { e_trade_id: orderId });
  const root = readRecord(unwrapAlibabaResponse(call.data, call.method));
  return {
    orderId,
    paidAmount: optionalNumber(root, 'paid_amount') ?? optionalNumber(root, 'amount') ?? 0,
    currency: optionalString(root, 'currency') ?? 'USD',
    status: optionalString(root, 'status') ?? 'unknown'
  };
}

async function getLegacyOrderLogistics(client: AlibabaClient, orderId: string) {
  const call = await client.call('alibaba.seller.order.logistics.get', { e_trade_id: orderId });
  const root = readRecord(unwrapAlibabaResponse(call.data, call.method));
  return {
    orderId,
    status: optionalString(root, 'status') ?? 'unknown',
    carrier: optionalString(root, 'carrier') ?? optionalString(root, 'logistics_company') ?? null,
    trackingNumber: optionalString(root, 'tracking_number') ?? optionalString(root, 'logistics_no') ?? null
  };
}

function gatewayError(code: string, message: string): GatewayException {
  return new GatewayException({ code, message, retryable: false });
}

function unwrapAlibabaResponse(value: unknown, method: string): unknown {
  const record = readRecord(value);
  const key = `${method.replaceAll('.', '_')}_response`;
  return key in record ? record[key] : value;
}

function readTraceId(value: unknown): string | null {
  const record = readRecord(value);
  for (const key of ['request_id', 'trace_id']) {
    if (typeof record[key] === 'string') return record[key];
  }
  for (const nested of Object.values(record)) {
    const child = readRecord(nested);
    for (const key of ['request_id', 'trace_id']) {
      if (typeof child[key] === 'string') return child[key];
    }
  }
  return null;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value === '')
    throw gatewayError('INVALID_OPERATION_REQUEST', `${key} 无效`);
  return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  return readString(record, key);
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = optionalNumber(record, key);
  if (value === undefined) throw gatewayError('INVALID_OPERATION_REQUEST', `${key} 无效`);
  return value;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function requiredStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw gatewayError('INVALID_OPERATION_REQUEST', `${key} 无效`);
  }
  return value;
}

function findRecords(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown>[] {
  const visit = (value: unknown, depth: number): Record<string, unknown>[] | null => {
    if (depth > 5) return null;
    if (Array.isArray(value) && value.every(isRecord)) return value;
    if (!isRecord(value)) return null;
    for (const key of keys) {
      const result = visit(value[key], depth + 1);
      if (result) return result;
    }
    return null;
  };
  return visit(record, 0) ?? [];
}

function normalizeDate(value: string | undefined): string {
  const date = value ? new Date(value) : new Date(0);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
