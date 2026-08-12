import type { AlibabaClient } from './alibaba-client';
import type {
  RequestOf,
  TradeAddress,
  TradeAddressSchema,
  TradeFulfillmentChannel,
  TradeFund,
  TradeLogistics,
  TradeOrderAggregate,
  TradeOrderPage,
  TradeOrderSummary,
  TradeServiceCharge,
  TradeTtAccount
} from './types';

export class TradeAdapter {
  constructor(private readonly client: Pick<AlibabaClient, 'call'>) {}

  async list(request: RequestOf<'listTradeOrders'>): Promise<TradeOrderPage> {
    const page = request.page ?? 1;
    const pageSize = Math.min(request.pageSize ?? 20, 100);
    const call = await this.client.call('alibaba.seller.order.list', {
      param_trade_ecology_order_list_query: {
        role: 'seller',
        start_page: page - 1,
        page_size: pageSize,
        ...(request.status ? { status: request.status } : {}),
        ...(request.buyerLoginId ? { other_login_id: request.buyerLoginId } : {}),
        ...(request.createDateStart ? { create_date_start: { date_str: request.createDateStart } } : {}),
        ...(request.createDateEnd ? { create_date_end: { date_str: request.createDateEnd } } : {}),
        ...(request.modifiedDateStart
          ? { modified_date_start: { date_str: request.modifiedDateStart } }
          : {}),
        ...(request.modifiedDateEnd ? { modified_date_end: { date_str: request.modifiedDateEnd } } : {})
      }
    });
    const root = unwrap(call.data, call.method);
    const value = findRecord(root, ['value']) ?? root;
    const records = findRecords(value, ['order_list']);
    return {
      items: records.map(normalizeOrder),
      page,
      pageSize,
      total: readInteger(value, ['total_count']) ?? records.length,
      // The official text says "US time" but does not identify a precise IANA zone.
      documentTimeZoneUnverified: true
    };
  }

  async getFund(orderId: string): Promise<TradeFund> {
    const call = await this.client.call('alibaba.seller.order.fund.get', {
      e_trade_id: orderId,
      data_select: 'fund_serviceFee,fund_fundPay,fund_refund'
    });
    const root = findRecord(unwrap(call.data, call.method), ['value']) ?? {};
    const payments = findRecords(root, ['fund_pay_list']);
    const settled = payments.filter((payment) =>
      ['PAID', 'CAPTURED', 'FULFILLED'].includes((readString(payment, ['pay_status']) ?? '').toUpperCase())
    );
    const amounts = settled.map((payment) => {
      const received = findRecordAt(payment, 'receive_amount');
      const paid = findRecordAt(payment, 'pay_amount');
      return readString(received ?? paid ?? {}, ['amount']) ?? '0';
    });
    const currency = firstNestedString(settled, ['receive_amount', 'pay_amount'], ['currency']) ?? 'USD';
    const statuses = [
      ...new Set(payments.map((payment) => readString(payment, ['pay_status'])).filter(Boolean))
    ];
    return {
      orderId,
      paidAmount: sumDecimals(amounts),
      currency,
      status: statuses.length > 0 ? statuses.join(', ') : 'unknown'
    };
  }

  async getLogistics(orderId: string): Promise<TradeLogistics> {
    const call = await this.client.call('alibaba.seller.order.logistics.get', {
      e_trade_id: orderId,
      data_select: 'logistic_order'
    });
    const root = findRecord(unwrap(call.data, call.method), ['value']) ?? {};
    const shipments = findRecords(root, ['shipping_order_list']);
    const first = shipments[0] ?? {};
    return {
      orderId,
      status: readString(root, ['logistic_status']) ?? 'unknown',
      carrier: readStringDeep(first, ['carrier', 'logistics_company']) ?? null,
      trackingNumber: readStringDeep(first, ['tracking_number', 'logistics_no', 'logistic_order_no']) ?? null
    };
  }

  async getAggregate(order: TradeOrderSummary): Promise<TradeOrderAggregate> {
    const [fund, logistics] = await Promise.allSettled([this.getFund(order.id), this.getLogistics(order.id)]);
    return {
      order,
      fund: fund.status === 'fulfilled' ? fund.value : null,
      logistics: logistics.status === 'fulfilled' ? logistics.value : null,
      availability: {
        order: 'available',
        fund: fund.status === 'fulfilled' ? 'available' : 'unavailable',
        logistics: logistics.status === 'fulfilled' ? 'available' : 'unavailable',
        fullDetail: 'jushita-only'
      }
    };
  }

  async listFulfillmentChannels(language = 'en_US'): Promise<TradeFulfillmentChannel[]> {
    const call = await this.client.call('alibaba.trade.fulfillment.channel.get', { language });
    const root = findRecord(unwrap(call.data, call.method), ['value']) ?? {};
    return findRecords(root, ['support_fulfillment_channels']).map((channel) => ({
      code: readString(channel, ['name', 'code']) ?? 'unknown',
      name: readString(channel, ['name']) ?? 'Unknown channel',
      enabled: readBoolean(channel, ['enable']) ?? false,
      unavailableReason: readString(channel, ['message']) ?? null
    }));
  }

  async getServiceCharge(currency: string): Promise<TradeServiceCharge> {
    const call = await this.client.call('alibaba.trade.service.charge.get', { currency });
    const root = findRecord(unwrap(call.data, call.method), ['result']) ?? {};
    return {
      currency,
      items: findRecords(root, ['servcecharge_list']).map((item) => ({
        ratio: readString(item, ['ratio']) ?? null,
        maxFee: readString(item, ['max_fee']) ?? null,
        exportServiceType: readString(item, ['export_service_type']) ?? null,
        logisticsType: readString(item, ['logistics_type']) ?? null
      }))
    };
  }

  async getTtAccount(orderId: string): Promise<TradeTtAccount> {
    const call = await this.client.call('alibaba.order.trade.tt.get', { e_trade_id: orderId });
    const root = findRecord(unwrap(call.data, call.method), ['value']) ?? {};
    const amount = findRecordAt(root, 'pay_amount') ?? {};
    const account = findRecordAt(root, 'default_tt_account') ?? {};
    return {
      orderId,
      payableAmount: readString(amount, ['amount']) ?? '0',
      currency: readString(amount, ['currency']) ?? readString(account, ['currency']) ?? 'USD',
      accountName: readString(account, ['beneficiary_name']) ?? null,
      accountNumber: readString(account, ['beneficiary_account_no']) ?? null,
      bankName: readString(account, ['beneficiary_bank']) ?? null,
      guideContent: readString(root, ['guide_content', 'remark']) ?? null
    };
  }

  async getAddressSchema(countryCode: string, language = 'en_US'): Promise<TradeAddressSchema> {
    const call = await this.client.call('alibaba.trade.address.schema.query', {
      param_address_localization_form_query: {
        dest_country_code: countryCode,
        language
      }
    });
    const root = unwrap(call.data, call.method);
    const forms = findRecords(root, ['forms']);
    const form = forms.find((item) => readString(item, ['country_code']) === countryCode) ?? forms[0] ?? {};
    return {
      fields: findRecords(form, ['form_fields'])
        .sort((left, right) => (readInteger(left, ['order']) ?? 0) - (readInteger(right, ['order']) ?? 0))
        .map((field) => {
          const rule = findRecordAt(field, 'rule') ?? {};
          const regularExpression = findRecords(rule, ['reg_exps'])[0];
          return {
            id: readString(field, ['field_key']) ?? '',
            label: readString(field, ['field_label']) ?? readString(field, ['field_key']) ?? 'Field',
            type: readString(field, ['fill_type']) === 'drop_down' ? 'select' : 'text',
            required: readBoolean(rule, ['require_not_null']) ?? false,
            readOnly: false,
            pattern: regularExpression ? (readString(regularExpression, ['reg_exp']) ?? null) : null,
            maxLength: null,
            options: []
          };
        })
    };
  }

  async listAddresses(buyerEmail: string): Promise<TradeAddress[]> {
    const call = await this.client.call('alibaba.trade.address.list.query', {
      buyer_email: buyerEmail
    });
    const root = unwrap(call.data, call.method);
    return findRecords(root, ['value']).map((address) => {
      const values = flattenValues(address);
      return {
        id: readString(address, ['address_id']) ?? '',
        label:
          readString(address, ['contact_person']) ??
          values['address.address'] ??
          values['address.city'] ??
          '地址',
        values
      };
    });
  }

  async saveAddress(request: RequestOf<'saveTradeAddress'>): Promise<TradeAddress> {
    const contactAddress = inflateValues(request.address.values);
    contactAddress.buyer_email = request.buyerEmail;
    if (request.address.id) contactAddress.address_id = numericOrString(request.address.id);
    const call = await this.client.call('alibaba.trade.address.form.save', {
      contact_address: contactAddress
    });
    const root = unwrap(call.data, call.method);
    return {
      ...request.address,
      id: readString(root, ['address_id']) ?? request.address.id
    };
  }

  async deleteAddress(addressId: string): Promise<void> {
    await this.client.call('alibaba.trade.address.delete', {
      address_id: numericOrString(addressId)
    });
  }
}

function normalizeOrder(record: Record<string, unknown>): TradeOrderSummary {
  const total = findRecordDeep(record, ['total_amount', 'order_amount', 'amount']);
  return {
    id: readString(record, ['trade_id', 'e_trade_id', 'order_id']) ?? '',
    buyerLoginId: readString(record, ['other_login_id', 'buyer_login_id', 'buyer_name']) ?? null,
    status: readString(record, ['status', 'order_status']) ?? 'unknown',
    amount: total ? (readString(total, ['amount', 'value']) ?? '0') : '0',
    currency: total ? (readString(total, ['currency']) ?? 'USD') : 'USD',
    createdAt: readDate(record, ['create_date', 'gmt_create', 'create_time']),
    modifiedAt: readDate(record, ['modify_date', 'gmt_modified', 'modified_time'])
  };
}

function unwrap(value: unknown, method: string): Record<string, unknown> {
  const record = asRecord(value);
  return asRecord(record[`${method.replaceAll('.', '_')}_response`] ?? record);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findRecordAt(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return isRecord(record[key]) ? record[key] : null;
}

function findRecord(record: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  return findRecordDeep(record, keys);
}

function findRecordDeep(record: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  const visit = (value: unknown, depth: number): Record<string, unknown> | null => {
    if (depth > 7 || !isRecord(value)) return null;
    for (const key of keys) if (isRecord(value[key])) return value[key];
    for (const child of Object.values(value)) {
      const result = visit(child, depth + 1);
      if (result) return result;
    }
    return null;
  };
  return visit(record, 0);
}

function findRecords(record: Record<string, unknown>, keys: string[]): Record<string, unknown>[] {
  const visit = (value: unknown, depth: number): Record<string, unknown>[] | null => {
    if (depth > 7) return null;
    if (Array.isArray(value) && value.every(isRecord)) return value;
    if (!isRecord(value)) return null;
    for (const key of keys) {
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

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function readStringDeep(record: Record<string, unknown>, keys: string[]): string | undefined {
  const direct = readString(record, keys);
  if (direct !== undefined) return direct;
  for (const child of Object.values(record)) {
    if (!isRecord(child)) continue;
    const value = readStringDeep(child, keys);
    if (value !== undefined) return value;
  }
  return undefined;
}

function readInteger(record: Record<string, unknown>, keys: string[]): number | undefined {
  const value = readString(record, keys);
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isInteger(number) ? number : undefined;
}

function readBoolean(record: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return undefined;
}

function readDate(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) {
      const timestamp = readString(value, ['timestamp', 'time_stamp']);
      if (timestamp) return epochToIso(timestamp);
      const formatted = readString(value, ['format_date']);
      if (formatted) return parseDate(formatted);
    }
    if (typeof value === 'string' || typeof value === 'number') return parseDate(String(value));
  }
  return null;
}

function epochToIso(value: string): string | null {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseDate(value: string): string | null {
  if (/^\d+$/.test(value)) return epochToIso(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstNestedString(
  records: Record<string, unknown>[],
  objectKeys: string[],
  valueKeys: string[]
): string | undefined {
  for (const record of records) {
    for (const objectKey of objectKeys) {
      const nested = findRecordAt(record, objectKey);
      if (!nested) continue;
      const value = readString(nested, valueKeys);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function sumDecimals(values: string[]): string {
  const decimals = values.map((value) => value.trim()).filter((value) => /^-?\d+(?:\.\d+)?$/.test(value));
  if (decimals.length === 0) return '0';
  const scale = Math.max(...decimals.map((value) => value.split('.')[1]?.length ?? 0));
  const factor = 10n ** BigInt(scale);
  const total = decimals.reduce((sum, value) => {
    const negative = value.startsWith('-');
    const unsigned = negative ? value.slice(1) : value;
    const [integer = '0', fraction = ''] = unsigned.split('.');
    const scaled = BigInt(integer) * factor + BigInt(fraction.padEnd(scale, '0') || '0');
    return sum + (negative ? -scaled : scaled);
  }, 0n);
  const sign = total < 0n ? '-' : '';
  const absolute = total < 0n ? -total : total;
  if (scale === 0) return `${sign}${absolute}`;
  const integer = absolute / factor;
  const fraction = String(absolute % factor)
    .padStart(scale, '0')
    .replace(/0+$/, '');
  return fraction ? `${sign}${integer}.${fraction}` : `${sign}${integer}`;
}

function flattenValues(record: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (value: unknown, path: string): void => {
    if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
      return;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[path] = String(value);
    }
  };
  visit(record, '');
  return result;
}

function inflateValues(values: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(values)) {
    const parts = path.split('.').filter(Boolean);
    let target = result;
    for (const [index, part] of parts.entries()) {
      if (index === parts.length - 1) {
        target[part] = value;
      } else {
        const next = target[part];
        if (!isRecord(next)) target[part] = {};
        target = asRecord(target[part]);
      }
    }
  }
  return result;
}

function numericOrString(value: string): number | string {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
}
