import type { AlibabaClient } from './alibaba-client';
import { isRecord } from './alibaba-iop';
import { GatewayException } from './errors';
import type { IopPublicOrderDetail } from './types';

/** Public IOP detail, deliberately separate from TOP/Jushita and fund/payment DTOs. */
export async function getIopPublicOrderDetail(
  client: Pick<AlibabaClient, 'call'>,
  orderId: string,
  language: 'zh_CN' | 'en_US' = 'en_US'
): Promise<IopPublicOrderDetail> {
  const response = await client.call('/alibaba/order/get', { e_trade_id: orderId, language });
  const raw = isRecord(response.data) ? response.data.value : undefined;
  if (!isRecord(raw) || raw.trade_id !== orderId) throw invalid();
  if (raw.buyer !== undefined && raw.buyer !== null && !isRecord(raw.buyer)) throw invalid();
  if (
    raw.order_products !== undefined &&
    raw.order_products !== null &&
    (!Array.isArray(raw.order_products) || raw.order_products.length > 500)
  )
    throw invalid();
  return {
    source: 'iop-public',
    orderId,
    status: text(raw.trade_status, 128),
    buyerName: isRecord(raw.buyer) ? text(raw.buyer.full_name) : null,
    totalAmount: money(raw.total_amount),
    products:
      raw.order_products === undefined || raw.order_products === null
        ? null
        : (raw.order_products as unknown[]).map((line) => {
            if (!isRecord(line)) throw invalid();
            return {
              lineId: text(line.id, 128),
              productId: productId(line.product_id),
              name: text(line.name),
              quantity: decimal(line.quantity),
              unit: text(line.unit, 128),
              unitPrice: money(line.unit_price)
            };
          })
  };
}

function invalid(): GatewayException {
  return new GatewayException({
    code: 'ALIBABA_IOP_RESPONSE_INVALID',
    message: 'ALIBABA_IOP_RESPONSE_INVALID',
    retryable: false
  });
}
function text(value: unknown, max = 4096): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > max || /\p{Cc}/u.test(value)) throw invalid();
  return value.trim() ? value : null;
}
function decimal(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 128 || !/^-?\d+(?:\.\d+)?$/u.test(value)) throw invalid();
  return value;
}
function money(value: unknown): IopPublicOrderDetail['totalAmount'] {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw invalid();
  const amount = decimal(value.amount);
  const currency = text(value.currency, 16);
  if (amount === null || currency === null) throw invalid();
  return { amount, currency };
}
function productId(value: unknown): string | null {
  if (value === undefined || value === null || value === 0 || value === '0') return null;
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 1)) throw invalid();
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^[1-9][0-9]*$/u.test(String(value)) ||
    String(value).length > 128
  )
    throw invalid();
  return String(value);
}
