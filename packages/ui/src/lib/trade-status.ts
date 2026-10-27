import { translateUi } from '../i18n';

// Domain values follow the bundled Alibaba trade API snapshot. Presentation
// normalization never changes a DTO or a status sent as a request filter.
const orderStatusKeys: Readonly<Record<string, string>> = {
  unpay: 'orders.filters.unpay',
  paying: 'orders.statuses.order.paying',
  paid: 'orders.filters.paid',
  relating: 'orders.statuses.order.relating',
  captured: 'orders.statuses.order.captured',
  undeliver: 'orders.filters.undeliver',
  delivering: 'orders.filters.delivering',
  wait_confirm_receipt: 'orders.statuses.order.waitConfirmReceipt',
  intention_processing: 'orders.statuses.order.intentionProcessing',
  trade_close: 'orders.filters.closed',
  trade_success: 'orders.filters.success',
  wait_confirm_modify: 'orders.statuses.order.waitConfirmModify',
  trade_unavailable: 'orders.statuses.order.tradeUnavailable',
  charge_back: 'orders.statuses.order.chargeBack',
  frozen: 'orders.statuses.order.frozen'
};

const paymentStatusKeys: Readonly<Record<string, string>> = {
  unpay: 'orders.statuses.payment.unpay',
  paying: 'orders.statuses.payment.paying',
  paid: 'orders.statuses.payment.paid',
  captured: 'orders.statuses.payment.captured',
  relating: 'orders.statuses.payment.relating',
  fulfilled: 'orders.statuses.payment.fulfilled',
  failed: 'orders.statuses.payment.failed',
  canceled: 'orders.statuses.payment.canceled',
  closed: 'orders.statuses.payment.closed'
};

const logisticsStatusKeys: Readonly<Record<string, string>> = {
  undelivered: 'orders.statuses.logistics.undelivered',
  delivering: 'orders.statuses.logistics.delivering',
  part_delivered: 'orders.statuses.logistics.partDelivered',
  delivered: 'orders.statuses.logistics.delivered',
  confirm_receipt: 'orders.statuses.logistics.confirmReceipt'
};

function statusLabel(status: string | null | undefined, keys: Readonly<Record<string, string>>): string {
  const code = status?.trim() ?? '';
  const normalized = code.toLowerCase();
  if (!normalized || normalized === 'unknown') return translateUi('orders.statuses.unknown');
  const key = Object.hasOwn(keys, normalized) ? keys[normalized] : undefined;
  return key ? translateUi(key) : translateUi('orders.statuses.unknownCode', { code });
}

export function tradeOrderStatusLabel(status: string | null | undefined): string {
  return statusLabel(status, orderStatusKeys);
}

export function tradePaymentStatusLabel(status: string | null | undefined): string {
  // The fund adapter joins independent payment-record statuses with commas.
  const codes = (status ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);
  return codes.length
    ? codes.map((code) => statusLabel(code, paymentStatusKeys)).join(translateUi('orders.statuses.separator'))
    : translateUi('orders.statuses.unknown');
}

export function tradeLogisticsStatusLabel(status: string | null | undefined): string {
  return statusLabel(status, logisticsStatusKeys);
}
