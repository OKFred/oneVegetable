import { browser } from 'wxt/browser';

import {
  ALIBABA_GATEWAY,
  AlibabaClient,
  findCapability,
  GatewayException,
  getCapabilityDefinition,
  listCapabilities,
  normalizeGatewayError,
  validateCapabilityRequest,
  validateCapabilityResponse,
  type ApiCapability,
  type GatewaySettings,
  type OperationId,
  type RequestOf,
  type RuntimeRequest,
  type RuntimeResponse
} from '@one-vegetable/core';

import { ProductAdapter } from '../lib/product-adapter';

const OPERATIONS = new Set<OperationId>([
  'getDashboard',
  'listProducts',
  'getProduct',
  'getProductSchema',
  'publishProduct',
  'saveProductDraft',
  'updateProduct',
  'updateProductDisplay',
  'listPhotoGroups',
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
  'callCapability'
]);

const MUTATION_OPERATIONS = new Set<OperationId>([
  'publishProduct',
  'saveProductDraft',
  'updateProduct',
  'updateProductDisplay',
  'uploadPhoto',
  'transferPhotoFromUrl',
  'createProductGroup'
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
  try {
    const data = await executeOperation(message.operation, message.payload);
    return { id: message.id, ok: true, data } as RuntimeResponse;
  } catch (error: unknown) {
    const normalized = normalizeGatewayError(error);
    return { id: message.id, ok: false, error: normalized };
  }
}

async function executeOperation(operation: OperationId, payload: unknown): Promise<unknown> {
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
  const client = new AlibabaClient(settings);
  const products = new ProductAdapter(client);
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
    case 'listPhotoGroups': {
      const call = await client.call('alibaba.icbu.photobank.group.list', {});
      return findRecords(unwrap(call.data, call.method), ['groups', 'photo_album_group']).map((item) => ({
        id: readString(item, ['id', 'group_id']) ?? '-1',
        name: readString(item, ['name', 'group_name']) ?? '未命名分组',
        photoCount: readNumber(item, ['photo_count', 'count']) ?? 0
      }));
    }
    case 'listPhotos': {
      const call = await client.call('alibaba.icbu.photobank.list', {
        current_page: readNumber(request, ['page']) ?? 1,
        page_size: readNumber(request, ['pageSize']) ?? 24,
        group_id: readString(request, ['groupId']) ?? '-1',
        location_type: readString(request, ['groupId']) === '-1' ? 'ALL_GROUP' : 'SUB_GROUP'
      });
      const root = unwrap(call.data, call.method);
      const items = findRecords(root, ['list', 'photobank_image_do', 'images']).map((item) => ({
        id: readString(item, ['id', 'photo_id']) ?? '',
        name: readString(item, ['name', 'file_name']) ?? '图片',
        url: normalizeUrl(readString(item, ['url', 'photobank_url'])),
        groupId: readString(item, ['group_id']) ?? '-1',
        width: readNumber(item, ['width']) ?? 1,
        height: readNumber(item, ['height']) ?? 1,
        fileSize: readNumber(item, ['file_size']) ?? 0,
        referenceCount: readNumber(item, ['reference_count']) ?? 0,
        modifiedAt: normalizeDate(readString(item, ['gmt_modified', 'modified_at']))
      }));
      return {
        items,
        page: readNumber(request, ['page']) ?? 1,
        pageSize: readNumber(request, ['pageSize']) ?? 24,
        total: readNumber(root, ['total_count', 'total']) ?? items.length
      };
    }
    case 'uploadPhoto': {
      const call = await client.call('alibaba.icbu.photobank.upload', {
        image_bytes: requiredString(request, 'file'),
        file_name: requiredString(request, 'fileName'),
        group_id: readString(request, ['groupId']) ?? '-1'
      });
      const root = unwrap(call.data, call.method);
      return {
        id: readString(root, ['id', 'photo_id']) ?? '',
        name: requiredString(request, 'fileName'),
        url: normalizeUrl(readString(root, ['photobank_url', 'url'])),
        groupId: readString(request, ['groupId']) ?? '-1',
        width: readNumber(root, ['width']) ?? 1,
        height: readNumber(root, ['height']) ?? 1,
        fileSize: readNumber(root, ['file_size']) ?? 0,
        referenceCount: 0,
        modifiedAt: new Date().toISOString()
      };
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

function normalizeUrl(value: string | undefined): string {
  if (!value) return 'https://placehold.co/1x1';
  return value.startsWith('//') ? `https:${value}` : value;
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
