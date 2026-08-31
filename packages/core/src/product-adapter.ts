import type { AlibabaClient } from './alibaba-client';
import { GatewayException } from './errors';
import { productListLanguage, type AlibabaLanguage } from './preferences';
import { resolveProductSchemaXml } from './product-schema-json';
import type {
  ProductCategory,
  ProductCategoryMapping,
  ProductDetail,
  ProductDisplayMutationResult,
  ProductGroup,
  ProductMutationResult,
  ProductPage,
  ProductSchema,
  ProductScore,
  RequestOf
} from './types';

export interface ProductCategoryCache {
  get(categoryId: number): Record<string, unknown> | undefined;
  set(categoryId: number, record: Record<string, unknown>): void;
}

export class ProductAdapter {
  constructor(
    private readonly client: Pick<AlibabaClient, 'call'>,
    private readonly mutationClient: Pick<AlibabaClient, 'call'> = client,
    private readonly categoryCache?: ProductCategoryCache
  ) {}

  async list(request: RequestOf<'listProducts'>): Promise<ProductPage> {
    const call = await this.client.call('alibaba.icbu.product.list', {
      language: productListLanguage(request.language ?? 'en_US'),
      current_page: request.page ?? 1,
      page_size: request.pageSize ?? 20,
      ...(request.subject ? { subject: request.subject } : {}),
      ...productGroupFilterParameters(request)
    });
    const root = unwrap(call.data, call.method);
    const items = findRecords(root, ['products', 'product_list', 'result_list']).map((item) => {
      const mainImage = asRecord(item.main_image);
      return {
        id: readString(item, ['id', 'product_id']) ?? '',
        encryptedId: readString(item, ['product_id']) ?? null,
        subject: readString(item, ['subject', 'product_subject']) ?? '未命名商品',
        groupName: readString(item, ['group_name']) ?? '未分组',
        status: normalizeProductStatus(readString(item, ['display']), readString(item, ['status'])),
        score: readNumber(item, ['score']) ?? 0,
        imageUrl: readStringList(mainImage.images)[0] ?? null,
        updatedAt: normalizeDate(readString(item, ['gmt_modified', 'modified_time'])),
        categoryId: readNumber(item, ['category_id', 'cat_id']) ?? null
      };
    });
    return {
      items,
      page: request.page ?? 1,
      pageSize: request.pageSize ?? 20,
      total: readNumber(root, ['total_item', 'total_count', 'total']) ?? items.length
    };
  }

  async get(productId: string, draft = false, language: AlibabaLanguage = 'en_US'): Promise<ProductDetail> {
    const method = draft ? 'alibaba.icbu.product.schema.render.draft' : 'alibaba.icbu.product.schema.render';
    const numericProductId = Number(productId);
    if (!Number.isSafeInteger(numericProductId) || numericProductId <= 0) {
      throw new Error('商品明文 ID 必须是安全范围内的正整数');
    }
    const call = await this.client.call(method, {
      param_product_top_publish_request: { product_id: numericProductId, language }
    });
    const root = unwrap(call.data, call.method);
    return {
      id: productId,
      encryptedId: null,
      subject: `商品 ${productId}`,
      groupName: 'Schema 商品',
      status: draft ? 'draft' : 'online',
      score: 0,
      imageUrl: null,
      updatedAt: new Date().toISOString(),
      categoryId: 0,
      language,
      schemaXml: requireSchemaXml(root, 'ALIBABA_DRAFT_SCHEMA_RENDER_FAILED')
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
      xml: requireSchemaXml(unwrap(call.data, call.method), 'ALIBABA_SCHEMA_GET_FAILED'),
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
      xml: requireSchemaXml(unwrap(call.data, call.method), 'ALIBABA_LEVEL_SCHEMA_FAILED'),
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
    const call = await this.mutationClient.call(method, {
      param_product_top_publish_request: {
        cat_id: String(request.categoryId),
        language: request.language,
        publish_type: 'default',
        version: 'trade.1.1',
        ...(request.productId ? { product_id: request.productId } : {}),
        xml: request.schemaXml
      }
    });
    const root = unwrap(call.data, method);
    return requireProductMutationResult(root);
  }

  async saveDraft(request: RequestOf<'saveProductDraft'>): Promise<ProductMutationResult> {
    if (request.productId) {
      throw new GatewayException({
        code: 'ALIBABA_DRAFT_UPDATE_UNSUPPORTED',
        message: 'Alibaba OpenAPI 未提供覆盖保存既有平台草稿的接口，请在国际站官方编辑页继续编辑',
        traceId: crypto.randomUUID(),
        retryable: false
      });
    }
    return this.mutate('alibaba.icbu.product.schema.add.draft', request);
  }

  async update(request: RequestOf<'updateProduct'>): Promise<ProductMutationResult> {
    const productId = requireNumericProductId(request.productId);
    const method = 'alibaba.icbu.product.schema.update';
    const call = await this.client.call(method, {
      param_product_top_publish_request: {
        cat_id: request.categoryId,
        language: request.language,
        product_id: productId,
        xml: request.schemaPatchXml
      }
    });
    return requireProductMutationResult(unwrap(call.data, method));
  }

  async updateDisplay(request: RequestOf<'updateProductDisplay'>): Promise<ProductDisplayMutationResult> {
    const method = 'alibaba.icbu.product.batch.update.display';
    const call = await this.client.call(method, {
      product_id_list: request.encryptedProductIds.join(','),
      new_display: request.display === 'online' ? 'on' : 'off'
    });
    const root = unwrap(call.data, method);
    const traceId = readString(root, ['trace_id', 'request_id']) ?? crypto.randomUUID();
    if (readExplicitBoolean(root, 'sub_success') !== true) {
      throw new GatewayException({
        code: readString(root, ['sub_error_code', 'error_code']) ?? 'ALIBABA_DISPLAY_UPDATE_UNCONFIRMED',
        message: readString(root, ['sub_error_msg', 'message']) ?? 'Alibaba 未明确确认商品上下架成功',
        traceId,
        retryable: false
      });
    }
    return {
      encryptedProductIds: [...request.encryptedProductIds],
      display: request.display,
      traceId,
      success: true
    };
  }

  async listCategories(parentId?: number): Promise<ProductCategory[]> {
    const parent = await this.loadCategoryRecord(parentId ?? 0);
    if (!parent) return [];
    const childIds = [...new Set(readNumberList(parent.child_ids))];
    const children = (
      await mapWithConcurrency(childIds, 4, async (categoryId) => {
        const child = await this.loadCategoryRecord(categoryId);
        return child ? normalizeCategory(child) : null;
      })
    ).filter((category): category is ProductCategory => category !== null);
    const normalizedParent = normalizeCategory(parent);
    if (parentId === undefined) {
      if (children.length > 0) return children;
      return normalizedParent.id > 0 && normalizedParent.name.trim() !== '' ? [normalizedParent] : [];
    }
    return [{ ...normalizedParent, children }];
  }

  private async loadCategoryRecord(categoryId: number): Promise<Record<string, unknown> | null> {
    const cached = this.categoryCache?.get(categoryId);
    if (cached) return cached;
    const method = 'alibaba.icbu.category.get.new';
    const call = await this.client.call(method, { cat_id: categoryId });
    const root = unwrap(call.data, call.method);
    const category = findRecord(root, ['category']);
    if (category) {
      this.categoryCache?.set(categoryId, category);
      return category;
    }
    const records = findRecords(root, ['categories', 'category_list', 'result_list']);
    const record = records[0] ?? null;
    if (record) this.categoryCache?.set(categoryId, record);
    return record;
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

  async listGroups(parentId?: number): Promise<ProductGroup[]> {
    const targetParentId = parentId ?? -1;
    const records = await this.loadGroupRecords(targetParentId);
    const parent =
      records.find((record) => readNumber(record, ['group_id', 'id']) === targetParentId) ?? records[0];
    if (!parent) return [];
    const childIds = readNumberList(parent.children_id_list);
    if (childIds.length === 0 && targetParentId === -1) {
      return records.filter((record) => readNumber(record, ['group_id', 'id']) !== -1).map(normalizeGroup);
    }
    const children = await Promise.all(childIds.map((groupId) => this.loadGroupRecords(groupId)));
    return children.flatMap((items) => items.slice(0, 1).map(normalizeGroup));
  }

  private async loadGroupRecords(groupId: number): Promise<Record<string, unknown>[]> {
    const call = await this.client.call('alibaba.icbu.product.group.get', { group_id: groupId });
    const root = unwrap(call.data, call.method);
    const records = findRecords(root, ['product_group', 'groups', 'result_list']);
    if (records.length > 0) return records;
    const single = findRecord(root, ['product_group', 'group', 'result']);
    return single ? [single] : [];
  }

  async createGroup(request: RequestOf<'createProductGroup'>): Promise<ProductGroup> {
    const method = 'alibaba.icbu.product.group.add';
    const call = await this.client.call(method, {
      group_name: request.name,
      parent_id: request.parentId,
      extra_context: {}
    });
    const root = unwrap(call.data, method);
    const created = findRecord(root, ['product_group']);
    const groupId = created ? readNumber(created, ['group_id', 'id']) : null;
    const groupName = created ? readString(created, ['group_name', 'name']) : null;
    const parentId = created ? readNumber(created, ['parent_id']) : null;
    if (!groupId || groupName !== request.name || parentId !== request.parentId) {
      throw new GatewayException({
        code: 'ALIBABA_PRODUCT_GROUP_CREATE_UNCONFIRMED',
        message: 'Alibaba 未返回与请求一致的商品分组 ID、名称和父级',
        traceId: readString(root, ['trace_id', 'request_id']) ?? crypto.randomUUID(),
        retryable: false
      });
    }
    return {
      id: groupId,
      name: groupName,
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

function productGroupFilterParameters(request: RequestOf<'listProducts'>): {
  group_id1?: number;
  group_id2?: number;
  group_id3?: number;
} {
  if (request.groupId === undefined) return {};
  if (request.groupLevel === 2) return { group_id2: request.groupId };
  if (request.groupLevel === 3) return { group_id3: request.groupId };
  return { group_id1: request.groupId };
}

function requireSchemaXml(record: Record<string, unknown>, fallbackCode: string): string {
  const xml = resolveProductSchemaXml(record);
  if (readBoolean(record, ['biz_success']) !== false && xml?.trim()) return xml;
  const traceId = readString(record, ['trace_id', 'request_id']);
  throw new GatewayException({
    code: readString(record, ['msg_code']) ?? fallbackCode,
    message: readString(record, ['message']) ?? 'Alibaba 未返回可编辑的商品 Schema',
    ...(traceId ? { traceId } : {}),
    retryable: false
  });
}

function requireNumericProductId(productId: string): number {
  const numericProductId = Number(productId);
  if (!Number.isSafeInteger(numericProductId) || numericProductId <= 0) {
    throw new Error('商品明文 ID 必须是安全范围内的正整数');
  }
  return numericProductId;
}

function requireProductMutationResult(root: Record<string, unknown>): ProductMutationResult {
  const productId = readString(root, ['product_id'])?.trim() ?? '';
  const traceId = readString(root, ['trace_id', 'request_id']) ?? crypto.randomUUID();
  if (readExplicitBoolean(root, 'biz_success') !== true || productId === '') {
    throw new GatewayException({
      code:
        readString(root, ['msg_code', 'error_code', 'sub_error_code', 'sub_code']) ??
        (productId === '' ? 'ALIBABA_PRODUCT_ID_MISSING' : 'ALIBABA_PRODUCT_MUTATION_UNCONFIRMED'),
      message:
        readString(root, ['message', 'msg', 'sub_error_msg', 'sub_msg', 'error_msg']) ??
        'Alibaba 未明确返回 biz_success=true 和非空 product_id，不能确认商品写入成功',
      traceId,
      retryable: false
    });
  }
  return { productId, traceId, success: true };
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

function readExplicitBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function readNumberList(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const parsed = typeof item === 'number' || typeof item === 'string' ? Number(item) : Number.NaN;
      return Number.isSafeInteger(parsed) && parsed > 0 ? [parsed] : [];
    });
  }
  if (!isRecord(value)) return [];
  return readNumberList(value.number ?? value.numbers ?? value.string ?? value.strings ?? value.items);
}

function readStringList(value: unknown): string[] {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized === '') return [];
    if (normalized.startsWith('[')) {
      try {
        return readStringList(JSON.parse(normalized) as unknown);
      } catch {
        return [normalized];
      }
    }
    return [normalized];
  }
  if (Array.isArray(value)) return value.flatMap(readStringList);
  if (!isRecord(value)) return [];
  return readStringList(value.string ?? value.strings ?? value.items ?? value.values);
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await mapper(item, index);
    }
  };
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function findRecord(record: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  const visit = (value: unknown, depth: number): Record<string, unknown> | null => {
    if (depth > 5 || !isRecord(value)) return null;
    for (const key of keys) {
      const candidate = value[key];
      if (isRecord(candidate)) return candidate;
    }
    for (const candidate of Object.values(value)) {
      const result = visit(candidate, depth + 1);
      if (result) return result;
    }
    return null;
  };
  return visit(record, 0);
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
  display: string | undefined,
  lifecycle: string | undefined
): 'online' | 'offline' | 'draft' | 'auditing' | 'rejected' {
  const normalizedLifecycle = lifecycle?.toLowerCase();
  if (normalizedLifecycle === 'new' || normalizedLifecycle === 'modified') return 'auditing';
  if (normalizedLifecycle?.includes('audit') || normalizedLifecycle?.includes('pending')) {
    return 'auditing';
  }
  if (normalizedLifecycle === 'tbd' || normalizedLifecycle?.includes('reject')) return 'rejected';
  if (normalizedLifecycle === 'sketch' || normalizedLifecycle?.includes('draft')) return 'draft';
  const normalizedDisplay = display?.toLowerCase() ?? normalizedLifecycle;
  if (normalizedDisplay?.includes('online') || normalizedDisplay === 'true' || normalizedDisplay === 'y')
    return 'online';
  return 'offline';
}

function normalizeDate(value: string | undefined): string {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
