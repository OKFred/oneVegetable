import type { AlibabaClient } from './alibaba-client';
import { GatewayException } from './errors';
import type {
  ProductCategory,
  ProductCategoryMapping,
  ProductDetail,
  ProductGroup,
  ProductMutationResult,
  ProductPage,
  ProductSchema,
  ProductScore,
  RequestOf
} from './types';

export class ProductAdapter {
  constructor(private readonly client: Pick<AlibabaClient, 'call'>) {}

  async list(request: RequestOf<'listProducts'>): Promise<ProductPage> {
    const call = await this.client.call('alibaba.icbu.product.list', {
      language: 'ENGLISH',
      current_page: request.page ?? 1,
      page_size: request.pageSize ?? 20,
      ...(request.subject ? { subject: request.subject } : {}),
      ...(request.groupId !== undefined ? { group_id1: request.groupId } : {})
    });
    const root = unwrap(call.data, call.method);
    const items = findRecords(root, ['products', 'product_list', 'result_list']).map((item) => ({
      id: readString(item, ['id', 'product_id']) ?? '',
      encryptedId: readString(item, ['product_id']) ?? null,
      subject: readString(item, ['subject', 'product_subject']) ?? '未命名商品',
      groupName: readString(item, ['group_name']) ?? '未分组',
      status: normalizeProductStatus(readString(item, ['display', 'status'])),
      score: readNumber(item, ['score']) ?? 0,
      updatedAt: normalizeDate(readString(item, ['gmt_modified', 'modified_time'])),
      categoryId: readNumber(item, ['category_id', 'cat_id']) ?? null
    }));
    return {
      items,
      page: request.page ?? 1,
      pageSize: request.pageSize ?? 20,
      total: readNumber(root, ['total_item', 'total_count', 'total']) ?? items.length
    };
  }

  async get(productId: string, draft = false): Promise<ProductDetail> {
    const method = draft ? 'alibaba.icbu.product.schema.render.draft' : 'alibaba.icbu.product.schema.render';
    const call = await this.client.call(method, {
      param_product_top_publish_request: { product_id: productId, language: 'en_US' }
    });
    const root = unwrap(call.data, call.method);
    return {
      id: productId,
      encryptedId: null,
      subject: `商品 ${productId}`,
      groupName: 'Schema 商品',
      status: draft ? 'draft' : 'online',
      score: 0,
      updatedAt: new Date().toISOString(),
      categoryId: 0,
      language: 'en_US',
      schemaXml: readString(root, ['data']) ?? ''
    };
  }

  async getSchema(request: RequestOf<'getProductSchema'>): Promise<ProductSchema> {
    const call = await this.client.call('alibaba.icbu.product.schema.get', {
      param_product_top_publish_request: {
        cat_id: request.categoryId,
        language: request.language,
        market: request.market,
        ...(request.productId ? { product_id: request.productId } : {})
      }
    });
    return {
      xml: readString(unwrap(call.data, call.method), ['data']) ?? '',
      categoryId: request.categoryId,
      language: request.language,
      market: request.market
    };
  }

  async renderSchema(request: RequestOf<'renderProductSchema'>): Promise<ProductSchema> {
    const productId = Number(request.productId);
    if (!Number.isSafeInteger(productId) || productId <= 0) {
      throw new Error('商品明文 ID 必须是安全范围内的正整数');
    }
    const call = await this.client.call('alibaba.icbu.product.schema.render', {
      param_product_top_publish_request: {
        cat_id: request.categoryId,
        language: request.language,
        product_id: productId
      }
    });
    const root = unwrap(call.data, call.method);
    return {
      xml: requireSchemaXml(root, 'ALIBABA_SCHEMA_RENDER_FAILED'),
      categoryId: request.categoryId,
      language: request.language,
      market: 'wholesale'
    };
  }

  async getLevelSchema(request: RequestOf<'getProductLevelSchema'>): Promise<ProductSchema> {
    const call = await this.client.call('alibaba.icbu.category.schema.level.get', {
      cat_id: request.categoryId,
      language: request.language,
      xml: request.xml
    });
    return {
      xml: readString(unwrap(call.data, call.method), ['data', 'result']) ?? '',
      categoryId: request.categoryId,
      language: request.language,
      market: 'wholesale'
    };
  }

  async mutate(
    method:
      | 'alibaba.icbu.product.schema.add'
      | 'alibaba.icbu.product.schema.add.draft'
      | 'alibaba.icbu.product.schema.update',
    request: RequestOf<'publishProduct'> & { productId?: string }
  ): Promise<ProductMutationResult> {
    const call = await this.client.call(method, {
      param_product_top_publish_request: {
        cat_id: request.categoryId,
        language: request.language,
        ...(request.productId ? { product_id: request.productId } : {}),
        xml: request.schemaXml
      }
    });
    const root = unwrap(call.data, method);
    return {
      productId: readString(root, ['product_id']) ?? request.productId ?? '',
      traceId: readString(root, ['trace_id']) ?? crypto.randomUUID(),
      success: readBoolean(root, ['biz_success', 'success']) ?? true
    };
  }

  async updateDisplay(request: RequestOf<'updateProductDisplay'>): Promise<void> {
    await this.client.call('alibaba.icbu.product.batch.update.display', {
      product_id_list: request.productIds.join(','),
      new_display: request.display === 'online' ? 'true' : 'false'
    });
  }

  async listCategories(parentId?: number): Promise<ProductCategory[]> {
    const call = await this.client.call('alibaba.icbu.category.get.new', {
      cat_id: parentId ?? 0
    });
    const root = unwrap(call.data, call.method);
    const records = findRecords(root, ['categories', 'category_list', 'result_list']);
    if (records.length > 0) return records.map(normalizeCategory);
    const category = asRecord(root.category);
    return Object.keys(category).length > 0 ? [normalizeCategory(category)] : [];
  }

  async mapCategory(categoryId: number): Promise<ProductCategoryMapping> {
    const call = await this.client.call('alibaba.icbu.category.id.mapping', {
      cat_id: categoryId,
      convert_type: 1
    });
    const root = unwrap(call.data, call.method);
    return {
      sourceCategoryId: categoryId,
      targetCategoryId: readNumber(root, ['mapping_result', 'category_id']) ?? categoryId
    };
  }

  async listGroups(): Promise<ProductGroup[]> {
    const call = await this.client.call('alibaba.icbu.product.group.get', { group_id: -1 });
    const root = unwrap(call.data, call.method);
    return findRecords(root, ['product_group', 'groups', 'result_list']).map(normalizeGroup);
  }

  async createGroup(request: RequestOf<'createProductGroup'>): Promise<ProductGroup> {
    const call = await this.client.call('alibaba.icbu.product.group.add', {
      group_name: request.name,
      ...(request.parentId !== undefined ? { parent_id: request.parentId } : {})
    });
    const root = unwrap(call.data, call.method);
    return {
      id: readNumber(root, ['group_id', 'id']) ?? 0,
      name: request.name,
      children: []
    };
  }

  async getScore(productId: string): Promise<ProductScore> {
    const call = await this.client.call('alibaba.icbu.product.score.get', { product_id: productId });
    const root = unwrap(call.data, call.method);
    const result = asRecord(root.result);
    const issueRecords = findRecords(root, ['issues', 'score_items', 'problem_list']);
    return {
      productId,
      score: readNumber(result, ['final_score']) ?? readNumber(root, ['score', 'total_score']) ?? 0,
      issues: issueRecords.map((item) => readString(item, ['message', 'description']) ?? '待优化项')
    };
  }
}

function requireSchemaXml(record: Record<string, unknown>, fallbackCode: string): string {
  const xml = readString(record, ['data']);
  if (readBoolean(record, ['biz_success']) !== false && xml?.trim()) return xml;
  const traceId = readString(record, ['trace_id', 'request_id']);
  throw new GatewayException({
    code: readString(record, ['msg_code']) ?? fallbackCode,
    message: readString(record, ['message']) ?? 'Alibaba 未返回可编辑的商品 Schema',
    ...(traceId ? { traceId } : {}),
    retryable: false
  });
}

function normalizeCategory(record: Record<string, unknown>): ProductCategory {
  const children = findRecords(record, ['children', 'child_categories']).map(normalizeCategory);
  return {
    id: readNumber(record, ['category_id', 'cat_id', 'id']) ?? 0,
    name: readString(record, ['name', 'en_name', 'cn_name']) ?? '未命名类目',
    leaf: readBoolean(record, ['leaf_category', 'leaf_cat', 'leaf']) ?? children.length === 0,
    children
  };
}

function normalizeGroup(record: Record<string, unknown>): ProductGroup {
  return {
    id: readNumber(record, ['group_id', 'id']) ?? 0,
    name: readString(record, ['group_name', 'name']) ?? '未命名分组',
    children: findRecords(record, ['children', 'child_groups']).map(normalizeGroup)
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function unwrap(value: unknown, method: string): Record<string, unknown> {
  const record = asRecord(value);
  const responseKey = `${method.replaceAll('.', '_')}_response`;
  return responseKey in record ? asRecord(record[responseKey]) : record;
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
  for (const key of keys) if (typeof record[key] === 'boolean') return record[key];
  return undefined;
}

function findRecords(record: Record<string, unknown>, keys: string[]): Record<string, unknown>[] {
  const visit = (value: unknown, depth: number): Record<string, unknown>[] | null => {
    if (depth > 5) return null;
    if (Array.isArray(value) && value.every(isRecord)) return value;
    if (!isRecord(value)) return null;
    for (const key of keys) {
      if (!(key in value)) continue;
      const result = visit(value[key], depth + 1);
      if (result) return result;
    }
    return null;
  };
  return visit(record, 0) ?? [];
}

function normalizeProductStatus(
  value: string | undefined
): 'online' | 'offline' | 'draft' | 'auditing' | 'rejected' {
  const normalized = value?.toLowerCase();
  if (
    normalized?.includes('online') ||
    normalized === 'true' ||
    normalized === 'y' ||
    normalized === 'approved'
  )
    return 'online';
  if (normalized?.includes('audit')) return 'auditing';
  if (normalized?.includes('reject')) return 'rejected';
  if (normalized?.includes('draft')) return 'draft';
  return 'offline';
}

function normalizeDate(value: string | undefined): string {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
