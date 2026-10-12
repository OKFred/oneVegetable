import { GatewayException } from './errors';
import { IOP_BUSINESS_ENDPOINT, isRecord, signIopRequest } from './alibaba-iop';
import { serializeAlibabaParameters } from './signing';
import { assertAlibabaBusinessParameters } from './transport-security';
import type { GatewayCredentials, OperationId } from './types';

/** Explicit mappings, not method.replaceAll('.', '/'). Unmapped methods never go to TOP. */
type BusinessPath = `/alibaba/${string}` | `/icbu/${string}` | `/order/${string}`;
const INVENTORY = 'alibaba.icbu.product.inventory.get';
const ENCRYPT = 'alibaba.icbu.product.id.encrypt';
const READ_PATHS: Readonly<Record<string, BusinessPath>> = {
  'alibaba.icbu.product.list': '/alibaba/icbu/product/list',
  'alibaba.icbu.product.group.get': '/alibaba/icbu/product/group/get',
  'alibaba.icbu.product.schema.render': '/icbu/product/schema/render',
  'alibaba.icbu.product.schema.render.draft': '/icbu/product/schema/render/draft',
  'alibaba.icbu.photobank.group.list': '/icbu/product/photobank/group/list',
  'alibaba.icbu.photobank.list': '/icbu/product/photobank/list',
  'alibaba.icbu.category.get.new': '/icbu/product/category/get',
  'alibaba.icbu.category.id.mapping': '/alibaba/icbu/category/id/mapping',
  'alibaba.icbu.category.schema.level.get': '/icbu/product/schema/level/get',
  'alibaba.icbu.product.schema.get': '/alibaba/icbu/product/schema/get',
  'alibaba.icbu.product.score.get': '/icbu/product/score/get',
  'alibaba.icbu.product.type.available.get': '/icbu/product/other/available/get',
  [INVENTORY]: '/icbu/product/inventory/get',
  [ENCRYPT]: '/alibaba/icbu/product/id/encrypt',
  'alibaba.seller.order.list': '/alibaba/order/list',
  'alibaba.seller.order.logistics.get': '/order/logistics/query'
};
const WRITE_PATHS: Readonly<Record<string, BusinessPath>> = {
  'alibaba.icbu.product.schema.add': '/icbu/product/schema/add',
  'alibaba.icbu.product.schema.add.draft': '/icbu/product/schema/add/draft',
  'alibaba.icbu.product.schema.update': '/icbu/product/schema/update'
};
// Separate IOP acceptance from the existing TOP allowlist. No runtime bypass switch.
// Live creation/readback and incremental update/restoration confirmed on 2026-10-12.
const VERIFIED_WRITES: readonly string[] = [
  'alibaba.icbu.product.schema.add.draft',
  'alibaba.icbu.product.schema.add',
  'alibaba.icbu.product.schema.update'
];
const WRITE_OPERATIONS: Partial<Record<OperationId, string>> = {
  publishProduct: 'alibaba.icbu.product.schema.add',
  saveProductDraft: 'alibaba.icbu.product.schema.add.draft',
  updateProduct: 'alibaba.icbu.product.schema.update'
};
const READ_OPERATIONS: readonly OperationId[] = [
  'getDashboard',
  'listCapabilities',
  'getCapabilityDefinition',
  'listProducts',
  'getProduct',
  'listProductGroups',
  'renderProductSchema',
  'getProductDraft',
  'listPhotoGroups',
  'listPhotos',
  'getProductSchema',
  'getProductLevelSchema',
  'listProductCategories',
  'mapProductCategory',
  'getProductScore',
  'getProductInventory',
  'listTradeOrders',
  'getTradeOrderLogistics',
  'getTradeOrderAggregate'
];

export function iopOperationReason(operation: OperationId, method?: unknown): string | null {
  if (operation === 'callCapability') return iopMethodReason(method);
  const write = WRITE_OPERATIONS[operation];
  if (write) return iopMethodReason(write);
  return READ_OPERATIONS.includes(operation) ? null : 'ALIBABA_IOP_METHOD_UNSUPPORTED';
}

export function iopMethodReason(method: unknown): string | null {
  if (typeof method !== 'string') return 'ALIBABA_IOP_METHOD_UNSUPPORTED';
  if (Object.hasOwn(READ_PATHS, method) || VERIFIED_WRITES.includes(method)) return null;
  return Object.hasOwn(WRITE_PATHS, method)
    ? 'ALIBABA_IOP_MUTATION_UNVERIFIED'
    : 'ALIBABA_IOP_METHOD_UNSUPPORTED';
}

export async function createIopBusinessRequest(
  credentials: GatewayCredentials,
  method: string,
  input: Readonly<Record<string, unknown>>,
  now = Date.now()
): Promise<{ url: string; parameters: Record<string, string> }> {
  if (credentials.endpoint.replace(/\/$/u, '') !== IOP_BUSINESS_ENDPOINT)
    throw failure('ALIBABA_PROTOCOL_ENDPOINT_MISMATCH');
  assertAlibabaBusinessParameters(input);
  if (Object.hasOwn(input, 'access_token')) throw failure('CAPABILITY_TRANSPORT_PARAMETER_FORBIDDEN');
  const path = Object.hasOwn(READ_PATHS, method)
    ? READ_PATHS[method]
    : Object.hasOwn(WRITE_PATHS, method)
      ? WRITE_PATHS[method]
      : undefined;
  if (!path) throw failure('ALIBABA_IOP_METHOD_UNSUPPORTED');
  let business: Readonly<Record<string, unknown>> = input;
  if (method === INVENTORY || method === ENCRYPT) {
    if (Object.keys(input).some((key) => key !== 'product_id' && key !== 'language'))
      throw failure('ALIBABA_IOP_PARAMETER_UNSUPPORTED');
    business = { product_id: positiveInteger(input.product_id), language: requiredText(input.language) };
  } else if (method.startsWith('alibaba.icbu.product.schema.')) {
    const request = input.param_product_top_publish_request;
    if (!isRecord(request)) throw failure('REQUEST_CONTRACT_INVALID');
    const data: Record<string, unknown> = {
      cat_id: positiveInteger(request.cat_id),
      language: requiredText(request.language)
    };
    if (method.endsWith('schema.get')) {
      // IOP chooses the market inside the returned Schema, not a TOP transport parameter.
      if (
        request.product_id !== undefined ||
        (request.market !== undefined && request.market !== 'wholesale')
      )
        throw failure('ALIBABA_IOP_PARAMETER_UNSUPPORTED');
    } else {
      if (method.includes('render') || method.endsWith('update'))
        data.product_id = positiveInteger(request.product_id);
      if (!method.includes('render')) {
        data.xml = requiredText(request.xml);
      }
    }
    business = method.endsWith('schema.render')
      ? { render_request: data }
      : method.endsWith('schema.add')
        ? { publish_request: data }
        : method.endsWith('schema.add.draft')
          ? { param_product_top_publish_request: data }
          : data;
  } else if (method === 'alibaba.seller.order.list') {
    const query = input.param_trade_ecology_order_list_query;
    if (!isRecord(query)) throw failure('REQUEST_CONTRACT_INVALID');
    const keys = [
      'role',
      'start_page',
      'page_size',
      'status',
      'sales_man_login_id',
      'create_date_start',
      'create_date_end',
      'modified_date_start',
      'modified_date_end'
    ];
    if (Object.keys(query).some((key) => !keys.includes(key)))
      throw failure('ALIBABA_IOP_PARAMETER_UNSUPPORTED');
    if (query.role !== 'seller' && query.role !== 'buyer') throw failure('REQUEST_CONTRACT_INVALID');
    business = query;
  } else if (method === 'alibaba.seller.order.logistics.get') {
    business = { trade_id: input.e_trade_id, data_select: input.data_select };
  } else if (method === 'alibaba.icbu.photobank.list') {
    // The documented IOP endpoint requires an explicit groupId. Do not turn ALL_GROUP into a guess.
    if (
      (typeof input.group_id !== 'string' && typeof input.group_id !== 'number') ||
      input.location_type !== 'SUB_GROUP'
    )
      throw failure('ALIBABA_IOP_PHOTO_GROUP_REQUIRED');
    business = {
      groupId: String(input.group_id),
      currentPage: input.current_page,
      pageSize: input.page_size
    };
  }
  const parameters = serializeAlibabaParameters({
    ...business,
    app_key: credentials.appKey,
    ...(['alibaba.icbu.category.id.mapping', 'alibaba.icbu.category.schema.level.get'].includes(method)
      ? {}
      : { access_token: credentials.accessToken }),
    timestamp: String(now),
    sign_method: 'sha256',
    simplify: 'true'
  });
  return {
    url: IOP_BUSINESS_ENDPOINT + path,
    parameters: { ...parameters, sign: await signIopRequest(path, parameters, credentials.appSecret) }
  };
}

/** Validate the IOP envelope before passing a normalized root to the existing business adapters. */
export function normalizeIopBusinessResponse(
  value: unknown,
  method: string,
  credentials: GatewayCredentials
): unknown {
  if (!isRecord(value) || (typeof value.code !== 'number' && typeof value.code !== 'string')) throw failure();
  if (value.code !== '0' && value.code !== 0)
    throw providerFailure(value.code, value.message, value.request_id, credentials);
  if (method === 'alibaba.seller.order.list' || method === 'alibaba.seller.order.logistics.get') {
    const data = value.value;
    if (
      !isRecord(data) ||
      (method.endsWith('order.list')
        ? !records(data.order_list) ||
          !validTotal(data.total_count) ||
          data.order_list.some((item) => typeof item.trade_id !== 'string' || !item.trade_id)
        : (typeof data.logistic_status !== 'string' && !isRecord(data.shipment_date)) ||
          (data.shipping_order_list !== undefined && !records(data.shipping_order_list)))
    )
      throw failure();
    return { [`${method.replaceAll('.', '_')}_response`]: { value: data } };
  }
  const root = value.result;
  if (!isRecord(root)) throw failure();
  const inventory = method === INVENTORY;
  const result = inventory && Object.hasOwn(root, 'result') ? root.result : root;
  if (!isRecord(result)) throw failure();
  const success = result.success === true || result.success === 'true';
  for (const data of root === result ? [result] : [root, result])
    if (
      (data.error_code !== undefined &&
        data.error_code !== '' &&
        data.error_code !== '0' &&
        data.error_code !== 0) ||
      (inventory && data.msg_code) ||
      data.success === false ||
      data.success === 'false'
    )
      throw providerFailure(
        data.error_code ?? data.msg_code ?? 'BUSINESS_REJECTED',
        data.error_msg ?? data.msg ?? data.message_info ?? data.response_msg,
        data.trace_id ?? value.request_id,
        credentials,
        Object.hasOwn(WRITE_PATHS, method) ? 'ALIBABA_IOP_BUSINESS_REJECTED' : 'ALIBABA_IOP_API_REJECTED'
      );
  if (method === 'alibaba.icbu.product.list' && (!records(result.products) || !validTotal(result.total_item)))
    throw failure();
  if (method === 'alibaba.icbu.product.group.get' && !isRecord(result.product_group)) throw failure();
  if (method === 'alibaba.icbu.photobank.group.list' && !records(result.groups)) throw failure();
  if (
    method === 'alibaba.icbu.photobank.list' &&
    (!isRecord(result.pagination_query_list) || !records(result.pagination_query_list.list))
  )
    throw failure();
  if (
    (method.includes('schema.render') ||
      method.endsWith('schema.get') ||
      method.endsWith('schema.level.get')) &&
    (!success || typeof result.data !== 'string' || !result.data.trim())
  )
    throw failure();
  let normalized = result;
  if (inventory) {
    if (!success || !records(result.data_list)) throw failure();
    const { message_info, ...data } = result;
    normalized = {
      result: {
        ...data,
        success: true,
        ...(message_info === undefined ? {} : { biz_message: message_info })
      },
      ...(typeof value.request_id === 'string' ? { request_id: value.request_id } : {})
    };
  } else if (method === ENCRYPT) {
    if (
      typeof result.secret_id !== 'string' ||
      !result.secret_id.trim() ||
      result.secret_id.length > 1024 ||
      /\p{Cc}/u.test(result.secret_id)
    )
      throw failure();
    normalized = { secret_id: result.secret_id };
  } else if (Object.hasOwn(WRITE_PATHS, method)) {
    if (!success) throw failure();
    const id = method.endsWith('schema.add') ? result.data : result.product_id;
    if (!validTotal(id) || Number(id) <= 0) throw failure();
    normalized = { ...result, biz_success: true, product_id: Number(id) };
  } else if (method === 'alibaba.icbu.category.get.new') {
    if (!isRecord(result.result) || !success) throw failure();
    normalized = { category: result.result };
  } else if (method === 'alibaba.icbu.category.id.mapping') {
    const mapped = isRecord(result.mapping_result)
      ? result.mapping_result.category_id
      : result.mapping_result;
    if (!success || !validTotal(mapped) || Number(mapped) <= 0) throw failure();
    normalized = { ...result, mapping_result: Number(mapped) };
  } else if (method === 'alibaba.icbu.product.score.get') {
    if (typeof result.final_score !== 'string' && typeof result.final_score !== 'number') throw failure();
    if (!String(result.final_score).trim() || !Number.isFinite(Number(result.final_score))) throw failure();
    normalized = { result };
  } else if (method === 'alibaba.icbu.product.type.available.get') {
    if (result.success !== true || !isRecord(result.data)) throw failure();
  }
  return { [`${method.replaceAll('.', '_')}_response`]: normalized };
}

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw failure('REQUEST_CONTRACT_INVALID');
  return value;
}

function positiveInteger(value: unknown): number {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    !/^[1-9][0-9]*$/u.test(String(value)) ||
    !Number.isSafeInteger(Number(value))
  )
    throw failure('REQUEST_CONTRACT_INVALID');
  return Number(value);
}

function records(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}
function validTotal(value: unknown): boolean {
  return (
    (typeof value === 'number' || typeof value === 'string') &&
    String(value).trim() !== '' &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) >= 0
  );
}

function failure(code = 'ALIBABA_IOP_RESPONSE_INVALID'): GatewayException {
  return new GatewayException({ code, message: code, retryable: false });
}
function providerFailure(
  code: unknown,
  message: unknown,
  trace: unknown,
  credentials: GatewayCredentials,
  kind = 'ALIBABA_IOP_API_REJECTED'
): GatewayException {
  const atom = String(code).split(';')[0] ?? '';
  const subCode =
    /^[\w.:-]{1,128}$/u.test(atom) &&
    ![credentials.appSecret, credentials.accessToken].some((secret) => secret && atom.includes(secret))
      ? atom
      : 'provider-rejected';
  let text = typeof message === 'string' ? message : 'ALIBABA_IOP_API_REJECTED';
  for (const secret of [credentials.appKey, credentials.appSecret, credentials.accessToken])
    if (secret) text = text.replaceAll(secret, '[redacted]');
  return new GatewayException({
    code: kind,
    subCode,
    message: text.replace(/[\r\n]/gu, ' ').slice(0, 300),
    retryable: false,
    ...(typeof trace === 'string' && /^[\w-]{1,128}$/u.test(trace) ? { traceId: trace } : {})
  });
}
