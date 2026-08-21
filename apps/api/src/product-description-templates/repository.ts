import { createEntityAuditFields, normalizeRemark, updateEntityAuditFields } from '@one-vegetable/core';

import { EntityVersionConflictError } from '../db/repository';

import type {
  ProductDescriptionTemplate,
  ProductDescriptionTemplateCategory,
  ProductDescriptionTemplateLanguage,
  ProductDescriptionTemplateStatus,
  UnixEpochMilliseconds
} from '@one-vegetable/core';
import type { SqlExecutor, SqlPrimitive } from '../db/sql-executor';

const MAX_HTML_BYTES = 256 * 1024;

export interface ProductDescriptionTemplateListQuery {
  page: number;
  pageSize: number;
  language?: ProductDescriptionTemplateLanguage;
  category?: ProductDescriptionTemplateCategory;
  status?: ProductDescriptionTemplateStatus;
}

export interface ProductDescriptionTemplateCreateInput {
  name: string;
  category: ProductDescriptionTemplateCategory;
  language: ProductDescriptionTemplateLanguage;
  html: string;
  actorId: string;
  remark?: string | null;
}

export interface ProductDescriptionTemplateUpdateInput {
  id: string;
  name: string;
  category: ProductDescriptionTemplateCategory;
  language: ProductDescriptionTemplateLanguage;
  html: string;
  expectedRevision: number;
  actorId: string;
  remark: string | null;
}

export interface ProductDescriptionTemplateStatusInput {
  id: string;
  expectedRevision: number;
  actorId: string;
}

export interface ProductDescriptionTemplateRepository {
  get(id: string): Promise<ProductDescriptionTemplate | null>;
  list(query: ProductDescriptionTemplateListQuery): Promise<{
    items: ProductDescriptionTemplate[];
    total: number;
  }>;
  create(input: ProductDescriptionTemplateCreateInput): Promise<ProductDescriptionTemplate>;
  update(input: ProductDescriptionTemplateUpdateInput): Promise<ProductDescriptionTemplate>;
  archive(input: ProductDescriptionTemplateStatusInput): Promise<ProductDescriptionTemplate>;
  restore(input: ProductDescriptionTemplateStatusInput): Promise<ProductDescriptionTemplate>;
}

export class ProductDescriptionTemplateNameConflictError extends Error {
  constructor() {
    super('同语言下已存在同名模板');
    this.name = 'ProductDescriptionTemplateNameConflictError';
  }
}

export class ProductDescriptionTemplateNotFoundError extends Error {
  constructor() {
    super('商品详情模板不存在');
    this.name = 'ProductDescriptionTemplateNotFoundError';
  }
}

export class SqlProductDescriptionTemplateRepository implements ProductDescriptionTemplateRepository {
  readonly #executor: SqlExecutor;
  readonly #clock: () => UnixEpochMilliseconds;

  constructor(executor: SqlExecutor, clock: () => UnixEpochMilliseconds = Date.now) {
    this.#executor = executor;
    this.#clock = clock;
  }

  async get(id: string): Promise<ProductDescriptionTemplate | null> {
    const rows = await this.#executor.query(
      'SELECT * FROM product_description_templates WHERE id = ? LIMIT 1',
      [normalizeId(id)]
    );
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async list(query: ProductDescriptionTemplateListQuery): Promise<{
    items: ProductDescriptionTemplate[];
    total: number;
  }> {
    const filters: string[] = [];
    const parameters: SqlPrimitive[] = [];
    addFilter(filters, parameters, 'language = ?', query.language);
    addFilter(filters, parameters, 'category = ?', query.category);
    addFilter(filters, parameters, 'status = ?', query.status);
    const where = filters.length > 0 ? ` WHERE ${filters.join(' AND ')}` : '';
    const offset = (query.page - 1) * query.pageSize;
    const [rows, countRows] = await Promise.all([
      this.#executor.query(
        `SELECT * FROM product_description_templates${where}
         ORDER BY update_time_utc DESC, name COLLATE NOCASE ASC LIMIT ? OFFSET ?`,
        [...parameters, query.pageSize, offset]
      ),
      this.#executor.query(`SELECT COUNT(*) AS count FROM product_description_templates${where}`, parameters)
    ]);
    return { items: rows.map(toEntity), total: readNumber(countRows[0] ?? {}, 'count') };
  }

  async create(input: ProductDescriptionTemplateCreateInput): Promise<ProductDescriptionTemplate> {
    const value = normalizeWritableTemplate(input);
    const audit = createEntityAuditFields(input.actorId, this.#clock(), input.remark);
    const id = crypto.randomUUID();
    try {
      await this.#executor.execute(
        `INSERT INTO product_description_templates (
          id, name, category, language, html, status,
          create_time_utc, update_time_utc, creator_id, updater_id, revision, remark
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
        [
          id,
          value.name,
          value.category,
          value.language,
          value.html,
          audit.createTimeUtc,
          audit.updateTimeUtc,
          audit.creatorId,
          audit.updaterId,
          audit.revision,
          audit.remark
        ]
      );
    } catch (error: unknown) {
      throwNameConflict(error);
    }
    return this.#require(id);
  }

  async update(input: ProductDescriptionTemplateUpdateInput): Promise<ProductDescriptionTemplate> {
    const current = await this.#require(input.id);
    assertRevision(current.revision, input.expectedRevision);
    const value = normalizeWritableTemplate(input);
    const audit = updateEntityAuditFields(current, input.actorId, this.#clock(), input.remark);
    try {
      const result = await this.#executor.execute(
        `UPDATE product_description_templates SET
          name = ?, category = ?, language = ?, html = ?, update_time_utc = ?,
          updater_id = ?, revision = ?, remark = ?
         WHERE id = ? AND revision = ?`,
        [
          value.name,
          value.category,
          value.language,
          value.html,
          audit.updateTimeUtc,
          audit.updaterId,
          audit.revision,
          normalizeRemark(audit.remark),
          current.id,
          input.expectedRevision
        ]
      );
      if (result.changes !== 1) throw new EntityVersionConflictError();
    } catch (error: unknown) {
      throwNameConflict(error);
    }
    return this.#require(current.id);
  }

  archive(input: ProductDescriptionTemplateStatusInput): Promise<ProductDescriptionTemplate> {
    return this.#changeStatus(input, 'archived');
  }

  restore(input: ProductDescriptionTemplateStatusInput): Promise<ProductDescriptionTemplate> {
    return this.#changeStatus(input, 'active');
  }

  async #changeStatus(
    input: ProductDescriptionTemplateStatusInput,
    status: ProductDescriptionTemplateStatus
  ): Promise<ProductDescriptionTemplate> {
    const current = await this.#require(input.id);
    assertRevision(current.revision, input.expectedRevision);
    const audit = updateEntityAuditFields(current, input.actorId, this.#clock(), current.remark);
    const result = await this.#executor.execute(
      `UPDATE product_description_templates SET status = ?, update_time_utc = ?,
       updater_id = ?, revision = ? WHERE id = ? AND revision = ?`,
      [status, audit.updateTimeUtc, audit.updaterId, audit.revision, current.id, input.expectedRevision]
    );
    if (result.changes !== 1) throw new EntityVersionConflictError();
    return this.#require(current.id);
  }

  async #require(id: string): Promise<ProductDescriptionTemplate> {
    const entity = await this.get(id);
    if (!entity) throw new ProductDescriptionTemplateNotFoundError();
    return entity;
  }
}

function normalizeWritableTemplate(input: {
  name: string;
  category: ProductDescriptionTemplateCategory;
  language: ProductDescriptionTemplateLanguage;
  html: string;
}): {
  name: string;
  category: ProductDescriptionTemplateCategory;
  language: ProductDescriptionTemplateLanguage;
  html: string;
} {
  const name = input.name.trim();
  if (!name || Array.from(name).length > 80) throw new Error('模板名称必须为 1–80 个字符');
  if (new TextEncoder().encode(input.html).byteLength > MAX_HTML_BYTES) {
    throw new Error('模板 HTML 不能超过 256 KiB');
  }
  return { name, category: input.category, language: input.language, html: input.html };
}

function normalizeId(value: string): string {
  const id = value.trim();
  if (!id) throw new Error('模板 ID 不能为空');
  return id;
}

function assertRevision(actual: number, expected: number): void {
  if (actual !== expected) throw new EntityVersionConflictError();
}

function addFilter(
  filters: string[],
  parameters: SqlPrimitive[],
  sql: string,
  value: SqlPrimitive | undefined
): void {
  if (value === undefined) return;
  filters.push(sql);
  parameters.push(value);
}

function throwNameConflict(error: unknown): never {
  if (
    error instanceof Error &&
    /product_description_templates_language_name_unique|UNIQUE constraint failed/i.test(error.message)
  ) {
    throw new ProductDescriptionTemplateNameConflictError();
  }
  throw error;
}

function toEntity(row: Record<string, unknown>): ProductDescriptionTemplate {
  return {
    id: readString(row, 'id'),
    name: readString(row, 'name'),
    category: readEnum(row, 'category', ['company', 'logistics', 'packaging', 'service', 'custom']),
    language: readEnum(row, 'language', ['zh_CN', 'en_US']),
    html: readString(row, 'html'),
    status: readEnum(row, 'status', ['active', 'archived']),
    createTimeUtc: readNumber(row, 'create_time_utc'),
    updateTimeUtc: readNumber(row, 'update_time_utc'),
    creatorId: readString(row, 'creator_id'),
    updaterId: readString(row, 'updater_id'),
    revision: readNumber(row, 'revision'),
    remark: readNullableString(row, 'remark')
  };
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`数据库字段 ${key} 无效`);
  return value;
}

function readNullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`数据库字段 ${key} 无效`);
  return value;
}

function readNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`数据库字段 ${key} 无效`);
  }
  return value;
}

function readEnum<const T extends string>(
  row: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): T {
  const value = readString(row, key);
  if (!allowed.some((candidate) => candidate === value)) throw new Error(`数据库字段 ${key} 无效`);
  return value as T;
}
