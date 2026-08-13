import type { AlibabaClient } from './alibaba-client';
import { validateEncodedFile } from './encoded-file';
import type {
  RequestOf,
  RfqDetail,
  RfqEquity,
  RfqPage,
  RfqQuotationResult,
  RfqReadStatus,
  RfqSummary
} from './types';

export class RfqAdapter {
  constructor(private readonly client: Pick<AlibabaClient, 'call'>) {}

  async list(request: RequestOf<'listRfqs'>): Promise<RfqPage> {
    const page = request.page ?? 1;
    const pageSize = request.pageSize ?? 20;
    const call = await this.client.call('alibaba.icbu.rfq.search', {
      cond: {
        search_text: request.keywords ?? '',
        current_page: page,
        page_size: pageSize,
        ...(request.categoryId ? { category_id: request.categoryId } : {}),
        ...(request.country ? { country: request.country } : {}),
        ...(request.unquotedOnly === true ? { filter_quoted: true } : {})
      }
    });
    const root = unwrap(call.data, call.method);
    const records = findRecords(root, ['request_list']);
    return {
      items: records.map((record) => normalizeSummary(record, false)),
      page,
      pageSize,
      total: readNumber(findRecord(root, ['result']) ?? root, ['total']) ?? records.length,
      source: 'search'
    };
  }

  async listRecommended(request: RequestOf<'listRecommendedRfqs'>): Promise<RfqPage> {
    const page = request.page ?? 1;
    const pageSize = request.pageSize ?? 20;
    const call = await this.client.call('alibaba.icbu.rfq.recommend', {
      query_dto: {
        count: pageSize,
        current: page,
        page_size: pageSize,
        site: 'qn-homepage',
        type: 'U_P_I'
      }
    });
    const root = unwrap(call.data, call.method);
    const records = findRecords(root, ['rfq_list']);
    const pagination = findRecord(root, ['pagination']);
    return {
      items: records.map((record) => normalizeSummary(record, true)),
      page,
      pageSize,
      total: pagination ? (readNumber(pagination, ['total_item']) ?? records.length) : records.length,
      source: 'recommend'
    };
  }

  async get(rfqId: string): Promise<RfqDetail> {
    const call = await this.client.call('alibaba.icbu.rfqdetail.get', {
      rfq_query_dto: { rfq_id: rfqId }
    });
    const root = unwrap(call.data, call.method);
    const detail = findRecord(root, ['rfq_detail_dto']) ?? {};
    const attachmentRecords = findRecords(root, ['attachments']);
    return {
      ...normalizeSummary({ ...detail, rfq_id: readString(detail, ['rfq_id']) ?? rfqId }, false),
      paymentTerms: readString(detail, ['payment_terms']) ?? null,
      destinationPort: readString(detail, ['destination_port']) ?? null,
      shippingTerms: readString(detail, ['shipping_terms']) ?? null,
      attachments: attachmentRecords.map((attachment) => ({
        name: readString(attachment, ['file_name']) ?? '附件',
        url: normalizeUrl(readString(attachment, ['file_url'])) ?? ''
      }))
    };
  }

  async getEquity(): Promise<RfqEquity> {
    const call = await this.client.call('alibaba.icbu.rfq.myequity', {});
    const root = unwrap(call.data, call.method);
    const value = findRecord(root, ['value']) ?? {};
    return {
      remainingQuotes: readNumber(value, ['equity_count']) ?? 0,
      remainingTopQuotes: readNumber(value, ['top_service_count']) ?? 0,
      score: readNumber(value, ['score']) ?? 0,
      beatSupplierPercent: readString(value, ['beat_supplier_percent']) ?? null,
      expiresAt: readString(value, ['expired_date']) ?? null
    };
  }

  async getReadStatus(rfqIds: string[]): Promise<RfqReadStatus> {
    const call = await this.client.call('alibaba.icbu.rfq.read', { rfq_id_list: rfqIds });
    const root = unwrap(call.data, call.method);
    const value = readString(findRecord(root, ['result']) ?? root, ['value']);
    const parsed = parseRecord(value);
    return {
      statuses: Object.fromEntries(rfqIds.map((rfqId) => [rfqId, readBoolean(parsed, [rfqId]) ?? false]))
    };
  }

  async uploadAttachment(request: RequestOf<'uploadRfqAttachment'>): Promise<{ filesString: string }> {
    validateEncodedFile(request);
    const call = await this.client.call('alibaba.icbu.annex.upload', {
      file_name: request.fileName,
      file_input_stream_bytes: request.contentBase64,
      source: 'top'
    });
    const root = unwrap(call.data, call.method);
    return { filesString: readString(root, ['result']) ?? '' };
  }

  async submitQuotation(request: RequestOf<'submitRfqQuotation'>): Promise<RfqQuotationResult> {
    const call = await this.client.call('alibaba.icbu.quotation.post', {
      dto: {
        details: request.message,
        rfq_id: request.rfqId,
        payment_terms: request.paymentTerms,
        expiry_date: request.expiresAt,
        ...(request.attachmentFilesString ? { annex_files_str: request.attachmentFilesString } : {}),
        price_list: request.prices.map((price) => ({
          item_name: price.itemName,
          fob_price: price.unitPrice,
          fob_price_unit: price.currency,
          quantity: price.quantity,
          quantity_unit: price.quantityUnit,
          shipping_terms: price.shippingTerms,
          port: price.port,
          remark: price.remark,
          ...(price.modelNumber ? { model_num: price.modelNumber } : {}),
          ...(price.imageFilesString ? { image_str: price.imageFilesString } : {})
        }))
      }
    });
    const root = unwrap(call.data, call.method);
    const result = findRecord(root, ['result']) ?? root;
    const quotation = findRecord(result, ['result']) ?? result;
    return {
      quotationId: readString(quotation, ['id']) ?? '',
      success: readBoolean(result, ['success']) ?? false
    };
  }
}

function normalizeSummary(record: Record<string, unknown>, recommended: boolean): RfqSummary {
  return {
    id: readString(record, ['unique_rfq_id', 'rfq_id']) ?? '',
    subject: readString(record, ['subject']) ?? '未命名 RFQ',
    description: readString(record, ['description', 'detail']) ?? '',
    quantity: readNumber(record, ['quantity']) ?? null,
    quantityUnit: readString(record, ['quantity_unit']) ?? null,
    countryCode: readString(record, ['country_simple', 'country']) ?? null,
    categoryId: readNumber(record, ['category_id']) ?? null,
    categoryName: readString(record, ['category_name']) ?? null,
    imageUrl: normalizeUrl(readString(record, ['image_url'])),
    remainingQuotes: readNumber(record, ['left_count']) ?? null,
    openAt: normalizeEpoch(readNumber(record, ['open_time', 'date_post'])),
    expiresAt: normalizeEpoch(readNumber(record, ['expirate_time'])),
    read: readBoolean(record, ['has_read']) ?? false,
    recommended
  };
}

function unwrap(value: unknown, method: string): Record<string, unknown> {
  const record = asRecord(value);
  return asRecord(record[`${method.replaceAll('.', '_')}_response`]);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findRecord(record: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  const visit = (value: unknown, depth: number): Record<string, unknown> | null => {
    if (depth > 6 || !isRecord(value)) return null;
    for (const key of keys) {
      if (isRecord(value[key])) return value[key];
    }
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
    if (depth > 6) return null;
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
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
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

function normalizeEpoch(value: number | undefined): string | null {
  if (value === undefined) return null;
  const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeUrl(value: string | undefined): string | null {
  if (!value) return null;
  return value.startsWith('//') ? `https:${value}` : value;
}

function parseRecord(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return {};
  }
}
