import { GatewayException } from './errors';
import { IOP_BUSINESS_ENDPOINT, isRecord, signIopRequest } from './alibaba-iop';
import { serializeAlibabaParameters } from './signing';
import { assertAlibabaBusinessParameters } from './transport-security';
import type { GatewayCredentials, OperationId } from './types';

/** Explicit mappings, not method.replaceAll('.', '/'). Unmapped methods never go to TOP. */
const READ_PATHS: Readonly<Record<string, `/alibaba/${string}` | `/icbu/${string}`>> = {
  'alibaba.icbu.product.list': '/alibaba/icbu/product/list',
  'alibaba.icbu.product.group.get': '/alibaba/icbu/product/group/get',
  'alibaba.icbu.product.schema.render': '/icbu/product/schema/render',
  'alibaba.icbu.product.schema.render.draft': '/icbu/product/schema/render/draft',
  'alibaba.icbu.photobank.group.list': '/icbu/product/photobank/group/list',
  'alibaba.icbu.photobank.list': '/icbu/product/photobank/list'
};

export function iopOperationReason(operation: OperationId, method?: unknown): string | null {
  if (operation === 'callCapability')
    return typeof method === 'string' && Object.hasOwn(READ_PATHS, method)
      ? null
      : 'ALIBABA_IOP_METHOD_UNSUPPORTED';
  return [
    'getDashboard',
    'listCapabilities',
    'getCapabilityDefinition',
    'listProducts',
    'getProduct',
    'getProductSummary',
    'getProductGroups',
    'renderProductSchema',
    'getProductDraft',
    'getPhotoGroups',
    'listPhotos'
  ].includes(operation)
    ? null
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
  const path = READ_PATHS[method];
  if (!path) throw failure('ALIBABA_IOP_METHOD_UNSUPPORTED');
  let business: Readonly<Record<string, unknown>> = input;
  if (method.startsWith('alibaba.icbu.product.schema.render')) {
    const request = input.param_product_top_publish_request;
    if (!isRecord(request)) throw failure('REQUEST_CONTRACT_INVALID');
    business = { render_request: request };
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
    access_token: credentials.accessToken,
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
  if (!isRecord(value) || (typeof value.code !== 'number' && typeof value.code !== 'string'))
    throw failure('ALIBABA_IOP_RESPONSE_INVALID');
  if (value.code !== '0' && value.code !== 0)
    throw providerFailure(value.code, value.message, value.request_id, credentials);
  const result = value.result;
  if (!isRecord(result)) throw failure('ALIBABA_IOP_RESPONSE_INVALID');
  if (
    (result.error_code !== undefined &&
      result.error_code !== '' &&
      result.error_code !== '0' &&
      result.error_code !== 0) ||
    result.success === false ||
    result.success === 'false'
  )
    throw providerFailure(
      result.error_code ?? result.msg_code ?? 'BUSINESS_REJECTED',
      result.error_msg ?? result.msg,
      result.trace_id ?? value.request_id,
      credentials
    );
  if (method === 'alibaba.icbu.product.list' && (!records(result.products) || !validTotal(result.total_item)))
    throw failure('ALIBABA_IOP_RESPONSE_INVALID');
  if (method === 'alibaba.icbu.product.group.get' && !isRecord(result.product_group))
    throw failure('ALIBABA_IOP_RESPONSE_INVALID');
  if (method === 'alibaba.icbu.photobank.group.list' && !records(result.groups))
    throw failure('ALIBABA_IOP_RESPONSE_INVALID');
  if (
    method === 'alibaba.icbu.photobank.list' &&
    (!isRecord(result.pagination_query_list) || !records(result.pagination_query_list.list))
  )
    throw failure('ALIBABA_IOP_RESPONSE_INVALID');
  if (
    method.startsWith('alibaba.icbu.product.schema.render') &&
    ((result.success !== true && result.success !== 'true') ||
      typeof result.data !== 'string' ||
      !result.data.trim())
  )
    throw failure('ALIBABA_IOP_RESPONSE_INVALID');
  return { [`${method.replaceAll('.', '_')}_response`]: result };
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

function failure(code: string): GatewayException {
  return new GatewayException({ code, message: code, retryable: false });
}
function providerFailure(
  code: unknown,
  message: unknown,
  trace: unknown,
  credentials: GatewayCredentials
): GatewayException {
  const subCode = /^[\w.:-]{1,128}$/u.test(String(code)) ? String(code) : 'provider-rejected';
  let text = typeof message === 'string' ? message : 'ALIBABA_IOP_API_REJECTED';
  for (const secret of [credentials.appKey, credentials.appSecret, credentials.accessToken])
    if (secret) text = text.replaceAll(secret, '[redacted]');
  return new GatewayException({
    code: 'ALIBABA_IOP_API_REJECTED',
    subCode,
    message: text.replace(/[\r\n]/gu, ' ').slice(0, 300),
    retryable: false,
    ...(typeof trace === 'string' && /^[\w-]{1,128}$/u.test(trace) ? { traceId: trace } : {})
  });
}
