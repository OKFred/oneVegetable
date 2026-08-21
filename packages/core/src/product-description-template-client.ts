import { DEFAULT_API_PREFIX, normalizeApiPrefix } from './api-contract';
import { createEntityAuditFields, updateEntityAuditFields } from './audit';
import { GatewayException } from './errors';
import { createRequestId, NetworkManager } from './network';
import { sanitizeProductDescriptionHtml } from './product-description';

import type { ApiResponse } from './api-contract';
import type { NetworkTransport } from './network';
import type {
  OperationAvailabilityResult,
  ProductDescriptionTemplate,
  ProductDescriptionTemplateCategory,
  ProductDescriptionTemplateLanguage,
  ProductDescriptionTemplatePage,
  ProductDescriptionTemplateStatus
} from './product-description-template';
import type { OperationId } from './types';

export interface ProductDescriptionTemplateListInput {
  page?: number;
  pageSize?: number;
  language?: ProductDescriptionTemplateLanguage;
  category?: ProductDescriptionTemplateCategory;
  status?: ProductDescriptionTemplateStatus;
}

export interface ProductDescriptionTemplateClient {
  list(input?: ProductDescriptionTemplateListInput): Promise<ProductDescriptionTemplatePage>;
  create(input: {
    name: string;
    category: ProductDescriptionTemplateCategory;
    language: ProductDescriptionTemplateLanguage;
    html: string;
    remark?: string | null;
  }): Promise<ProductDescriptionTemplate>;
  update(input: {
    id: string;
    name: string;
    category: ProductDescriptionTemplateCategory;
    language: ProductDescriptionTemplateLanguage;
    html: string;
    revision: number;
    remark: string | null;
  }): Promise<ProductDescriptionTemplate>;
  archive(id: string, revision: number): Promise<ProductDescriptionTemplate>;
  restore(id: string, revision: number): Promise<ProductDescriptionTemplate>;
}

export interface OperationAvailabilityClient {
  get(operations: readonly OperationId[]): Promise<OperationAvailabilityResult>;
}

export interface BffProductDescriptionTemplateClientOptions {
  baseUrl: string;
  apiPrefix?: string | undefined;
  transport?: NetworkTransport;
  csrfToken?: () => string | null;
}

export class BffProductDescriptionTemplateClient
  implements ProductDescriptionTemplateClient, OperationAvailabilityClient
{
  readonly #baseUrl: URL;
  readonly #apiPrefix: string;
  readonly #network: NetworkManager;
  readonly #csrfToken: (() => string | null) | undefined;

  constructor(options: BffProductDescriptionTemplateClientOptions) {
    this.#baseUrl = new URL(options.baseUrl);
    if (!['http:', 'https:'].includes(this.#baseUrl.protocol)) throw new Error('BFF 地址仅允许 HTTP(S)');
    this.#apiPrefix = normalizeApiPrefix(options.apiPrefix ?? DEFAULT_API_PREFIX);
    this.#csrfToken = options.csrfToken;
    this.#network = new NetworkManager({
      ...(options.transport ? { transport: options.transport } : {}),
      policies: {
        alibaba: { allowedOrigins: [] },
        bff: {
          allowedOrigins: [this.#baseUrl.origin],
          timeoutMilliseconds: 30_000,
          maxRequestBytes: 512 * 1024,
          maxResponseBytes: 4 * 1024 * 1024,
          credentials: 'include',
          redirect: 'error'
        },
        'external-photo': { allowedOrigins: [] }
      }
    });
  }

  async list(input: ProductDescriptionTemplateListInput = {}): Promise<ProductDescriptionTemplatePage> {
    const data = await this.#call('/product-description-templates/list', { ...input });
    if (!isTemplatePage(data)) throw invalidResponse();
    return data;
  }

  async create(input: {
    name: string;
    category: ProductDescriptionTemplateCategory;
    language: ProductDescriptionTemplateLanguage;
    html: string;
    remark?: string | null;
  }): Promise<ProductDescriptionTemplate> {
    const data = await this.#call('/product-description-templates/create', input);
    if (!isTemplate(data)) throw invalidResponse();
    return data;
  }

  async update(input: {
    id: string;
    name: string;
    category: ProductDescriptionTemplateCategory;
    language: ProductDescriptionTemplateLanguage;
    html: string;
    revision: number;
    remark: string | null;
  }): Promise<ProductDescriptionTemplate> {
    const data = await this.#call('/product-description-templates/update', input);
    if (!isTemplate(data)) throw invalidResponse();
    return data;
  }

  archive(id: string, revision: number): Promise<ProductDescriptionTemplate> {
    return this.#changeStatus('/product-description-templates/archive', id, revision);
  }

  restore(id: string, revision: number): Promise<ProductDescriptionTemplate> {
    return this.#changeStatus('/product-description-templates/restore', id, revision);
  }

  async get(operations: readonly OperationId[]): Promise<OperationAvailabilityResult> {
    const data = await this.#call('/operations/availability/get', { operations });
    if (!isAvailabilityResult(data)) throw invalidResponse();
    return data;
  }

  async #changeStatus(path: string, id: string, revision: number): Promise<ProductDescriptionTemplate> {
    const data = await this.#call(path, { id, revision });
    if (!isTemplate(data)) throw invalidResponse();
    return data;
  }

  async #call(path: string, body: Record<string, unknown>): Promise<unknown> {
    const requestId = createRequestId();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const csrfToken = this.#csrfToken?.();
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const response = await this.#network.request({
      service: 'bff',
      url: new URL(`${this.#apiPrefix}${path}`, this.#baseUrl),
      method: 'POST',
      headers,
      requestId,
      body: JSON.stringify({ requestId, ...body }),
      responseType: 'json'
    });
    if (!isApiResponse(response.data) || response.data.requestId !== requestId) throw invalidResponse();
    if (!response.data.ok) throw new GatewayException(response.data.error);
    return response.data.data;
  }
}

export class MemoryProductDescriptionTemplateClient implements ProductDescriptionTemplateClient {
  readonly #values = new Map<string, ProductDescriptionTemplate>();
  readonly #writable: boolean;
  readonly #actorId: string;
  readonly #clock: () => number;

  constructor(
    values: readonly ProductDescriptionTemplate[] = [],
    options: { writable?: boolean; actorId?: string; clock?: () => number } = {}
  ) {
    for (const value of values) this.#values.set(value.id, structuredClone(value));
    this.#writable = options.writable ?? true;
    this.#actorId = options.actorId ?? 'mock:user';
    this.#clock = options.clock ?? Date.now;
  }

  list(input: ProductDescriptionTemplateListInput = {}): Promise<ProductDescriptionTemplatePage> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    const values = [...this.#values.values()]
      .filter((value) => input.language === undefined || value.language === input.language)
      .filter((value) => input.category === undefined || value.category === input.category)
      .filter((value) => input.status === undefined || value.status === input.status)
      .sort((left, right) => right.updateTimeUtc - left.updateTimeUtc || left.name.localeCompare(right.name));
    const offset = (page - 1) * pageSize;
    return Promise.resolve({
      items: structuredClone(values.slice(offset, offset + pageSize)),
      page,
      pageSize,
      total: values.length
    });
  }

  create(input: {
    name: string;
    category: ProductDescriptionTemplateCategory;
    language: ProductDescriptionTemplateLanguage;
    html: string;
    remark?: string | null;
  }): Promise<ProductDescriptionTemplate> {
    return Promise.resolve().then(() => {
      this.#assertWritable();
      this.#assertUniqueName(input.name, input.language);
      const audit = createEntityAuditFields(this.#actorId, this.#clock(), input.remark);
      const entity: ProductDescriptionTemplate = {
        id: crypto.randomUUID(),
        name: input.name.trim(),
        category: input.category,
        language: input.language,
        html: sanitizeProductDescriptionHtml(input.html).html,
        status: 'active',
        ...audit
      };
      this.#values.set(entity.id, entity);
      return structuredClone(entity);
    });
  }

  update(input: {
    id: string;
    name: string;
    category: ProductDescriptionTemplateCategory;
    language: ProductDescriptionTemplateLanguage;
    html: string;
    revision: number;
    remark: string | null;
  }): Promise<ProductDescriptionTemplate> {
    return Promise.resolve().then(() => {
      this.#assertWritable();
      const current = this.#required(input.id);
      this.#assertRevision(current, input.revision);
      this.#assertUniqueName(input.name, input.language, input.id);
      const entity: ProductDescriptionTemplate = {
        ...current,
        name: input.name.trim(),
        category: input.category,
        language: input.language,
        html: sanitizeProductDescriptionHtml(input.html).html,
        ...updateEntityAuditFields(current, this.#actorId, this.#clock(), input.remark)
      };
      this.#values.set(entity.id, entity);
      return structuredClone(entity);
    });
  }

  archive(id: string, revision: number): Promise<ProductDescriptionTemplate> {
    return this.#changeStatus(id, revision, 'archived');
  }

  restore(id: string, revision: number): Promise<ProductDescriptionTemplate> {
    return this.#changeStatus(id, revision, 'active');
  }

  #changeStatus(
    id: string,
    revision: number,
    status: ProductDescriptionTemplateStatus
  ): Promise<ProductDescriptionTemplate> {
    return Promise.resolve().then(() => {
      this.#assertWritable();
      const current = this.#required(id);
      this.#assertRevision(current, revision);
      const entity: ProductDescriptionTemplate = {
        ...current,
        status,
        ...updateEntityAuditFields(current, this.#actorId, this.#clock(), current.remark)
      };
      this.#values.set(entity.id, entity);
      return structuredClone(entity);
    });
  }

  #assertWritable(): void {
    if (!this.#writable) {
      throw new GatewayException({
        code: 'TEMPLATE_WRITE_UNAVAILABLE',
        message: '当前模式只能使用内置详情模板',
        retryable: false
      });
    }
  }

  #assertUniqueName(name: string, language: ProductDescriptionTemplateLanguage, exceptId?: string): void {
    const normalized = name.trim().toLocaleLowerCase();
    if (
      [...this.#values.values()].some(
        (value) =>
          value.id !== exceptId &&
          value.language === language &&
          value.name.toLocaleLowerCase() === normalized
      )
    ) {
      throw new GatewayException({
        code: 'TEMPLATE_NAME_CONFLICT',
        message: '同语言下已存在同名模板',
        retryable: false
      });
    }
  }

  #required(id: string): ProductDescriptionTemplate {
    const entity = this.#values.get(id);
    if (!entity) {
      throw new GatewayException({
        code: 'TEMPLATE_NOT_FOUND',
        message: '商品详情模板不存在',
        retryable: false
      });
    }
    return entity;
  }

  #assertRevision(entity: ProductDescriptionTemplate, revision: number): void {
    if (entity.revision !== revision) {
      throw new GatewayException({
        code: 'ENTITY_VERSION_CONFLICT',
        message: '实体已被其他请求更新',
        retryable: false
      });
    }
  }
}

/** Combines immutable bundled templates with a writable shared-template provider. */
export class CompositeProductDescriptionTemplateClient implements ProductDescriptionTemplateClient {
  constructor(
    private readonly bundled: ProductDescriptionTemplateClient,
    private readonly shared: ProductDescriptionTemplateClient
  ) {}

  async list(input: ProductDescriptionTemplateListInput = {}): Promise<ProductDescriptionTemplatePage> {
    const [bundled, shared] = await Promise.all([
      readAllTemplatePages(this.bundled, input),
      readAllTemplatePages(this.shared, input)
    ]);
    const merged = new Map<string, ProductDescriptionTemplate>();
    for (const template of bundled) merged.set(template.id, template);
    for (const template of shared) merged.set(template.id, template);
    const values = [...merged.values()].toSorted(
      (left, right) =>
        Number(right.creatorId === 'system:bundled') - Number(left.creatorId === 'system:bundled') ||
        right.updateTimeUtc - left.updateTimeUtc ||
        left.name.localeCompare(right.name)
    );
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    const offset = (page - 1) * pageSize;
    return {
      items: values.slice(offset, offset + pageSize),
      page,
      pageSize,
      total: values.length
    };
  }

  create(
    input: Parameters<ProductDescriptionTemplateClient['create']>[0]
  ): Promise<ProductDescriptionTemplate> {
    return this.shared.create(input);
  }

  update(
    input: Parameters<ProductDescriptionTemplateClient['update']>[0]
  ): Promise<ProductDescriptionTemplate> {
    return this.shared.update(input);
  }

  archive(id: string, revision: number): Promise<ProductDescriptionTemplate> {
    return this.shared.archive(id, revision);
  }

  restore(id: string, revision: number): Promise<ProductDescriptionTemplate> {
    return this.shared.restore(id, revision);
  }
}

export class StaticOperationAvailabilityClient implements OperationAvailabilityClient {
  readonly #allowed: ReadonlySet<OperationId>;

  constructor(allowed: ReadonlySet<OperationId>) {
    this.#allowed = allowed;
  }

  get(operations: readonly OperationId[]): Promise<OperationAvailabilityResult> {
    return Promise.resolve({
      items: operations.map((operation) => ({
        operation,
        allowed: this.#allowed.has(operation),
        reasonCode: this.#allowed.has(operation) ? 'STATIC_ALLOWED' : 'STATIC_DISABLED'
      }))
    });
  }
}

async function readAllTemplatePages(
  client: ProductDescriptionTemplateClient,
  input: ProductDescriptionTemplateListInput
): Promise<ProductDescriptionTemplate[]> {
  const values: ProductDescriptionTemplate[] = [];
  const pageSize = 100;
  for (let page = 1; page <= 100; page += 1) {
    const result = await client.list({ ...input, page, pageSize });
    values.push(...result.items);
    if (values.length >= result.total || result.items.length === 0) return values;
  }
  throw new GatewayException({
    code: 'TEMPLATE_PAGE_LIMIT_EXCEEDED',
    message: '共享详情模板数量超过当前客户端读取上限',
    retryable: false
  });
}

function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  if (!isRecord(value) || typeof value.requestId !== 'string' || typeof value.ok !== 'boolean') return false;
  return value.ok ? 'data' in value : isRecord(value.error);
}

function isTemplatePage(value: unknown): value is ProductDescriptionTemplatePage {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isTemplate) &&
    isPositiveInteger(value.page) &&
    isPositiveInteger(value.pageSize) &&
    isNonNegativeInteger(value.total)
  );
}

function isTemplate(value: unknown): value is ProductDescriptionTemplate {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isEnum(value.category, ['company', 'logistics', 'packaging', 'service', 'custom']) &&
    isEnum(value.language, ['zh_CN', 'en_US']) &&
    typeof value.html === 'string' &&
    isEnum(value.status, ['active', 'archived']) &&
    isNonNegativeInteger(value.createTimeUtc) &&
    isNonNegativeInteger(value.updateTimeUtc) &&
    typeof value.creatorId === 'string' &&
    typeof value.updaterId === 'string' &&
    isPositiveInteger(value.revision) &&
    (value.remark === null || typeof value.remark === 'string')
  );
}

function isAvailabilityResult(value: unknown): value is OperationAvailabilityResult {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        typeof item.operation === 'string' &&
        typeof item.allowed === 'boolean' &&
        (item.reasonCode === null || typeof item.reasonCode === 'string')
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEnum<const T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.some((candidate) => candidate === value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function invalidResponse(): GatewayException {
  return new GatewayException({
    code: 'INVALID_BFF_RESPONSE',
    message: 'BFF 模板响应契约无效',
    retryable: false
  });
}
