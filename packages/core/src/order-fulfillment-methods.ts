/** Native IOP paths only. TOP equivalents and account permissions are not inferred. */
export const FULFILLMENT_READ_METHODS = {
  warehouses: '/warehouse/list',
  ggsWarehouses: '/alibaba/ggs/warehouse/list',
  basicFreight: '/shipping/freight/calculate',
  advancedFreight: '/order/freight/calculate',
  tracking: '/order/logistics/tracking/get'
} as const;
export type FulfillmentReadMethod = (typeof FULFILLMENT_READ_METHODS)[keyof typeof FULFILLMENT_READ_METHODS];
export const ORDER_ATTACHMENT_METHOD = '/alibaba/order/attachment/upload';
const reads = new Set<string>(Object.values(FULFILLMENT_READ_METHODS));
export function isFulfillmentReadMethod(value: unknown): value is FulfillmentReadMethod {
  return typeof value === 'string' && reads.has(value);
}
export function isFulfillmentMethod(
  value: unknown
): value is FulfillmentReadMethod | typeof ORDER_ATTACHMENT_METHOD {
  return isFulfillmentReadMethod(value) || value === ORDER_ATTACHMENT_METHOD;
}
