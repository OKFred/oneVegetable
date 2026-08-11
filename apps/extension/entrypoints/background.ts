import { browser } from 'wxt/browser';

import {
  ALIBABA_GATEWAY,
  AlibabaClient,
  API_CAPABILITIES,
  GatewayException,
  normalizeGatewayError,
  type GatewaySettings,
  type OperationId,
  type RuntimeRequest,
  type RuntimeResponse
} from '@one-vegetable/core';

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
  'listOrders',
  'getOrderFund',
  'getOrderLogistics',
  'listCapabilities',
  'callCapability'
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
  if (operation === 'listCapabilities') return [...API_CAPABILITIES];

  const settings = await loadSettings();
  assertCredentials(settings);
  const client = new AlibabaClient(settings);
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
        enabledCapabilityCount: API_CAPABILITIES.filter((item) => item.enabled).length
      };
    }
    case 'listProducts': {
      const call = await client.call('alibaba.icbu.product.list', {
        language: 'ENGLISH',
        current_page: readNumber(request, ['page']) ?? 1,
        page_size: readNumber(request, ['pageSize']) ?? 20,
        subject: readString(request, ['subject']),
        group_id1: readNumber(request, ['groupId'])
      });
      const root = unwrap(call.data, call.method);
      const items = findRecords(root, ['products', 'product_list', 'result_list']).map((item) => ({
        id: readString(item, ['id', 'product_id']) ?? '',
        subject: readString(item, ['subject', 'product_subject']) ?? '未命名商品',
        groupName: readString(item, ['group_name']) ?? '未分组',
        status: normalizeProductStatus(readString(item, ['status', 'display'])),
        score: readNumber(item, ['score']) ?? 0,
        updatedAt: normalizeDate(readString(item, ['gmt_modified', 'modified_time']))
      }));
      return {
        items,
        page: readNumber(request, ['page']) ?? 1,
        pageSize: readNumber(request, ['pageSize']) ?? 20,
        total: readNumber(root, ['total_count', 'total']) ?? items.length
      };
    }
    case 'getProduct': {
      const productId = requiredString(request, 'productId');
      const call = await client.call('alibaba.icbu.product.schema.render', {
        param_product_top_publish_request: { product_id: productId, language: 'en_US' }
      });
      const root = unwrap(call.data, call.method);
      return {
        id: productId,
        subject: `商品 ${productId}`,
        groupName: 'Schema 商品',
        status: 'online',
        score: 0,
        updatedAt: new Date().toISOString(),
        categoryId: 0,
        language: 'en_US',
        schemaXml: readString(root, ['data']) ?? ''
      };
    }
    case 'getProductSchema': {
      const call = await client.call('alibaba.icbu.product.schema.get', {
        param_product_top_publish_request: {
          cat_id: requiredNumber(request, 'categoryId'),
          language: readString(request, ['language']) ?? 'en_US',
          market: requiredString(request, 'market'),
          product_id: readString(request, ['productId'])
        }
      });
      return {
        xml: readString(unwrap(call.data, call.method), ['data']) ?? '',
        categoryId: requiredNumber(request, 'categoryId'),
        language: readString(request, ['language']) ?? 'en_US',
        market: requiredString(request, 'market')
      };
    }
    case 'publishProduct':
      return mutateProduct(client, 'alibaba.icbu.product.schema.add', request);
    case 'saveProductDraft':
      return mutateProduct(client, 'alibaba.icbu.product.schema.add.draft', request);
    case 'updateProduct':
      return mutateProduct(client, 'alibaba.icbu.product.schema.update', request);
    case 'updateProductDisplay': {
      await client.call('alibaba.icbu.product.batch.update.display', {
        product_id_list: requiredStringArray(request, 'productIds').join(','),
        new_display: requiredString(request, 'display') === 'online' ? 'true' : 'false'
      });
      return undefined;
    }
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
        height: readNumber(item, ['height']) ?? 1
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
        height: readNumber(root, ['height']) ?? 1
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
      const capability = API_CAPABILITIES.find((item) => item.method === method);
      assertCallable(capability);
      const call = await client.call(method, asRecord(request.parameters));
      return { method, traceId: readTraceId(call.data) ?? crypto.randomUUID(), data: call.data };
    }
  }
}

async function mutateProduct(
  client: AlibabaClient,
  method: string,
  request: Record<string, unknown>
): Promise<unknown> {
  const call = await client.call(method, {
    param_product_top_publish_request: {
      cat_id: requiredNumber(request, 'categoryId'),
      language: readString(request, ['language']) ?? 'en_US',
      product_id: readString(request, ['productId']),
      xml: requiredString(request, 'schemaXml')
    }
  });
  const root = unwrap(call.data, method);
  return {
    productId: readString(root, ['product_id']) ?? readString(request, ['productId']) ?? '',
    traceId: readString(root, ['trace_id']) ?? crypto.randomUUID(),
    success: readBoolean(root, ['biz_success', 'success']) ?? true
  };
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

function readBoolean(record: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) if (typeof record[key] === 'boolean') return record[key];
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
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    throw new Error(`缺少必填参数 ${key}`);
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

function normalizeProductStatus(
  value: string | undefined
): 'online' | 'offline' | 'draft' | 'auditing' | 'rejected' {
  const normalized = value?.toLowerCase();
  if (normalized?.includes('online') || normalized === 'true') return 'online';
  if (normalized?.includes('audit')) return 'auditing';
  if (normalized?.includes('reject')) return 'rejected';
  if (normalized?.includes('draft')) return 'draft';
  return 'offline';
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

function assertCallable(
  capability: (typeof API_CAPABILITIES)[number] | undefined
): asserts capability is (typeof API_CAPABILITIES)[number] {
  if (!capability) throw new Error('API 不在已审计的免费非聚石塔目录中');
  if (capability.restricted) throw new Error(capability.restrictionReason);
  if (!capability.enabled) throw new Error('API 尚未完成契约、适配器与测试，当前不可调用');
}
