import { createEntityAuditFields, updateEntityAuditFields } from '@one-vegetable/core';

import { EntityVersionConflictError } from '../db/repository';

import type {
  ProductMutationFieldExpectation,
  ProductMutationJob,
  ProductMutationJobStatus,
  UnixEpochMilliseconds
} from '@one-vegetable/core';
import type { SqlExecutor, SqlPrimitive } from '../db/sql-executor';

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const BLOCKING_STATUSES: readonly ProductMutationJobStatus[] = [
  'submitted',
  'auditing',
  'verifying',
  'recovery-required',
  'recovering'
];

export interface ProductMutationJobCreateInput {
  requestId: string;
  productId: string;
  categoryId: number;
  language: 'zh_CN' | 'en_US';
  payloadFingerprint: string;
  fieldExpectations: ProductMutationFieldExpectation[];
  actorId: string;
  remark?: string | null;
}

export interface ProductMutationJobTransitionInput {
  id: string;
  expectedRevision: number;
  status: ProductMutationJobStatus;
  actorId: string;
  traceId?: string | null;
  reasonCode?: string | null;
  message?: string | null;
  checked?: boolean;
}

export interface ProductDisplayMutationJobCreateInput {
  requestId: string;
  productId: string;
  encryptedProductId: string;
  targetDisplay: 'online' | 'offline';
  originalDisplay: 'online' | 'offline';
  payloadFingerprint: string;
  actorId: string;
  remark?: string | null;
}

export interface ProductMutationJobListQuery {
  page: number;
  pageSize: number;
  productId?: string;
  status?: ProductMutationJobStatus;
  actorId?: string;
}

export interface ProductMutationJobRepository {
  get(id: string): Promise<ProductMutationJob | null>;
  findBlocking(productId: string): Promise<ProductMutationJob | null>;
  list(query: ProductMutationJobListQuery): Promise<{ items: ProductMutationJob[]; total: number }>;
  create(input: ProductMutationJobCreateInput): Promise<ProductMutationJob>;
  createDisplay(input: ProductDisplayMutationJobCreateInput): Promise<ProductMutationJob>;
  transition(input: ProductMutationJobTransitionInput): Promise<ProductMutationJob>;
}

export class ProductMutationJobConflictError extends Error {
  constructor() {
    super('该商品存在尚未结束或需要恢复的写入任务');
    this.name = 'ProductMutationJobConflictError';
  }
}

export class ProductMutationJobNotFoundError extends Error {
  constructor() {
    super('商品写入任务不存在');
    this.name = 'ProductMutationJobNotFoundError';
  }
}

export class SqlProductMutationJobRepository implements ProductMutationJobRepository {
  readonly #executor: SqlExecutor;
  readonly #clock: () => UnixEpochMilliseconds;

  constructor(executor: SqlExecutor, clock: () => UnixEpochMilliseconds = Date.now) {
    this.#executor = executor;
    this.#clock = clock;
  }

  async get(id: string): Promise<ProductMutationJob | null> {
    const rows = await this.#executor.query('SELECT * FROM product_mutation_jobs WHERE id = ? LIMIT 1', [
      normalizeId(id)
    ]);
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async findBlocking(productId: string): Promise<ProductMutationJob | null> {
    const rows = await this.#executor.query(
      `SELECT * FROM product_mutation_jobs
       WHERE product_id = ?
         AND status IN ('submitted', 'auditing', 'verifying', 'recovery-required', 'recovering')
       ORDER BY submitted_time_utc DESC LIMIT 1`,
      [normalizeProductId(productId)]
    );
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async list(query: ProductMutationJobListQuery): Promise<{
    items: ProductMutationJob[];
    total: number;
  }> {
    const filters: string[] = [];
    const parameters: SqlPrimitive[] = [];
    if (query.productId !== undefined) {
      filters.push('product_id = ?');
      parameters.push(normalizeProductId(query.productId));
    }
    if (query.status !== undefined) {
      assertStatus(query.status);
      filters.push('status = ?');
      parameters.push(query.status);
    }
    if (query.actorId !== undefined) {
      filters.push('creator_id = ?');
      parameters.push(query.actorId);
    }
    const where = filters.length > 0 ? ` WHERE ${filters.join(' AND ')}` : '';
    const offset = (query.page - 1) * query.pageSize;
    const [rows, countRows] = await Promise.all([
      this.#executor.query(
        `SELECT * FROM product_mutation_jobs${where}
         ORDER BY submitted_time_utc DESC LIMIT ? OFFSET ?`,
        [...parameters, query.pageSize, offset]
      ),
      this.#executor.query(`SELECT COUNT(*) AS count FROM product_mutation_jobs${where}`, parameters)
    ]);
    return { items: rows.map(toEntity), total: readNumber(countRows[0] ?? {}, 'count') };
  }

  async create(input: ProductMutationJobCreateInput): Promise<ProductMutationJob> {
    const now = this.#clock();
    const audit = createEntityAuditFields(input.actorId, now, input.remark);
    const id = crypto.randomUUID();
    const productId = normalizeProductId(input.productId);
    const expectations = normalizeExpectations(input.fieldExpectations);
    if (!FINGERPRINT_PATTERN.test(input.payloadFingerprint)) throw new Error('写入载荷指纹无效');
    try {
      await this.#executor.execute(
        `INSERT INTO product_mutation_jobs (
          id, request_id, product_id, operation, status, category_id, language,
          payload_fingerprint, field_expectations_json,
          encrypted_product_id, target_display, original_display,
          trace_id, reason_code, message,
          submitted_time_utc, last_checked_time_utc, completed_time_utc,
          create_time_utc, update_time_utc, creator_id, updater_id, revision, remark
        ) VALUES (?, ?, ?, 'updateProduct', 'submitted', ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL,
          ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.requestId,
          productId,
          input.categoryId,
          input.language,
          input.payloadFingerprint,
          JSON.stringify(expectations),
          now,
          audit.createTimeUtc,
          audit.updateTimeUtc,
          audit.creatorId,
          audit.updaterId,
          audit.revision,
          audit.remark
        ]
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        /product_mutation_jobs_(open_product|request_target)_unique|UNIQUE constraint failed/iu.test(
          error.message
        )
      ) {
        throw new ProductMutationJobConflictError();
      }
      throw error;
    }
    return this.#require(id);
  }

  async createDisplay(input: ProductDisplayMutationJobCreateInput): Promise<ProductMutationJob> {
    const now = this.#clock();
    const audit = createEntityAuditFields(input.actorId, now, input.remark);
    const id = crypto.randomUUID();
    const productId = normalizeProductId(input.productId);
    const encryptedProductId = normalizeEncryptedProductId(input.encryptedProductId);
    if (!FINGERPRINT_PATTERN.test(input.payloadFingerprint)) throw new Error('写入载荷指纹无效');
    try {
      await this.#executor.execute(
        `INSERT INTO product_mutation_jobs (
          id, request_id, product_id, operation, status, category_id, language,
          payload_fingerprint, field_expectations_json,
          encrypted_product_id, target_display, original_display,
          trace_id, reason_code, message,
          submitted_time_utc, last_checked_time_utc, completed_time_utc,
          create_time_utc, update_time_utc, creator_id, updater_id, revision, remark
        ) VALUES (?, ?, ?, 'updateProductDisplay', 'submitted', NULL, NULL, ?, '[]', ?, ?, ?,
          NULL, NULL, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.requestId,
          productId,
          input.payloadFingerprint,
          encryptedProductId,
          input.targetDisplay,
          input.originalDisplay,
          now,
          audit.createTimeUtc,
          audit.updateTimeUtc,
          audit.creatorId,
          audit.updaterId,
          audit.revision,
          audit.remark
        ]
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        /product_mutation_jobs_(open_product|request_target)_unique|UNIQUE constraint failed/iu.test(
          error.message
        )
      ) {
        throw new ProductMutationJobConflictError();
      }
      throw error;
    }
    return this.#require(id);
  }

  async transition(input: ProductMutationJobTransitionInput): Promise<ProductMutationJob> {
    const current = await this.#require(input.id);
    if (current.revision !== input.expectedRevision) throw new EntityVersionConflictError();
    assertStatus(input.status);
    assertTransition(current.status, input.status);
    const now = this.#clock();
    const audit = updateEntityAuditFields(current, input.actorId, now, current.remark);
    const terminal = input.status === 'verified' || input.status === 'recovered' || input.status === 'failed';
    const result = await this.#executor.execute(
      `UPDATE product_mutation_jobs SET status = ?, trace_id = ?, reason_code = ?, message = ?,
       last_checked_time_utc = ?, completed_time_utc = ?, update_time_utc = ?, updater_id = ?, revision = ?
       WHERE id = ? AND revision = ?`,
      [
        input.status,
        normalizeNullable(input.traceId ?? current.traceId, 128),
        normalizeNullable(input.reasonCode ?? current.reasonCode, 128),
        normalizeNullable(input.message ?? current.message, 1000),
        input.checked === true ? now : current.lastCheckedTimeUtc,
        terminal ? now : null,
        audit.updateTimeUtc,
        audit.updaterId,
        audit.revision,
        current.id,
        input.expectedRevision
      ]
    );
    if (result.changes !== 1) throw new EntityVersionConflictError();
    return this.#require(current.id);
  }

  async #require(id: string): Promise<ProductMutationJob> {
    const entity = await this.get(id);
    if (!entity) throw new ProductMutationJobNotFoundError();
    return entity;
  }
}

function assertTransition(from: ProductMutationJobStatus, to: ProductMutationJobStatus): void {
  const allowed: Record<ProductMutationJobStatus, readonly ProductMutationJobStatus[]> = {
    submitted: ['auditing', 'verifying', 'recovery-required', 'failed'],
    auditing: ['auditing', 'verified', 'recovery-required'],
    verifying: ['verifying', 'verified', 'recovery-required'],
    verified: [],
    'recovery-required': ['recovery-required', 'verified', 'recovering', 'failed'],
    recovering: ['recovering', 'recovered', 'recovery-required'],
    recovered: [],
    failed: []
  };
  if (!allowed[from].includes(to)) throw new Error(`商品写入任务不能从 ${from} 变更为 ${to}`);
}

function assertStatus(value: string): asserts value is ProductMutationJobStatus {
  if (![...BLOCKING_STATUSES, 'verified', 'recovered', 'failed'].some((candidate) => candidate === value)) {
    throw new Error('商品写入任务状态无效');
  }
}

function normalizeExpectations(
  values: readonly ProductMutationFieldExpectation[]
): ProductMutationFieldExpectation[] {
  if (values.length === 0 || values.length > 128) throw new Error('商品写入字段指纹数量无效');
  const seen = new Set<string>();
  return values.map((value) => {
    const fieldId = value.fieldId.trim();
    if (!fieldId || fieldId.length > 128 || seen.has(fieldId)) throw new Error('商品写入字段 ID 无效');
    if (!FINGERPRINT_PATTERN.test(value.fingerprint)) throw new Error('商品写入字段指纹无效');
    seen.add(fieldId);
    return { fieldId, fingerprint: value.fingerprint };
  });
}

function normalizeId(value: string): string {
  const id = value.trim();
  if (!id) throw new Error('商品写入任务 ID 不能为空');
  return id;
}

function normalizeProductId(value: string): string {
  const productId = value.trim();
  if (!/^[1-9][0-9]*$/u.test(productId)) throw new Error('商品 ID 无效');
  return productId;
}

function normalizeNullable(value: string | null, maxLength: number): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function toEntity(row: Record<string, unknown>): ProductMutationJob {
  return {
    id: readString(row, 'id'),
    requestId: readString(row, 'request_id'),
    productId: readString(row, 'product_id'),
    operation: readEnum(row, 'operation', ['updateProduct', 'updateProductDisplay']),
    status: readEnum(row, 'status', [
      'submitted',
      'auditing',
      'verifying',
      'verified',
      'recovery-required',
      'recovering',
      'recovered',
      'failed'
    ]),
    categoryId: readNullableNumber(row, 'category_id'),
    language: readNullableEnum(row, 'language', ['zh_CN', 'en_US']),
    payloadFingerprint: readString(row, 'payload_fingerprint'),
    fieldExpectations: parseExpectations(readString(row, 'field_expectations_json')),
    encryptedProductId: readNullableString(row, 'encrypted_product_id'),
    targetDisplay: readNullableEnum(row, 'target_display', ['online', 'offline']),
    originalDisplay: readNullableEnum(row, 'original_display', ['online', 'offline']),
    traceId: readNullableString(row, 'trace_id'),
    reasonCode: readNullableString(row, 'reason_code'),
    message: readNullableString(row, 'message'),
    submittedTimeUtc: readNumber(row, 'submitted_time_utc'),
    lastCheckedTimeUtc: readNullableNumber(row, 'last_checked_time_utc'),
    completedTimeUtc: readNullableNumber(row, 'completed_time_utc'),
    createTimeUtc: readNumber(row, 'create_time_utc'),
    updateTimeUtc: readNumber(row, 'update_time_utc'),
    creatorId: readString(row, 'creator_id'),
    updaterId: readString(row, 'updater_id'),
    revision: readNumber(row, 'revision'),
    remark: readNullableString(row, 'remark')
  };
}

function parseExpectations(value: string): ProductMutationFieldExpectation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('数据库字段 field_expectations_json 无效');
  }
  if (!Array.isArray(parsed)) throw new Error('数据库字段 field_expectations_json 无效');
  if (parsed.length === 0) return [];
  return normalizeExpectations(
    parsed.map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new Error('数据库字段 field_expectations_json 无效');
      }
      const record = item as Record<string, unknown>;
      if (typeof record.fieldId !== 'string' || typeof record.fingerprint !== 'string') {
        throw new Error('数据库字段 field_expectations_json 无效');
      }
      if (Object.keys(record).some((key) => key !== 'fieldId' && key !== 'fingerprint')) {
        throw new Error('数据库字段 field_expectations_json 无效');
      }
      return { fieldId: record.fieldId, fingerprint: record.fingerprint };
    })
  );
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`数据库字段 ${key} 无效`);
  return value;
}

function readNullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  return readString(row, key);
}

function readNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`数据库字段 ${key} 无效`);
  return value;
}

function readNullableNumber(row: Record<string, unknown>, key: string): number | null {
  return row[key] === null ? null : readNumber(row, key);
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

function readNullableEnum<const T extends string>(
  row: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): T | null {
  return row[key] === null ? null : readEnum(row, key, allowed);
}

function normalizeEncryptedProductId(value: string): string {
  const productId = value.trim();
  if (!productId || productId.length > 256 || productId.includes(',')) {
    throw new Error('商品混淆 ID 无效');
  }
  return productId;
}
