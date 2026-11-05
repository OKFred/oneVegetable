import { authorizeCapabilityCall } from './capability-policy';
import { GatewayException } from './errors';
import {
  FULFILLMENT_READ_METHODS as methods,
  isFulfillmentReadMethod,
  type FulfillmentReadMethod
} from './order-fulfillment-methods';
import type { GatewayClient } from './types';

export type { FulfillmentReadMethod } from './order-fulfillment-methods';

function fail(code: string, traceId?: string): never {
  throw new GatewayException({ code, message: code, retryable: false, ...(traceId ? { traceId } : {}) });
}
function object(value: unknown, code: string, allowed?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(code);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    (allowed && Object.keys(value).some((key) => !allowed.includes(key)))
  )
    return fail(code);
  return value as Record<string, unknown>;
}
function text(value: unknown): boolean {
  return typeof value === 'string' && !!value.trim() && !/\p{Cc}/u.test(value);
}
function integer(value: unknown, minimum = 1): boolean {
  return typeof value === 'number'
    ? Number.isSafeInteger(value) && value >= minimum
    : typeof value === 'string' && (minimum ? /^[1-9]\d*$/u : /^(?:0|[1-9]\d*)$/u).test(value);
}
const requestError = 'REQUEST_CONTRACT_INVALID';

/** Exact native business parameters; no transport keys, defaults, ID coercion or SKU guessing. */
export function validateFulfillmentReadParameters(
  method: FulfillmentReadMethod,
  input: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  if (!isFulfillmentReadMethod(method)) return fail('ALIBABA_IOP_METHOD_UNSUPPORTED');
  const keys =
    method === methods.warehouses
      ? ['product_id', 'country_code', 'current_page']
      : method === methods.ggsWarehouses
        ? ['product_id', 'page_size', 'current_page']
        : method === methods.basicFreight
          ? [
              'destination_country',
              'product_id',
              'quantity',
              'zip_code',
              'dispatch_location',
              'enable_distribution_waybill'
            ]
          : method === methods.advancedFreight
            ? [
                'e_company_id',
                'address',
                'destination_country',
                'logistics_product_list',
                'dispatch_location',
                'enable_distribution_waybill'
              ]
            : ['trade_id'];
  const value = object(input, requestError, keys);
  const required =
    method === methods.warehouses
      ? ['product_id']
      : method === methods.ggsWarehouses
        ? ['product_id', 'page_size', 'current_page']
        : method === methods.basicFreight
          ? ['destination_country', 'product_id', 'quantity']
          : method === methods.advancedFreight
            ? ['e_company_id', 'destination_country', 'logistics_product_list']
            : ['trade_id'];
  if (required.some((key) => !Object.hasOwn(value, key))) return fail(requestError);
  for (const [key, item] of Object.entries(value)) {
    if (['product_id', 'trade_id', 'page_size', 'current_page', 'quantity'].includes(key)) {
      if (!integer(item)) return fail(requestError);
    } else if (key === 'enable_distribution_waybill') {
      if (typeof item !== 'boolean') return fail(requestError);
    } else if (key === 'logistics_product_list') {
      if (!Array.isArray(item) || !item.length) return fail(requestError);
      for (const row of item) {
        const product = object(row, requestError, ['product_id', 'quantity', 'sku_id']);
        if (
          !integer(product.product_id) ||
          !integer(product.quantity) ||
          (Object.hasOwn(product, 'sku_id') && !integer(product.sku_id))
        )
          return fail(requestError);
      }
    } else if (key === 'address') {
      const address = object(item, requestError, ['address', 'city', 'country', 'province', 'zip']);
      for (const [field, part] of Object.entries(address)) {
        if (['city', 'country', 'province'].includes(field)) {
          const location = object(part, requestError, ['code', 'name']);
          if (Object.values(location).some((leaf) => !text(leaf))) return fail(requestError);
        } else if (!text(part)) return fail(requestError);
      }
    } else if (!text(item)) return fail(requestError);
  }
  // Snapshot the actual payload before awaiting context selection; callers may edit their form meanwhile.
  return structuredClone(value);
}
const responseError = 'FULFILLMENT_READ_RESPONSE_INVALID';
function strings(row: Record<string, unknown>, fields: readonly string[], required: boolean): void {
  for (const field of fields) {
    if (
      (!Object.hasOwn(row, field) && required) ||
      (Object.hasOwn(row, field) && typeof row[field] !== 'string')
    )
      fail(responseError);
  }
}
function counts(row: Record<string, unknown>, fields: readonly string[]): void {
  for (const field of fields)
    if (!integer(row[field], field === 'current_page' || field === 'page_size' ? 1 : 0)) fail(responseError);
}
function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return fail(responseError);
  return value.map((item) => object(item, responseError));
}
function safeCode(value: unknown, fallback: string): string {
  const code = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof code === 'string' && /^[A-Za-z0-9_.;:-]{1,160}$/u.test(code) ? code : fallback;
}
export interface FulfillmentReadResult {
  method: string;
  traceId: string;
  data: Record<string, unknown>;
}

/** Validate native shapes without reducing failures to empty lists or inventing money/units. */
export function parseFulfillmentReadResponse(
  method: FulfillmentReadMethod,
  input: unknown,
  envelopeTraceId = ''
): FulfillmentReadResult {
  if (!isFulfillmentReadMethod(method)) return fail('ALIBABA_IOP_METHOD_UNSUPPORTED');
  let traceId = envelopeTraceId;
  try {
    const data = object(input, responseError);
    traceId = typeof data.request_id === 'string' && data.request_id ? data.request_id : envelopeTraceId;
    if (data.code === undefined || (typeof data.code !== 'string' && typeof data.code !== 'number'))
      return fail(responseError);
    if (typeof data.code === 'number' && !Number.isSafeInteger(data.code)) return fail(responseError);
    if (data.code !== '0' && data.code !== 0)
      return fail(safeCode(data.code, 'FULFILLMENT_READ_BUSINESS_FAILED'));
    if (Object.hasOwn(data, 'request_id') && typeof data.request_id !== 'string') return fail(responseError);
    if (data.success === false || data.biz_success === false) return fail('FULFILLMENT_READ_BUSINESS_FAILED');
    if (method === methods.warehouses) {
      const page = object(data.response, responseError);
      counts(page, ['total', 'page_size', 'current_page']);
      for (const row of rows(page.records)) {
        if (!integer(row.warehouse_id)) return fail(responseError);
        strings(row, ['zip_code', 'country', 'address', 'city', 'country_code', 'name', 'state'], true);
      }
    } else if (method === methods.ggsWarehouses) {
      const page = object(data.result, responseError);
      if (page.success === false) return fail(safeCode(page.code, 'FULFILLMENT_READ_BUSINESS_FAILED'));
      // The public example incorrectly says success:"success"; the Boolean field definition wins.
      if (page.success !== true) return fail(responseError);
      // shortcut: only example code 200 is admitted; widen after documented account acceptance.
      if (page.code !== '200') return fail(safeCode(page.code, 'FULFILLMENT_READ_BUSINESS_FAILED'));
      strings(page, ['code', 'message'], true);
      counts(page, ['total', 'total_page', 'page_size', 'current_page']);
      for (const row of rows(page.data))
        strings(
          row,
          [
            'id',
            'gmt_create',
            'gmt_modified',
            'warehouse_code',
            'warehouse_name',
            'warehouse_type',
            'warehouse_status',
            'deleted',
            'warehouse_address',
            'warehouse_province',
            'warehouse_city',
            'warehouse_country',
            'zip_code',
            'warehouse_contact',
            'warehouse_phone_number',
            'ali_member_id'
          ],
          false
        );
    } else if (method === methods.tracking) {
      for (const row of rows(data.tracking_list)) {
        strings(row, ['carrier', 'tracking_url', 'current_event_code', 'tracking_number'], true);
        for (const event of rows(row.event_list))
          strings(event, ['event_code', 'event_location', 'event_time', 'event_name'], true);
      }
    } else {
      const required = method === methods.advancedFreight;
      for (const row of rows(data.value)) {
        strings(
          row,
          [
            'shipping_type',
            'trade_term',
            'dispatch_country',
            'destination_country',
            'vendor_code',
            'vendor_name',
            'delivery_time'
          ],
          required
        );
        strings(row, ['solution_biz_type', ...(required ? ['store_type'] : [])], false);
        if (Object.hasOwn(row, 'fee') || required) {
          const fee = object(row.fee, responseError);
          strings(fee, ['currency', 'amount'], required);
        }
      }
    }
    return { method, traceId, data };
  } catch (error) {
    if (error instanceof GatewayException) return fail(error.gatewayError.code, traceId);
    throw error;
  }
}

/** No automatic calls, retry, protocol fallback, cache or storage. The caller owns lifetime. */
export class OrderFulfillmentReadClient {
  private epoch = 0;
  private alive = true;
  constructor(
    private readonly gateway: GatewayClient,
    private readonly boundary: () => string = () => ''
  ) {}
  invalidate(): void {
    this.epoch++;
  }
  dispose(): void {
    this.alive = false;
    this.invalidate();
  }

  async query(
    method: FulfillmentReadMethod,
    parameters: Record<string, unknown>
  ): Promise<FulfillmentReadResult> {
    const epoch = this.epoch;
    const boundary = this.boundary();
    const assertCurrent = () => {
      if (!this.alive || epoch !== this.epoch || boundary !== this.boundary())
        fail('FULFILLMENT_CONTEXT_CHANGED');
    };
    assertCurrent();
    const payload = { method, parameters: validateFulfillmentReadParameters(method, parameters) };
    const policy = authorizeCapabilityCall(payload);
    if (!policy.allowed) return fail(policy.reasonCode);
    if (!this.gateway.galleryTransferContext) return fail('ALIBABA_IOP_AUTHORIZATION_REQUIRED');
    const context = { ...(await this.gateway.galleryTransferContext('callCapability', payload)) };
    assertCurrent();
    const response = await this.gateway.request('callCapability', payload, { galleryContext: context });
    assertCurrent();
    const current = await this.gateway.galleryTransferContext('callCapability', payload);
    assertCurrent();
    if (context.identity !== current.identity || context.gateway !== current.gateway)
      return fail('FULFILLMENT_CONTEXT_CHANGED');
    const envelope = object(response, responseError);
    if (envelope.method !== method || envelope.contractValid !== true || typeof envelope.traceId !== 'string')
      return fail(responseError, typeof envelope.traceId === 'string' ? envelope.traceId : undefined);
    return parseFulfillmentReadResponse(method, envelope.data, envelope.traceId);
  }
}
