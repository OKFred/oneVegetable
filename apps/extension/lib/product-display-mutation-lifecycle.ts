import {
  GatewayException,
  isProductMutationJob,
  productMutationJobIsBlocking,
  productMutationJobIsTerminal,
  type Product,
  type ProductDisplayMutationResult,
  type ProductDisplayRequest,
  type ProductListQuery,
  type ProductMutationJob,
  type ProductMutationJobListInput,
  type ProductMutationJobPage,
  type ProductMutationJobStatus,
  type ProductPage
} from '@one-vegetable/core';
import { EXTENSION_PRODUCT_MUTATION_JOBS_STORAGE_KEY } from './product-display-mutation-storage';

const STORAGE_SCHEMA_VERSION = 1;
const ACTOR_ID = 'extension:local-admin';
const VERIFICATION_TIMEOUT_MILLISECONDS = 2 * 60 * 1000;
const TERMINAL_RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;
const MAX_TERMINAL_JOBS = 100;

interface StoredProductMutationJobs {
  schemaVersion: 1;
  jobs: ProductMutationJob[];
}

export interface ExtensionProductMutationStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ExtensionProductDisplayGateway {
  list(request: ProductListQuery): Promise<ProductPage>;
  updateDisplay(request: ProductDisplayRequest): Promise<ProductDisplayMutationResult>;
}

export type ExtensionProductDisplaySubmissionResult = ProductDisplayMutationResult & {
  jobs: ProductMutationJob[];
};

export class ExtensionProductDisplayMutationLifecycle {
  #operationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: ExtensionProductMutationStorage,
    private readonly clock: () => number = Date.now
  ) {}

  submit(
    gateway: ExtensionProductDisplayGateway,
    requestId: string,
    request: ProductDisplayRequest
  ): Promise<ExtensionProductDisplaySubmissionResult> {
    return this.#exclusive(async () => {
      assertRequestPairing(request);
      const products = await readProducts(gateway, request);
      const currentJobs = await this.#readJobs();
      const stableProducts = products.map((product) => {
        const originalDisplay = product.status;
        const blocking = currentJobs.find(
          (job) => job.productId === product.id && productMutationJobIsBlocking(job.status)
        );
        if (blocking) throw mutationInProgress(blocking);
        if (originalDisplay === 'auditing') {
          throw gatewayError(
            'PRODUCT_DISPLAY_PLATFORM_AUDITING',
            `商品 ${product.id} 正在平台审核中，不能重复提交上下架`
          );
        }
        if (originalDisplay === request.display) {
          throw gatewayError(
            'PRODUCT_DISPLAY_NO_CHANGE',
            `商品 ${product.id} 已处于${request.display === 'online' ? '上架' : '下架'}状态`
          );
        }
        return { product, originalDisplay };
      });

      const now = this.clock();
      const jobs = await Promise.all(
        stableProducts.map(async ({ product, originalDisplay }, index) => {
          const encryptedProductId = request.encryptedProductIds[index];
          if (!encryptedProductId) throw targetMismatch();
          return createDisplayJob({
            requestId,
            productId: product.id,
            encryptedProductId,
            originalDisplay,
            targetDisplay: request.display,
            payloadFingerprint: await displayFingerprint(product.id, encryptedProductId, request.display),
            now
          });
        })
      );
      await this.#writeJobs([...currentJobs, ...jobs]);

      let result: ProductDisplayMutationResult;
      try {
        result = await gateway.updateDisplay(request);
      } catch (error: unknown) {
        const details = errorDetails(error);
        const status: ProductMutationJobStatus = details.retryable ? 'recovery-required' : 'failed';
        await this.#transitionMany(
          jobs,
          status,
          {
            traceId: details.traceId,
            reasonCode: details.code,
            message: details.retryable
              ? `请求结果不确定，已停止重复操作并等待平台回读：${details.message}`
              : details.message
          },
          false
        );
        throw error;
      }
      const transitioned = await this.#transitionMany(
        jobs,
        'verifying',
        {
          traceId: result.traceId,
          reasonCode: 'ALIBABA_DISPLAY_MUTATION_ACCEPTED',
          message: 'Alibaba 已接受上下架请求，等待商品列表回读确认'
        },
        false
      );
      return { ...result, jobs: transitioned };
    });
  }

  async list(input: ProductMutationJobListInput = {}): Promise<ProductMutationJobPage> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      throw gatewayError('PRODUCT_MUTATION_LIST_INVALID', '商品写入任务分页参数无效');
    }
    const jobs = (await this.#readJobs())
      .filter((job) => input.productId === undefined || job.productId === input.productId)
      .filter((job) => input.status === undefined || job.status === input.status)
      .toSorted(
        (left, right) => right.submittedTimeUtc - left.submittedTimeUtc || right.id.localeCompare(left.id)
      );
    const offset = (page - 1) * pageSize;
    return {
      items: structuredClone(jobs.slice(offset, offset + pageSize)),
      page,
      pageSize,
      total: jobs.length
    };
  }

  async get(id: string): Promise<ProductMutationJob> {
    return structuredClone(await this.#requireJob(id));
  }

  refresh(
    gateway: ExtensionProductDisplayGateway,
    id: string,
    expectedRevision: number
  ): Promise<ProductMutationJob> {
    return this.#exclusive(async () => {
      const current = await this.#requireRevision(id, expectedRevision);
      if (productMutationJobIsTerminal(current.status)) return structuredClone(current);
      assertDisplayJob(current);
      try {
        const product = (
          await readProducts(gateway, {
            productIds: [current.productId],
            encryptedProductIds: [current.encryptedProductId],
            display: current.targetDisplay
          })
        )[0];
        if (!product) throw targetMismatch();
        const recovering = current.status === 'recovering';
        const expected = recovering ? current.originalDisplay : current.targetDisplay;
        if (product.status === 'auditing') {
          return await this.#transitionOne(
            current,
            current.status === 'recovering' ? 'recovering' : 'auditing',
            {
              reasonCode:
                current.status === 'recovering'
                  ? 'PRODUCT_DISPLAY_RECOVERY_PLATFORM_AUDITING'
                  : 'PRODUCT_DISPLAY_PLATFORM_AUDITING',
              message: '平台已进入商品审核，等待最终上下架状态；审核完成前不会重复提交'
            },
            true
          );
        }
        const matched = product.status === expected;
        const originalStateConfirmed =
          current.status === 'recovery-required' && product.status === current.originalDisplay;
        const timedOut = this.clock() - current.submittedTimeUtc >= VERIFICATION_TIMEOUT_MILLISECONDS;
        const status: ProductMutationJobStatus = originalStateConfirmed
          ? 'recovered'
          : matched
            ? recovering
              ? 'recovered'
              : 'verified'
            : current.status === 'recovery-required' || timedOut
              ? 'recovery-required'
              : current.status;
        return await this.#transitionOne(
          current,
          status,
          {
            reasonCode: originalStateConfirmed
              ? 'PRODUCT_DISPLAY_ORIGINAL_STATE_CONFIRMED'
              : matched
                ? recovering
                  ? 'PRODUCT_DISPLAY_RECOVERY_MATCHED'
                  : 'PRODUCT_DISPLAY_READBACK_MATCHED'
                : status === 'recovery-required'
                  ? 'PRODUCT_DISPLAY_READBACK_TIMEOUT'
                  : 'PRODUCT_DISPLAY_READBACK_PENDING',
            message: originalStateConfirmed
              ? `平台回读确认商品仍为操作前的${current.originalDisplay === 'online' ? '上架' : '下架'}状态`
              : matched
                ? `平台回读状态已确认为${expected === 'online' ? '上架' : '下架'}`
                : `平台当前仍为${product.status === 'online' ? '上架' : '下架'}，继续等待回读`
          },
          true
        );
      } catch (error: unknown) {
        const details = errorDetails(error);
        const timedOut = this.clock() - current.submittedTimeUtc >= VERIFICATION_TIMEOUT_MILLISECONDS;
        const status =
          current.status === 'recovery-required' || timedOut ? 'recovery-required' : current.status;
        return await this.#transitionOne(
          current,
          status,
          {
            traceId: details.traceId,
            reasonCode: details.code,
            message: details.message
          },
          true
        );
      }
    });
  }

  recover(
    gateway: ExtensionProductDisplayGateway,
    id: string,
    expectedRevision: number
  ): Promise<ProductMutationJob> {
    return this.#exclusive(async () => {
      const current = await this.#requireRevision(id, expectedRevision);
      assertDisplayJob(current);
      if (!['submitted', 'verifying', 'recovery-required'].includes(current.status)) {
        throw gatewayError('PRODUCT_MUTATION_RECOVERY_UNAVAILABLE', '当前任务不允许执行自动状态恢复');
      }
      try {
        const result = await gateway.updateDisplay({
          productIds: [current.productId],
          encryptedProductIds: [current.encryptedProductId],
          display: current.originalDisplay
        });
        return await this.#transitionOne(
          current,
          'recovering',
          {
            traceId: result.traceId,
            reasonCode: 'ALIBABA_DISPLAY_RECOVERY_ACCEPTED',
            message: 'Alibaba 已接受状态恢复请求，等待商品列表回读确认'
          },
          false
        );
      } catch (error: unknown) {
        const details = errorDetails(error);
        await this.#transitionOne(
          current,
          'recovery-required',
          {
            traceId: details.traceId,
            reasonCode: details.code,
            message: details.message
          },
          true
        );
        throw error;
      }
    });
  }

  async #requireRevision(id: string, expectedRevision: number): Promise<ProductMutationJob> {
    const current = await this.#requireJob(id);
    if (current.revision !== expectedRevision) {
      throw gatewayError('ENTITY_VERSION_CONFLICT', '商品写入任务状态已更新，请刷新后重试');
    }
    return current;
  }

  async #requireJob(id: string): Promise<ProductMutationJob> {
    const job = (await this.#readJobs()).find((candidate) => candidate.id === id);
    if (!job) throw gatewayError('PRODUCT_MUTATION_JOB_NOT_FOUND', '商品写入任务不存在');
    return job;
  }

  #transitionOne(
    current: ProductMutationJob,
    status: ProductMutationJobStatus,
    details: { traceId?: string | null; reasonCode: string; message: string },
    checked: boolean
  ): Promise<ProductMutationJob> {
    return this.#transitionMany([current], status, details, checked).then((jobs) => {
      const job = jobs[0];
      if (!job) throw gatewayError('PRODUCT_MUTATION_JOB_NOT_FOUND', '商品写入任务不存在');
      return job;
    });
  }

  async #transitionMany(
    expectedJobs: readonly ProductMutationJob[],
    status: ProductMutationJobStatus,
    details: { traceId?: string | null; reasonCode: string; message: string },
    checked: boolean
  ): Promise<ProductMutationJob[]> {
    const jobs = await this.#readJobs();
    const expectedById = new Map(expectedJobs.map((job) => [job.id, job]));
    const transitioned: ProductMutationJob[] = [];
    const now = this.clock();
    const next = jobs.map((job) => {
      const expected = expectedById.get(job.id);
      if (!expected) return job;
      if (job.revision !== expected.revision) {
        throw gatewayError('ENTITY_VERSION_CONFLICT', '商品写入任务状态已更新，请刷新后重试');
      }
      const updated = transitionJob(job, status, details, checked, now);
      transitioned.push(updated);
      return updated;
    });
    if (transitioned.length !== expectedJobs.length) {
      throw gatewayError('PRODUCT_MUTATION_JOB_NOT_FOUND', '商品写入任务不存在');
    }
    await this.#writeJobs(next);
    return transitioned;
  }

  async #readJobs(): Promise<ProductMutationJob[]> {
    const stored = await this.storage.get(EXTENSION_PRODUCT_MUTATION_JOBS_STORAGE_KEY);
    const value = stored[EXTENSION_PRODUCT_MUTATION_JOBS_STORAGE_KEY];
    if (value === undefined) return [];
    if (!isStoredJobs(value)) {
      throw gatewayError(
        'EXTENSION_PRODUCT_MUTATION_STORAGE_INVALID',
        '插件商品写入任务存储无效；为避免重复操作，真实上下架已停止'
      );
    }
    return structuredClone(value.jobs);
  }

  async #writeJobs(jobs: readonly ProductMutationJob[]): Promise<void> {
    const now = this.clock();
    const blocking = jobs.filter((job) => productMutationJobIsBlocking(job.status));
    const terminal = jobs
      .filter(
        (job) =>
          productMutationJobIsTerminal(job.status) &&
          now - (job.completedTimeUtc ?? job.updateTimeUtc) <= TERMINAL_RETENTION_MILLISECONDS
      )
      .toSorted((left, right) => right.updateTimeUtc - left.updateTimeUtc)
      .slice(0, MAX_TERMINAL_JOBS);
    const value: StoredProductMutationJobs = {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      jobs: [...blocking, ...terminal].toSorted(
        (left, right) => left.submittedTimeUtc - right.submittedTimeUtc || left.id.localeCompare(right.id)
      )
    };
    await this.storage.set({ [EXTENSION_PRODUCT_MUTATION_JOBS_STORAGE_KEY]: value });
  }

  async #exclusive<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.#operationTail;
    let release: () => void = () => undefined;
    this.#operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => undefined);
    try {
      return await action();
    } finally {
      release();
    }
  }
}

function createDisplayJob(input: {
  requestId: string;
  productId: string;
  encryptedProductId: string;
  originalDisplay: 'online' | 'offline';
  targetDisplay: 'online' | 'offline';
  payloadFingerprint: string;
  now: number;
}): ProductMutationJob {
  return {
    id: crypto.randomUUID(),
    requestId: input.requestId,
    productId: input.productId,
    operation: 'updateProductDisplay',
    status: 'submitted',
    categoryId: null,
    language: null,
    payloadFingerprint: input.payloadFingerprint,
    fieldExpectations: [],
    encryptedProductId: input.encryptedProductId,
    targetDisplay: input.targetDisplay,
    originalDisplay: input.originalDisplay,
    traceId: null,
    reasonCode: null,
    message: null,
    submittedTimeUtc: input.now,
    lastCheckedTimeUtc: null,
    completedTimeUtc: null,
    createTimeUtc: input.now,
    updateTimeUtc: input.now,
    creatorId: ACTOR_ID,
    updaterId: ACTOR_ID,
    revision: 1,
    remark: null
  };
}

function transitionJob(
  current: ProductMutationJob,
  status: ProductMutationJobStatus,
  details: { traceId?: string | null; reasonCode: string; message: string },
  checked: boolean,
  now: number
): ProductMutationJob {
  const terminal = productMutationJobIsTerminal(status);
  return {
    ...current,
    status,
    traceId: details.traceId === undefined ? current.traceId : details.traceId,
    reasonCode: details.reasonCode,
    message: details.message,
    lastCheckedTimeUtc: checked ? now : current.lastCheckedTimeUtc,
    completedTimeUtc: terminal ? now : null,
    updateTimeUtc: now,
    updaterId: ACTOR_ID,
    revision: current.revision + 1
  };
}

async function readProducts(
  gateway: ExtensionProductDisplayGateway,
  request: ProductDisplayRequest
): Promise<(Product & { status: 'online' | 'offline' | 'auditing' })[]> {
  const expectedByEncryptedId = new Map(
    request.encryptedProductIds.map((encryptedId, index) => [encryptedId, request.productIds[index]])
  );
  const found = new Map<string, Product>();
  for (let page = 1; page <= 100; page += 1) {
    const result = await gateway.list({ page, pageSize: 100, language: 'en_US' });
    for (const product of result.items) {
      if (product.encryptedId && expectedByEncryptedId.has(product.encryptedId)) {
        found.set(product.encryptedId, product);
      }
    }
    if (found.size === expectedByEncryptedId.size || page * result.pageSize >= result.total) break;
  }
  return request.encryptedProductIds.map((encryptedId) => {
    const product = found.get(encryptedId);
    const expectedProductId = expectedByEncryptedId.get(encryptedId);
    if (
      !product ||
      !expectedProductId ||
      product.id !== expectedProductId ||
      (product.status !== 'online' && product.status !== 'offline' && product.status !== 'auditing')
    ) {
      throw targetMismatch();
    }
    return product as Product & { status: 'online' | 'offline' | 'auditing' };
  });
}

function assertRequestPairing(request: ProductDisplayRequest): void {
  if (request.productIds.length === 0 || request.productIds.length !== request.encryptedProductIds.length) {
    throw targetMismatch();
  }
}

function assertDisplayJob(job: ProductMutationJob): asserts job is ProductMutationJob & {
  encryptedProductId: string;
  targetDisplay: 'online' | 'offline';
  originalDisplay: 'online' | 'offline';
} {
  if (
    job.operation !== 'updateProductDisplay' ||
    job.encryptedProductId === null ||
    job.targetDisplay === null ||
    job.originalDisplay === null
  ) {
    throw gatewayError('PRODUCT_MUTATION_JOB_INVALID', '商品上下架任务缺少状态快照');
  }
}

async function displayFingerprint(
  productId: string,
  encryptedProductId: string,
  display: 'online' | 'offline'
): Promise<string> {
  const bytes = new TextEncoder().encode(`${productId}\n${encryptedProductId}\n${display}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function isStoredJobs(value: unknown): value is StoredProductMutationJobs {
  if (!isRecord(value) || value.schemaVersion !== STORAGE_SCHEMA_VERSION || !Array.isArray(value.jobs)) {
    return false;
  }
  return value.jobs.every(isProductMutationJob);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorDetails(error: unknown): {
  code: string;
  message: string;
  traceId: string | null;
  retryable: boolean;
} {
  if (error instanceof GatewayException) {
    return {
      code: error.gatewayError.code,
      message: error.gatewayError.message,
      traceId: error.gatewayError.traceId ?? null,
      retryable: error.gatewayError.retryable
    };
  }
  return {
    code: 'PRODUCT_MUTATION_LIFECYCLE_ERROR',
    message: error instanceof Error ? error.message : '商品写入任务处理失败',
    traceId: null,
    retryable: true
  };
}

function mutationInProgress(job: ProductMutationJob): GatewayException {
  return gatewayError(
    'PRODUCT_MUTATION_ALREADY_IN_PROGRESS',
    `商品 ${job.productId} 已有 ${job.status} 写入任务`
  );
}

function targetMismatch(): GatewayException {
  return gatewayError(
    'PRODUCT_DISPLAY_TARGET_MISMATCH',
    '商品明文 ID、混淆 ID 或平台状态无法通过实时列表核对'
  );
}

function gatewayError(code: string, message: string): GatewayException {
  return new GatewayException({ code, message, retryable: false });
}
