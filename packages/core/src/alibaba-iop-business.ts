import { GatewayException } from './errors';
import { PRODUCT_MAINTENANCE_METHODS } from './product-maintenance-api';
import { validateCapabilityRequest } from './capability-validation-lazy';
import { isProductReferenceMethod, IOP_REFERENCE_METHODS } from './product-reference-methods';
import { IOP_BUSINESS_ENDPOINT, isRecord, signIopRequest } from './alibaba-iop';
import { serializeAlibabaParameters } from './signing';
import { assertAlibabaBusinessParameters } from './transport-security';
import type { GatewayCredentials, OperationId } from './types';
import {
  getIopMethod,
  iopMethodAvailabilityReason,
  iopRegisteredOperationReason
} from './alibaba-iop-registry';

const INVENTORY = 'alibaba.icbu.product.inventory.get';
const INVENTORY_UPDATE = 'alibaba.icbu.product.inventory.update';
const PRODUCT_DISPLAY = 'alibaba.icbu.product.batch.update.display';
const ENCRYPT = 'alibaba.icbu.product.id.encrypt';
const PHOTO_UPLOAD = 'alibaba.icbu.photobank.upload';
const PHOTO_GROUP = 'alibaba.icbu.photobank.group.operate';
const VIDEO_QUERY = 'alibaba.icbu.video.query';
const PRODUCT_GROUP_ADD = 'alibaba.icbu.product.group.add';
const PRODUCT_TYPES = 'alibaba.icbu.product.type.available.get';

export function iopOperationReason(operation: OperationId, method?: unknown): string | null {
  return iopRegisteredOperationReason(operation, method);
}

export function iopMethodReason(
  method: unknown,
  parameters?: Readonly<Record<string, unknown>>
): string | null {
  return iopMethodAvailabilityReason(method, parameters);
}

export function isAccountVerifiedIopMethod(method: string): boolean {
  return getIopMethod(method)?.accountVerified === true;
}

export function applyIopCapabilityProtocol<T extends { method: string; realCallEnabled: boolean }>(
  capability: T
): T {
  return {
    ...capability,
    realCallEnabled: capability.realCallEnabled && iopMethodReason(capability.method) === null,
    verification: getIopMethod(capability.method)?.accountVerified ? 'account-verified' : 'documented'
  };
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
  const definition = getIopMethod(method);
  const path = definition?.path;
  if (!path) throw failure('ALIBABA_IOP_METHOD_UNSUPPORTED');
  if (!definition.adapted) throw failure(iopMethodReason(method) ?? 'ALIBABA_IOP_METHOD_UNSUPPORTED');
  let business: Readonly<Record<string, unknown>> = input;
  if ((Object.values(PRODUCT_MAINTENANCE_METHODS) as string[]).includes(method)) {
    if ((await validateCapabilityRequest(method, input)).length) throw failure('REQUEST_CONTRACT_INVALID');
    business = input;
  } else if (method === IOP_REFERENCE_METHODS.searchProducts) {
    if (
      Object.keys(input).some((key) => !['model_number', 'sku_code', 'page_index', 'page_size'].includes(key))
    )
      throw failure('ALIBABA_IOP_PARAMETER_UNSUPPORTED');
    const model = input.model_number;
    const sku = input.sku_code;
    if ((model === undefined) === (sku === undefined)) throw failure('REQUEST_CONTRACT_INVALID');
    const key = model === undefined ? 'sku_code' : 'model_number';
    const value = requiredText(model ?? sku);
    if (value.trim() !== value || value.length > 200 || /\p{Cc}/u.test(value))
      throw failure('REQUEST_CONTRACT_INVALID');
    const page = input.page_index === undefined ? 1 : positiveInteger(input.page_index);
    const size = input.page_size === undefined ? 20 : positiveInteger(input.page_size);
    if (page > 1000000 || size > 20) throw failure('REQUEST_CONTRACT_INVALID');
    business = { [key]: value, page_index: page, page_size: size };
  } else if (isProductReferenceMethod(method)) {
    const allowed =
      method === IOP_REFERENCE_METHODS.predictCategory
        ? ['title', 'description', 'image']
        : method === IOP_REFERENCE_METHODS.listCategories
          ? ['parent_category_id']
          : method === IOP_REFERENCE_METHODS.getAttributes
            ? ['category_id']
            : method === IOP_REFERENCE_METHODS.getProduct
              ? ['product_id', 'sku_id']
              : [];
    if (Object.keys(input).some((key) => !allowed.includes(key)))
      throw failure('ALIBABA_IOP_PARAMETER_UNSUPPORTED');
    business = Object.fromEntries(
      Object.entries(input).map(([key, value]) => {
        if (key.endsWith('_id')) {
          if (
            (typeof value !== 'string' && typeof value !== 'number') ||
            !/^[1-9][0-9]*$/u.test(String(value)) ||
            (typeof value === 'number' && !Number.isSafeInteger(value))
          )
            throw failure('REQUEST_CONTRACT_INVALID');
          return [key, String(value)];
        }
        return [key, requiredText(value)];
      })
    );
    if (
      (method === IOP_REFERENCE_METHODS.predictCategory && !input.title) ||
      (method === IOP_REFERENCE_METHODS.getAttributes && !input.category_id) ||
      (method === IOP_REFERENCE_METHODS.getProduct && !input.product_id && !input.sku_id)
    )
      throw failure('REQUEST_CONTRACT_INVALID');
  } else if (method === PRODUCT_TYPES) {
    const request = input.type_request;
    if (!isRecord(request) || Object.keys(input).length !== 1) throw failure('REQUEST_CONTRACT_INVALID');
    if (Object.keys(request).some((key) => !['cat_id', 'language'].includes(key)))
      throw failure('ALIBABA_IOP_PARAMETER_UNSUPPORTED');
    business = { cat_id: positiveInteger(request.cat_id), language: requiredText(request.language) };
  } else if (method === PHOTO_UPLOAD) {
    if (Object.keys(input).some((key) => !['file_name', 'group_id'].includes(key)))
      throw failure('ALIBABA_IOP_PARAMETER_UNSUPPORTED');
    business = {
      file_name: requiredText(input.file_name),
      ...(input.group_id === undefined ? {} : { group_id: String(positiveInteger(input.group_id)) })
    };
  } else if (method === PHOTO_GROUP) {
    const request = input.photo_group_operation_request;
    if (!isRecord(request) || Object.keys(input).length !== 1) throw failure('REQUEST_CONTRACT_INVALID');
    if (Object.keys(request).some((key) => !['operation', 'group_id', 'group_name'].includes(key)))
      throw failure('ALIBABA_IOP_PARAMETER_UNSUPPORTED');
    if (!['add', 'rename', 'delete'].includes(String(request.operation)))
      throw failure('REQUEST_CONTRACT_INVALID');
    const rootAdd = request.operation === 'add' && String(request.group_id) === '-1';
    business = {
      operation: request.operation,
      ...(request.group_id === undefined || rootAdd ? {} : { group_id: positiveInteger(request.group_id) }),
      ...(request.operation === 'delete' ? {} : { group_name: requiredText(request.group_name) })
    };
    if (request.operation !== 'add' && request.group_id === undefined)
      throw failure('REQUEST_CONTRACT_INVALID');
  } else if (method === PRODUCT_GROUP_ADD) {
    if (
      Object.keys(input).some((key) => !['group_name', 'parent_id', 'extra_context'].includes(key)) ||
      (input.extra_context !== undefined &&
        (!isRecord(input.extra_context) || Object.keys(input.extra_context).length))
    )
      throw failure('ALIBABA_IOP_PARAMETER_UNSUPPORTED');
    business = {
      group_name: requiredText(input.group_name),
      parent_group_id: String(input.parent_id) === '-1' ? -1 : positiveInteger(input.parent_id)
    };
  } else if (method === VIDEO_QUERY) {
    if (Object.keys(input).some((key) => !['current_page', 'page_size', 'id'].includes(key)))
      throw failure('ALIBABA_IOP_PARAMETER_UNSUPPORTED');
    business = {
      current_page: positiveInteger(input.current_page),
      page_size: positiveInteger(input.page_size),
      ...(input.id === undefined ? {} : { video_id: positiveInteger(input.id) })
    };
  } else if (method === PRODUCT_DISPLAY) {
    if (Object.keys(input).some((key) => !['product_id_list', 'new_display'].includes(key)))
      throw failure('ALIBABA_IOP_PARAMETER_UNSUPPORTED');
    if (
      !Array.isArray(input.product_id_list) ||
      input.product_id_list.length === 0 ||
      input.product_id_list.length > 30 ||
      !['on', 'off'].includes(String(input.new_display))
    )
      throw failure('REQUEST_CONTRACT_INVALID');
    const ids = input.product_id_list.map(positiveInteger);
    if (new Set(ids).size !== ids.length) throw failure('REQUEST_CONTRACT_INVALID');
    business = { product_id_list: ids, new_display: input.new_display };
  } else if (method === INVENTORY_UPDATE) {
    const request = input.request_param;
    if (!isRecord(request) || Object.keys(input).length !== 1) throw failure('REQUEST_CONTRACT_INVALID');
    if (Object.keys(request).some((key) => !['product_id', 'inventory_list'].includes(key)))
      throw failure('ALIBABA_IOP_PARAMETER_UNSUPPORTED');
    if (
      !Array.isArray(request.inventory_list) ||
      !request.inventory_list.length ||
      request.inventory_list.length > 500
    )
      throw failure('REQUEST_CONTRACT_INVALID');
    const seen = new Set<string>();
    business = {
      product_id: positiveInteger(request.product_id),
      inventory_list: request.inventory_list.map((item: unknown) => {
        if (
          !isRecord(item) ||
          Object.keys(item).some((key) => !['operate', 'inventory_code', 'inventory', 'sku_id'].includes(key))
        )
          throw failure('REQUEST_CONTRACT_INVALID');
        if (item.operate !== 'plus' && item.operate !== 'sub') throw failure('REQUEST_CONTRACT_INVALID');
        const sku_id = positiveInteger(item.sku_id);
        const inventory_code = requiredText(item.inventory_code);
        if (inventory_code.trim() !== inventory_code || /\p{Cc}/u.test(inventory_code))
          throw failure('REQUEST_CONTRACT_INVALID');
        const key = JSON.stringify([sku_id, inventory_code]);
        if (seen.has(key)) throw failure('REQUEST_CONTRACT_INVALID');
        seen.add(key);
        return { operate: item.operate, inventory_code, inventory: positiveInteger(item.inventory), sku_id };
      })
    };
  } else if (method === 'alibaba.icbu.product.score.get') {
    if (Object.keys(input).some((key) => key !== 'product_id'))
      throw failure('ALIBABA_IOP_PARAMETER_UNSUPPORTED');
    if (iopMethodReason(method, input)) throw failure('ALIBABA_IOP_PARAMETER_UNSUPPORTED');
    business = { product_id: positiveInteger(input.product_id) };
  } else if (method === INVENTORY || method === ENCRYPT) {
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
  } else if (method === '/alibaba/order/get') {
    if (Object.keys(input).some((key) => !['e_trade_id', 'language'].includes(key)))
      throw failure('ALIBABA_IOP_PARAMETER_UNSUPPORTED');
    if (
      typeof input.e_trade_id !== 'string' ||
      !input.e_trade_id.trim() ||
      input.e_trade_id.length > 128 ||
      /\p{Cc}/u.test(input.e_trade_id) ||
      (input.language !== undefined && input.language !== 'zh_CN' && input.language !== 'en_US')
    )
      throw failure('REQUEST_CONTRACT_INVALID');
    business = { e_trade_id: input.e_trade_id, ...(input.language ? { language: input.language } : {}) };
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
      groupId: String(positiveInteger(input.group_id)),
      currentPage: positiveInteger(input.current_page),
      pageSize: positiveInteger(input.page_size)
    };
  } else if (method === 'alibaba.icbu.photobank.group.list') {
    if (Object.keys(input).some((key) => key !== 'id')) throw failure('ALIBABA_IOP_PARAMETER_UNSUPPORTED');
    business = input.id === undefined ? {} : { id: positiveInteger(input.id) };
  }
  const parameters = serializeAlibabaParameters({
    ...business,
    app_key: credentials.appKey,
    ...(!definition.authorizationRequired ? {} : { access_token: credentials.accessToken }),
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
  credentials: GatewayCredentials,
  request?: Readonly<Record<string, string>>
): unknown {
  if (!isRecord(value) || (typeof value.code !== 'number' && typeof value.code !== 'string')) throw failure();
  if (value.code !== '0' && value.code !== 0)
    throw providerFailure(value.code, value.message, value.request_id, credentials);
  // Keep native business evidence intact for the durable maintenance classifier.
  // Missing success fields are ambiguous, never silently manufactured.
  if ((Object.values(PRODUCT_MAINTENANCE_METHODS) as string[]).includes(method)) return value;
  if (isProductReferenceMethod(method)) {
    const data = method === IOP_REFERENCE_METHODS.predictCategory ? value.result : value;
    if (!isRecord(data)) throw failure();
    if (data.success === false)
      throw providerFailure(
        data.msg_code ?? 'BUSINESS_REJECTED',
        data.message,
        value.request_id,
        credentials,
        'ALIBABA_IOP_BUSINESS_REJECTED'
      );
    if (data.success !== true) throw failure();
    // Preserve native semantics rather than manufacturing a TOP response root.
    return value;
  }
  if (method === '/alibaba/order/get') {
    const data = value.value;
    if (!isRecord(data) || typeof data.trade_id !== 'string' || data.trade_id !== request?.e_trade_id)
      throw failure();
    // Keep native IOP semantics; this is not the restricted TOP/Jushita order detail DTO.
    return { value: data };
  }
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
  if (method === PRODUCT_GROUP_ADD) {
    if (
      value.error_code !== undefined &&
      value.error_code !== '' &&
      value.error_code !== '0' &&
      value.error_code !== 0
    )
      throw providerFailure(
        value.error_code,
        value.error_msg,
        value.request_id,
        credentials,
        'ALIBABA_IOP_BUSINESS_REJECTED'
      );
    const group = value.product_group;
    if (
      !isRecord(group) ||
      !validTotal(group.group_id) ||
      Number(group.group_id) <= 0 ||
      typeof group.group_name !== 'string' ||
      !group.group_name.trim() ||
      !/^(?:-1|[1-9][0-9]*)$/u.test(String(group.parent_id)) ||
      !Number.isSafeInteger(Number(group.parent_id)) ||
      value.success === false ||
      value.success === 'false'
    )
      throw failure();
    return {
      alibaba_icbu_product_group_add_response: { product_group: group, request_id: value.request_id }
    };
  }
  const root = value.result;
  if (!isRecord(root)) throw failure();
  if (method === PRODUCT_DISPLAY) {
    const traceId = [root.trace_id, value._trace_id_, value.request_id].find(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0
    );
    if (root.error_code !== undefined && !['', '0', 0].includes(root.error_code as string | number))
      throw providerFailure(
        root.error_code,
        root.error_msg,
        traceId,
        credentials,
        'ALIBABA_IOP_BUSINESS_REJECTED'
      );
    if (
      !isRecord(root.fail_id_map) ||
      !traceId ||
      root.error_code === undefined ||
      root.success === false ||
      root.success === 'false'
    )
      throw failure();
    if (Object.keys(root.fail_id_map).length > 0)
      throw providerFailure(
        'DISPLAY_ITEM_REJECTED',
        'IOP reported failed product IDs; reconcile each item before retrying.',
        traceId,
        credentials,
        'ALIBABA_IOP_BUSINESS_REJECTED'
      );
    return {
      alibaba_icbu_product_batch_update_display_response: {
        sub_success: true,
        trace_id: traceId,
        request_id: value.request_id
      }
    };
  }
  if (method === INVENTORY_UPDATE) {
    const result = isRecord(root.result) ? root.result : root;
    for (const data of result === root ? [result] : [root, result]) {
      if (
        data.success === false ||
        data.success === 'false' ||
        data.data === false ||
        data.data === 'false' ||
        (data.msg_code !== undefined && data.msg_code !== '') ||
        (data.error_code !== undefined && !['', '0', 0].includes(data.error_code as string | number))
      )
        throw providerFailure(
          typeof data.msg_code === 'string' && data.msg_code !== ''
            ? data.msg_code
            : (data.error_code ?? 'BUSINESS_REJECTED'),
          data.message_info ?? data.error_msg,
          data.trace_id ?? value.request_id,
          credentials,
          'ALIBABA_IOP_BUSINESS_REJECTED'
        );
    }
    if (
      (result.success !== true && result.success !== 'true') ||
      (result.data !== true && result.data !== 'true')
    )
      throw failure();
    // The shared contract keeps the TOP wrapper, but success is checked using the native IOP response.
    return {
      alibaba_icbu_product_inventory_update_response: {
        result: {
          success: true,
          data: 'true',
          ...(result.message_info === undefined ? {} : { message: result.message_info }),
          ...(result.msg_code === undefined ? {} : { msg_code: result.msg_code }),
          ...(result.trace_id === undefined ? {} : { trace_id: result.trace_id })
        },
        request_id: value.request_id
      }
    };
  }
  if (method === VIDEO_QUERY) {
    const model = root.model;
    if (root.msg_code !== undefined && root.msg_code !== '200' && root.msg_code !== 200)
      throw providerFailure(
        root.msg_code,
        root.msg_info,
        value.request_id,
        credentials,
        'ALIBABA_IOP_BUSINESS_REJECTED'
      );
    if (
      !isRecord(model) ||
      !validTotal(model.current_page) ||
      Number(model.current_page) < 1 ||
      !validTotal(model.page_size) ||
      Number(model.page_size) < 1 ||
      !validTotal(model.total_count) ||
      (model.list === undefined ? Number(model.total_count) !== 0 : !records(model.list)) ||
      (Array.isArray(model.list) &&
        model.list.some((row) => !isRecord(row) || !validTotal(row.video_id) || Number(row.video_id) < 1)) ||
      root.success === false ||
      root.success === 'false'
    )
      throw failure();
    return { alibaba_icbu_video_query_response: { result: root, request_id: value.request_id } };
  }
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
        getIopMethod(method)?.risk === 'mutation'
          ? 'ALIBABA_IOP_BUSINESS_REJECTED'
          : 'ALIBABA_IOP_API_REJECTED'
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
  if (method === 'alibaba.icbu.photobank.list') {
    // Use the signed request snapshot, not mutable caller input. Never filter a wrong-group
    // response into an apparently empty group: deletion and transfer reconciliation depend on it.
    const groupId = String(positiveInteger(request?.groupId));
    const page = positiveInteger(request?.currentPage);
    const pageSize = positiveInteger(request?.pageSize);
    const pagination = result.pagination_query_list as Record<string, unknown>;
    const items = pagination.list as Record<string, unknown>[];
    if (
      items.some(
        (item) => !validTotal(item.group_id) || Number(item.group_id) < 1 || String(item.group_id) !== groupId
      )
    )
      throw providerFailure(
        'PHOTO_GROUP_MISMATCH',
        'ALIBABA_IOP_PHOTO_SCOPE_MISMATCH',
        value.request_id,
        credentials,
        'ALIBABA_IOP_PHOTO_SCOPE_MISMATCH'
      );
    if (
      items.length > pageSize ||
      (pagination.current_page !== undefined &&
        (!validTotal(pagination.current_page) || Number(pagination.current_page) !== page)) ||
      (pagination.page_size !== undefined &&
        (!validTotal(pagination.page_size) || Number(pagination.page_size) !== pageSize)) ||
      (pagination.total !== undefined &&
        (!validTotal(pagination.total) ||
          (items.length === 0 && Number(pagination.total) > (page - 1) * pageSize) ||
          (items.length > 0 && Number(pagination.total) < (page - 1) * pageSize + items.length)))
    )
      throw failure();
    const next = pagination.has_next_page;
    if (next !== undefined) {
      if (next !== true && next !== false && next !== 'true' && next !== 'false') throw failure();
      const hasNext = next === true || next === 'true';
      if (
        pagination.total !== undefined
          ? hasNext !== page * pageSize < Number(pagination.total)
          : hasNext && items.length < pageSize
      )
        throw failure();
    }
  }
  if (
    (method.includes('schema.render') ||
      method.endsWith('schema.get') ||
      method.endsWith('schema.level.get')) &&
    (!success || typeof result.data !== 'string' || !result.data.trim())
  )
    throw failure();
  let normalized = result;
  if (method === PHOTO_UPLOAD) {
    const image = result.response_object;
    if (
      !isRecord(image) ||
      !validTotal(image.file_id) ||
      Number(image.file_id) <= 0 ||
      typeof image.photobank_url !== 'string' ||
      !image.photobank_url.trim()
    )
      throw failure();
    normalized = {
      ...result,
      upload_image_response: { ...image, photobank_url: uploadedPhotoUrl(image.photobank_url) }
    };
  } else if (method === PHOTO_GROUP) {
    if (!success) throw failure();
    if (result.photobank_group !== undefined && !isRecord(result.photobank_group)) throw failure();
  } else if (inventory) {
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
  } else if (method.startsWith('alibaba.icbu.product.schema.') && getIopMethod(method)?.risk === 'mutation') {
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
  } else if (method === PRODUCT_TYPES) {
    if (result.msg_code !== undefined && result.msg_code !== '')
      throw providerFailure(
        result.msg_code,
        result.message_info,
        result.trace_id ?? value.request_id,
        credentials
      );
    if (
      result.success !== true ||
      !isRecord(result.data) ||
      typeof result.data.supportPostWholeSale !== 'boolean' ||
      typeof result.data.supportPostSourcing !== 'boolean' ||
      (result.message_info !== undefined && typeof result.message_info !== 'string') ||
      (result.trace_id !== undefined && typeof result.trace_id !== 'string')
    )
      throw failure();
    normalized = {
      biz_success: true,
      data: {
        support_post_whole_sale: result.data.supportPostWholeSale,
        support_post_sourcing: result.data.supportPostSourcing
      },
      ...(result.message_info === undefined ? {} : { message: result.message_info }),
      ...(result.trace_id === undefined ? {} : { trace_id: result.trace_id }),
      ...(result.msg_code === undefined ? {} : { msg_code: result.msg_code }),
      ...(typeof value.request_id === 'string' ? { request_id: value.request_id } : {})
    };
  }
  return { [`${method.replaceAll('.', '_')}_response`]: normalized };
}

function uploadedPhotoUrl(value: string): string {
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !['alicdn.com', 'alibaba.com'].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
      )
    )
      throw failure();
    url.protocol = 'https:';
    return url.href;
  } catch {
    throw failure();
  }
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
    ...(typeof trace === 'string' &&
    /^[\w-]{1,128}$/u.test(trace) &&
    ![credentials.appKey, credentials.appSecret, credentials.accessToken].some(
      (secret) => secret && trace.includes(secret)
    )
      ? { traceId: trace }
      : {})
  });
}
