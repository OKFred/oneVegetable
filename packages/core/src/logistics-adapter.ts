import type { AlibabaClient } from './alibaba-client';
import type {
  LogisticsAddress,
  LogisticsAddressNode,
  LogisticsOrderDetail,
  LogisticsOrderMutationResult,
  LogisticsOrderPage,
  LogisticsOrderSummary,
  LogisticsProduct,
  LogisticsQuoteRequest,
  LogisticsQuoteResult,
  LogisticsSpecialProductType,
  RequestOf,
  ShippingTemplate
} from './types';
import { validateLogisticsOrderInput, validateLogisticsQuoteInput } from './validation';

export class LogisticsAdapter {
  constructor(private readonly client: Pick<AlibabaClient, 'call'>) {}

  async listAddressNodes(request: RequestOf<'listLogisticsAddressNodes'>): Promise<LogisticsAddressNode[]> {
    const method = addressMethod(request.level);
    const parameters =
      request.level === 'province'
        ? { country_code: requiredValue(request.countryCode, 'countryCode') }
        : request.level === 'city'
          ? { province_id: numericOrString(requiredValue(request.parentId, 'parentId')) }
          : request.level === 'division'
            ? { city_id: numericOrString(requiredValue(request.parentId, 'parentId')), with_children: false }
            : { search_text: requiredValue(request.searchText, 'searchText') };
    const call = await this.client.call(method, { param_query: parameters });
    const root = findRecord(unwrap(call.data, call.method), ['result']) ?? {};
    return findRecords(root, ['values']).map((item) => {
      const id = readString(item, ['area_id', 'id', 'code']) ?? '';
      return {
        id,
        code: readString(item, ['code', 'area_code', 'area_id']) ?? id,
        name: readString(item, ['name']) ?? '未命名地址',
        level: request.level
      };
    });
  }

  async listSpecialProductTypes(): Promise<LogisticsSpecialProductType[]> {
    const call = await this.client.call('alibaba.onetouch.logistics.express.special.product.type.list', {});
    const root = findRecord(unwrap(call.data, call.method), ['result']) ?? {};
    return findRecords(root, ['values']).map(normalizeSpecialProductType);
  }

  async listProducts(): Promise<LogisticsProduct[]> {
    const call = await this.client.call('alibaba.onetouch.logistics.express.logistics.product.list', {});
    const root = findRecord(unwrap(call.data, call.method), ['result']) ?? {};
    return findRecords(root, ['values']).map((item) => ({
      code: readString(item, ['product_code']) ?? '',
      name: readString(item, ['product_name']) ?? '未命名运力',
      warehouseCode: readString(item, ['warehouse_code']) ?? null,
      enabled: true,
      unavailableReason: null
    }));
  }

  async calculateQuote(request: LogisticsQuoteRequest): Promise<LogisticsQuoteResult> {
    const validation = validateLogisticsQuoteInput(request);
    if (!validation.valid) throw new Error(`物流试算参数不合法：${validation.errors.join('；')}`);
    const call = await this.client.call('alibaba.onetouch.logistics.express.charge.calculate', {
      paramn_query: placeOrderParameters(request)
    });
    const result = findRecord(unwrap(call.data, call.method), ['result']) ?? {};
    if (readBoolean(result, ['success']) === false) {
      return { options: [], issues: [readString(result, ['error_message']) ?? '运费试算失败'] };
    }
    const values = findRecordAt(result, 'values') ?? {};
    const quoteItems = findRecords(values, ['express_quote_item_list']);
    const amountRecord = quoteItems.flatMap((item) => {
      const amount = findRecordAt(item, 'sales_amount');
      return amount ? [amount] : [];
    })[0];
    return {
      options: [
        {
          productCode: request.productCode,
          productName: request.productCode,
          totalAmount:
            readString(values, ['sales_amount']) ?? readString(amountRecord ?? {}, ['amount']) ?? '0',
          currency:
            readString(amountRecord ?? {}, ['currency']) ??
            readString(quoteItems[0] ?? {}, ['currency']) ??
            request.customs.declarationCurrency,
          estimatedDays: null,
          warehouseCode: request.warehouseCode,
          available: true,
          unavailableReason: null
        }
      ],
      issues: []
    };
  }

  async listOrders(request: RequestOf<'listLogisticsOrders'>): Promise<LogisticsOrderPage> {
    const page = request.page ?? 1;
    const pageSize = Math.min(request.pageSize ?? 20, 100);
    const call = await this.client.call('alibaba.onetouch.logistics.express.order.list.query', {
      param_query: {
        current_page: page,
        page_size: pageSize,
        ...(request.orderNumber ? { order_number: request.orderNumber } : {})
      }
    });
    const result = findRecord(unwrap(call.data, call.method), ['result']) ?? {};
    const data = findRecordAt(result, 'data') ?? {};
    const records = findRecords(data, ['data_list']);
    return {
      items: records.map(normalizeOrder),
      page,
      pageSize,
      total: readInteger(data, ['total']) ?? records.length
    };
  }

  async getOrder(orderNumber: string): Promise<LogisticsOrderDetail> {
    const call = await this.client.call('alibaba.onetouch.logistics.express.order.detail.get', {
      param_query: { order_number: orderNumber }
    });
    const result = findRecord(unwrap(call.data, call.method), ['result']) ?? {};
    const data = findRecordAt(result, 'data') ?? {};
    const warehouse = findRecordAt(data, 'warehouse') ?? {};
    const label = readString(data, ['bar_code', 'label_url']);
    const isHttpsLabel = label?.startsWith('https://') === true;
    return {
      order: {
        orderNumber: readString(data, ['order_number']) ?? orderNumber,
        status: readString(data, ['order_status', 'status']) ?? 'unknown',
        freightAmount: readString(data, ['freight_amount']) ?? '0',
        currency: readString(data, ['freight_currency', 'currency']) ?? 'CNY',
        placedAt: readDate(data, ['place_order_time'])
      },
      warehouseName: readString(warehouse, ['name']) ?? null,
      warehouseAddress: readString(warehouse, ['address']) ?? null,
      labelUrl: isHttpsLabel ? label : null,
      labelBase64: label && !label.includes('://') ? label : null,
      trackingNumber: readString(data, ['tracking_number', 'logistics_no']) ?? null
    };
  }

  async listShippingTemplates(): Promise<ShippingTemplate[]> {
    const call = await this.client.call('alibaba.wholesale.shippingline.template.list', {
      page_num: 1,
      count: 100
    });
    const root = unwrap(call.data, call.method);
    return findRecords(root, ['items']).map((item) => ({
      id: readString(item, ['id']) ?? '',
      name: readString(item, ['title']) ?? '未命名运费模板'
    }));
  }

  async createOrder(request: RequestOf<'createLogisticsOrder'>): Promise<LogisticsOrderMutationResult> {
    const validation = validateLogisticsOrderInput(request);
    if (!validation.valid) throw new Error(`物流下单参数不合法：${validation.errors.join('；')}`);
    if (request.confirmedProductCode !== request.quoteRequest.productCode) {
      throw new Error('确认的物流产品与最近试算产品不一致，请重新试算');
    }
    const call = await this.client.call('alibaba.onetouch.logistics.express.logistics.order.create', {
      paramn_query: placeOrderParameters(request.quoteRequest)
    });
    const result = findRecord(unwrap(call.data, call.method), ['result']) ?? {};
    const values = findRecordAt(result, 'values') ?? {};
    return {
      orderNumber: readString(values, ['order_number']) ?? '',
      success: readBoolean(result, ['success']) ?? false
    };
  }
}

function addressMethod(level: RequestOf<'listLogisticsAddressNodes'>['level']): string {
  return `alibaba.onetouch.logistics.express.address.${level}.list`;
}

function normalizeSpecialProductType(item: Record<string, unknown>): LogisticsSpecialProductType {
  return {
    code: readString(item, ['code']) ?? '',
    name: readString(item, ['name']) ?? '未命名商品属性',
    children: findRecords(item, ['childrens', 'children']).map(normalizeSpecialProductType)
  };
}

function normalizeOrder(item: Record<string, unknown>): LogisticsOrderSummary {
  return {
    orderNumber: readString(item, ['order_number']) ?? '',
    status: readString(item, ['order_status']) ?? 'unknown',
    freightAmount: readString(item, ['freight_amount']) ?? '0',
    currency: readString(item, ['freight_currency']) ?? 'CNY',
    placedAt: readDate(item, ['place_order_time'])
  };
}

function placeOrderParameters(request: LogisticsQuoteRequest): Record<string, unknown> {
  return {
    cargo_list: request.cargo.map((cargo) => ({
      unit: cargo.unit,
      hscode: cargo.hsCode,
      quantity: Number(cargo.quantity),
      declaration_value: cargo.declarationValue,
      price: cargo.declarationValue,
      name_cn: cargo.nameCn,
      currency: cargo.currency,
      name_en: cargo.nameEn,
      purpose: cargo.purpose,
      material: cargo.material
    })),
    product_type: request.cargo.flatMap((cargo) =>
      cargo.productTypeCodes.map((code) => ({ code, name: code }))
    ),
    origin_zip_code: request.originZipCode,
    package_list: request.packages.map((item) => ({
      quantity: item.quantity,
      length: item.lengthCm,
      width: item.widthCm,
      height: item.heightCm,
      weight: item.weightKg,
      type: item.type
    })),
    destination_country_code: request.destinationCountryCode,
    warehouse_code: request.warehouseCode,
    product_code: request.productCode,
    consignor_address: addressParameters(request.consignor),
    express_customs: {
      declaration_amount: request.customs.declarationAmount,
      declaration_currency: request.customs.declarationCurrency,
      need_customs_clearance: request.customs.needCustomsClearance ? '1' : '0',
      ...(request.customs.vatType ? { vat_type: request.customs.vatType } : {}),
      ...(request.customs.vatNumber ? { vat_number: request.customs.vatNumber } : {}),
      ...(request.customs.taxpayerId ? { taxpayer_id: request.customs.taxpayerId } : {}),
      ...(request.customs.eoriNumber ? { eori_number: request.customs.eoriNumber } : {})
    },
    need_pickup: request.needPickup,
    destination_zip_code: request.destinationZipCode,
    supply_chain_biz_id: request.supplyChainBizId,
    consignee_address: addressParameters(request.consignee),
    ...(request.tradeBizId ? { trade_biz_id: request.tradeBizId } : {}),
    trade_platform: request.tradePlatform
  };
}

function addressParameters(address: LogisticsAddress): Record<string, unknown> {
  return {
    address: {
      zip: address.zipCode,
      country: { code: address.countryCode, name: address.countryCode },
      ...(address.provinceCode
        ? { province: { code: address.provinceCode, name: address.provinceCode } }
        : {}),
      ...(address.cityCode ? { city: { code: address.cityCode, name: address.cityCode } } : {}),
      ...(address.divisionCode
        ? { district: { code: address.divisionCode, name: address.divisionCode } }
        : {}),
      ...(address.streetCode ? { town: { code: address.streetCode, name: address.streetCode } } : {}),
      address: address.address1,
      ...(address.address2 ? { address2: address.address2 } : {})
    },
    contact: {
      mobile_no: address.contact.mobileNo,
      ...(address.contact.email ? { email: address.contact.email } : {}),
      contact_person: address.contact.contactPerson,
      ...(address.contact.companyName ? { company_name_en: address.contact.companyName } : {})
    }
  };
}

function requiredValue(value: string | undefined, name: string): string {
  if (!value) throw new Error(`缺少物流地址参数 ${name}`);
  return value;
}

function numericOrString(value: string): number | string {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
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

function readInteger(record: Record<string, unknown>, keys: string[]): number | undefined {
  const value = readString(record, keys);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
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
  const value = readString(record, keys);
  if (!value) return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
