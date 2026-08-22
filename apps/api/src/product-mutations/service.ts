import {
  compareProductMutationFingerprints,
  createProductMutationFingerprints,
  GatewayException
} from '@one-vegetable/core';
import { DOMParser as ServerDomParser } from 'linkedom';

import type {
  ProductMutationJob,
  ProductMutationJobPage,
  ProductMutationJobStatus,
  Product,
  ProductDisplayMutationResult,
  ProductDisplayRequest,
  ProductListQuery,
  ProductPage,
  ProductMutationResult,
  ProductSchema,
  ProductSchemaRenderRequest,
  ProductSchemaUpdateRequest,
  ProductSchemaXmlParser
} from '@one-vegetable/core';
import type { AuthService } from '../auth/service';
import type { AuthPrincipal } from '../auth/types';
import type { ProductMutationJobListQuery, ProductMutationJobRepository } from './repository';

const SERVER_XML_PARSER: ProductSchemaXmlParser = {
  parseFromString(xml) {
    return new ServerDomParser().parseFromString(xml, 'text/xml') as unknown as XMLDocument;
  }
};

export interface ProductMutationGateway {
  update(request: ProductSchemaUpdateRequest, requestId: string): Promise<ProductMutationResult>;
  render(request: ProductSchemaRenderRequest, requestId: string): Promise<ProductSchema>;
  updateDisplay(request: ProductDisplayRequest, requestId: string): Promise<ProductDisplayMutationResult>;
  list(request: ProductListQuery, requestId: string): Promise<ProductPage>;
}

export type ProductMutationSubmissionResult = ProductMutationResult & { job: ProductMutationJob };
export type ProductDisplayMutationSubmissionResult = ProductDisplayMutationResult & {
  jobs: ProductMutationJob[];
};

const DISPLAY_VERIFICATION_TIMEOUT_MILLISECONDS = 2 * 60 * 1000;

export class ProductMutationLifecycleService {
  readonly #repository: ProductMutationJobRepository;
  readonly #gateway: ProductMutationGateway;
  readonly #authService: AuthService | undefined;
  readonly #clock: () => number;

  constructor(
    repository: ProductMutationJobRepository,
    gateway: ProductMutationGateway,
    authService?: AuthService,
    clock: () => number = Date.now
  ) {
    this.#repository = repository;
    this.#gateway = gateway;
    this.#authService = authService;
    this.#clock = clock;
  }

  async submitDisplay(input: {
    requestId: string;
    actor: AuthPrincipal;
    request: ProductDisplayRequest;
  }): Promise<ProductDisplayMutationSubmissionResult> {
    assertDisplayRequestPairing(input.request);
    const products = await this.#readDisplayProducts(input.request, input.requestId);
    for (const product of products) {
      const blocking = await this.#repository.findBlocking(product.id);
      if (blocking) throw new ProductMutationAlreadyInProgressError(blocking);
      if (product.status === input.request.display) {
        throw new ProductDisplayNoChangeError(product.id, input.request.display);
      }
    }

    const jobs: ProductMutationJob[] = [];
    try {
      for (const [index, product] of products.entries()) {
        const encryptedProductId = input.request.encryptedProductIds[index];
        if (!encryptedProductId) throw new ProductDisplayTargetMismatchError();
        const job = await this.#repository.createDisplay({
          requestId: input.requestId,
          productId: product.id,
          encryptedProductId,
          targetDisplay: input.request.display,
          originalDisplay: product.status as 'online' | 'offline',
          payloadFingerprint: await createDisplayFingerprint(
            product.id,
            encryptedProductId,
            input.request.display
          ),
          actorId: input.actor.actorId
        });
        jobs.push(job);
        await this.#audit(job, input.requestId, input.actor.actorId, 'submitted', null);
      }
      const result = await this.#gateway.updateDisplay(input.request, input.requestId);
      const verifyingJobs: ProductMutationJob[] = [];
      for (const job of jobs) {
        const verifying = await this.#repository.transition({
          id: job.id,
          expectedRevision: job.revision,
          status: 'verifying',
          actorId: input.actor.actorId,
          traceId: result.traceId,
          reasonCode: 'ALIBABA_DISPLAY_MUTATION_ACCEPTED',
          message: 'Alibaba 已接受上下架请求，等待商品列表回读确认'
        });
        verifyingJobs.push(verifying);
        await this.#audit(verifying, input.requestId, input.actor.actorId, 'verifying', job.revision);
      }
      return { ...result, jobs: verifyingJobs };
    } catch (error: unknown) {
      const details = errorDetails(error);
      for (const job of jobs) {
        const current = await this.#repository.get(job.id);
        if (current?.status !== 'submitted') continue;
        const failed = await this.#repository.transition({
          id: current.id,
          expectedRevision: current.revision,
          status: 'failed',
          actorId: input.actor.actorId,
          traceId: details.traceId,
          reasonCode: details.code,
          message: details.message
        });
        await this.#audit(failed, input.requestId, input.actor.actorId, 'failed', current.revision);
      }
      throw error;
    }
  }

  async submitUpdate(input: {
    requestId: string;
    actor: AuthPrincipal;
    request: ProductSchemaUpdateRequest;
  }): Promise<ProductMutationSubmissionResult> {
    const blocking = await this.#repository.findBlocking(input.request.productId);
    if (blocking) throw new ProductMutationAlreadyInProgressError(blocking);
    const fingerprints = await createProductMutationFingerprints(
      input.request.schemaPatchXml,
      SERVER_XML_PARSER
    );
    let job = await this.#repository.create({
      requestId: input.requestId,
      productId: input.request.productId,
      categoryId: input.request.categoryId,
      language: normalizeLanguage(input.request.language),
      payloadFingerprint: fingerprints.payloadFingerprint,
      fieldExpectations: fingerprints.fieldExpectations,
      actorId: input.actor.actorId
    });
    await this.#audit(job, input.requestId, input.actor.actorId, 'submitted', null);
    try {
      const result = await this.#gateway.update(input.request, input.requestId);
      job = await this.#repository.transition({
        id: job.id,
        expectedRevision: job.revision,
        status: 'auditing',
        actorId: input.actor.actorId,
        traceId: result.traceId,
        reasonCode: 'ALIBABA_MUTATION_ACCEPTED',
        message: 'Alibaba 已接受更新，等待平台审核和回读确认'
      });
      await this.#audit(job, input.requestId, input.actor.actorId, 'auditing', 1);
      return { ...result, job };
    } catch (error: unknown) {
      const details = errorDetails(error);
      const failed = await this.#repository.transition({
        id: job.id,
        expectedRevision: job.revision,
        status: 'failed',
        actorId: input.actor.actorId,
        traceId: details.traceId,
        reasonCode: details.code,
        message: details.message
      });
      await this.#audit(failed, input.requestId, input.actor.actorId, 'failed', job.revision);
      throw error;
    }
  }

  async refresh(input: {
    requestId: string;
    actor: AuthPrincipal;
    id: string;
    expectedRevision: number;
  }): Promise<ProductMutationJob> {
    const current = await this.#requireVisible(input.id, input.actor);
    if (current.revision !== input.expectedRevision) throw new ProductMutationRevisionConflictError();
    if (current.status === 'verified' || current.status === 'recovered' || current.status === 'failed') {
      return current;
    }
    if (current.operation === 'updateProductDisplay') return this.#refreshDisplay(current, input);
    if (current.categoryId === null || current.language === null) {
      throw new Error('商品 Schema 写入任务缺少类目或语言');
    }
    try {
      const rendered = await this.#gateway.render(
        {
          productId: current.productId,
          categoryId: current.categoryId,
          language: current.language
        },
        input.requestId
      );
      const comparison = await compareProductMutationFingerprints(
        rendered.xml,
        current.fieldExpectations,
        SERVER_XML_PARSER
      );
      const status: ProductMutationJobStatus = comparison.matched ? 'verified' : 'recovery-required';
      const reasonCode = comparison.matched
        ? 'PRODUCT_MUTATION_READBACK_MATCHED'
        : 'PRODUCT_MUTATION_READBACK_MISMATCH';
      const message = comparison.matched
        ? '平台回读值与本次更新一致'
        : summarizeMismatch(comparison.missingFieldIds, comparison.mismatchedFieldIds);
      const updated = await this.#repository.transition({
        id: current.id,
        expectedRevision: current.revision,
        status,
        actorId: input.actor.actorId,
        reasonCode,
        message,
        checked: true
      });
      await this.#audit(updated, input.requestId, input.actor.actorId, status, current.revision);
      return updated;
    } catch (error: unknown) {
      const details = errorDetails(error);
      const underAudit = details.code === 'PUB_BIZCHECK_PRODUCT_IN_AUDITING';
      const status = statusAfterRefreshError(current.status, underAudit || details.retryable);
      const updated = await this.#repository.transition({
        id: current.id,
        expectedRevision: current.revision,
        status,
        actorId: input.actor.actorId,
        traceId: details.traceId,
        reasonCode: details.code,
        message: details.message,
        checked: true
      });
      await this.#audit(updated, input.requestId, input.actor.actorId, status, current.revision);
      return updated;
    }
  }

  async recover(input: {
    requestId: string;
    actor: AuthPrincipal;
    id: string;
    expectedRevision: number;
  }): Promise<ProductMutationJob> {
    const current = await this.#requireVisible(input.id, input.actor);
    if (current.revision !== input.expectedRevision) throw new ProductMutationRevisionConflictError();
    if (
      current.operation !== 'updateProductDisplay' ||
      !['submitted', 'verifying', 'recovery-required'].includes(current.status) ||
      current.encryptedProductId === null ||
      current.originalDisplay === null
    ) {
      throw new ProductMutationRecoveryNotAvailableError();
    }
    try {
      const result = await this.#gateway.updateDisplay(
        {
          productIds: [current.productId],
          encryptedProductIds: [current.encryptedProductId],
          display: current.originalDisplay
        },
        input.requestId
      );
      const recovering = await this.#repository.transition({
        id: current.id,
        expectedRevision: current.revision,
        status: 'recovering',
        actorId: input.actor.actorId,
        traceId: result.traceId,
        reasonCode: 'ALIBABA_DISPLAY_RECOVERY_ACCEPTED',
        message: 'Alibaba 已接受状态恢复请求，等待商品列表回读确认'
      });
      await this.#audit(recovering, input.requestId, input.actor.actorId, 'recovering', current.revision);
      return recovering;
    } catch (error: unknown) {
      const details = errorDetails(error);
      const updated = await this.#repository.transition({
        id: current.id,
        expectedRevision: current.revision,
        status: 'recovery-required',
        actorId: input.actor.actorId,
        traceId: details.traceId,
        reasonCode: details.code,
        message: details.message,
        checked: true
      });
      await this.#audit(updated, input.requestId, input.actor.actorId, 'recovery-required', current.revision);
      throw error;
    }
  }

  async get(id: string, actor: AuthPrincipal): Promise<ProductMutationJob> {
    return this.#requireVisible(id, actor);
  }

  async list(query: ProductMutationJobListQuery, actor: AuthPrincipal): Promise<ProductMutationJobPage> {
    const result = await this.#repository.list({
      ...query,
      ...(actor.role === 'user' ? { actorId: actor.actorId } : {})
    });
    return { ...result, page: query.page, pageSize: query.pageSize };
  }

  async #requireVisible(id: string, actor: AuthPrincipal): Promise<ProductMutationJob> {
    const job = await this.#repository.get(id);
    if (!job || (actor.role !== 'admin' && job.creatorId !== actor.actorId)) {
      throw new ProductMutationJobAccessError();
    }
    return job;
  }

  async #refreshDisplay(
    current: ProductMutationJob,
    input: { requestId: string; actor: AuthPrincipal }
  ): Promise<ProductMutationJob> {
    if (
      current.encryptedProductId === null ||
      current.targetDisplay === null ||
      current.originalDisplay === null
    ) {
      throw new Error('商品上下架任务缺少状态快照');
    }
    try {
      const product = (
        await this.#readDisplayProducts(
          {
            productIds: [current.productId],
            encryptedProductIds: [current.encryptedProductId],
            display: current.targetDisplay
          },
          input.requestId
        )
      )[0];
      if (!product) throw new ProductDisplayTargetMismatchError();
      const expected = current.status === 'recovering' ? current.originalDisplay : current.targetDisplay;
      const matched = product.status === expected;
      const timedOut = this.#clock() - current.submittedTimeUtc >= DISPLAY_VERIFICATION_TIMEOUT_MILLISECONDS;
      const status: ProductMutationJobStatus = matched
        ? current.status === 'recovering'
          ? 'recovered'
          : 'verified'
        : current.status === 'recovery-required' || timedOut
          ? 'recovery-required'
          : current.status;
      const reasonCode = matched
        ? current.status === 'recovering'
          ? 'PRODUCT_DISPLAY_RECOVERY_MATCHED'
          : 'PRODUCT_DISPLAY_READBACK_MATCHED'
        : status === 'recovery-required'
          ? 'PRODUCT_DISPLAY_READBACK_TIMEOUT'
          : 'PRODUCT_DISPLAY_READBACK_PENDING';
      const message = matched
        ? `平台回读状态已确认为${expected === 'online' ? '上架' : '下架'}`
        : `平台当前仍为${product.status === 'online' ? '上架' : '下架'}，继续等待回读`;
      const updated = await this.#repository.transition({
        id: current.id,
        expectedRevision: current.revision,
        status,
        actorId: input.actor.actorId,
        reasonCode,
        message,
        checked: true
      });
      await this.#audit(updated, input.requestId, input.actor.actorId, status, current.revision);
      return updated;
    } catch (error: unknown) {
      const details = errorDetails(error);
      const timedOut = this.#clock() - current.submittedTimeUtc >= DISPLAY_VERIFICATION_TIMEOUT_MILLISECONDS;
      const status: ProductMutationJobStatus =
        current.status === 'recovery-required' || timedOut ? 'recovery-required' : current.status;
      const updated = await this.#repository.transition({
        id: current.id,
        expectedRevision: current.revision,
        status,
        actorId: input.actor.actorId,
        traceId: details.traceId,
        reasonCode: details.code,
        message: details.message,
        checked: true
      });
      await this.#audit(updated, input.requestId, input.actor.actorId, status, current.revision);
      return updated;
    }
  }

  async #readDisplayProducts(request: ProductDisplayRequest, requestId: string): Promise<Product[]> {
    const expectedByEncryptedId = new Map(
      request.encryptedProductIds.map((encryptedId, index) => [encryptedId, request.productIds[index]])
    );
    const found = new Map<string, Product>();
    for (let page = 1; page <= 100; page += 1) {
      const result = await this.#gateway.list({ page, pageSize: 100, language: 'en_US' }, requestId);
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
        (product.status !== 'online' && product.status !== 'offline')
      ) {
        throw new ProductDisplayTargetMismatchError();
      }
      return product;
    });
  }

  #audit(
    job: ProductMutationJob,
    requestId: string,
    actorId: string,
    status: ProductMutationJobStatus,
    revisionBefore: number | null
  ): Promise<unknown> {
    return (
      this.#authService?.audit({
        requestId,
        actorId,
        action: `product-mutation.${status}`,
        resourceKind: 'product-mutation-job',
        resourceId: job.id,
        outcome: status === 'failed' ? 'error' : 'success',
        reasonCode: job.reasonCode ?? `PRODUCT_MUTATION_${status.toLocaleUpperCase().replace('-', '_')}`,
        revisionBefore,
        revisionAfter: job.revision
      }) ?? Promise.resolve()
    );
  }
}

export class ProductMutationAlreadyInProgressError extends Error {
  readonly job: ProductMutationJob;

  constructor(job: ProductMutationJob) {
    super(`商品 ${job.productId} 已有 ${job.status} 写入任务`);
    this.name = 'ProductMutationAlreadyInProgressError';
    this.job = job;
  }
}

export class ProductMutationRevisionConflictError extends Error {
  constructor() {
    super('商品写入任务状态已更新，请刷新后重试');
    this.name = 'ProductMutationRevisionConflictError';
  }
}

export class ProductMutationJobAccessError extends Error {
  constructor() {
    super('商品写入任务不存在或当前身份不可见');
    this.name = 'ProductMutationJobAccessError';
  }
}

export class ProductDisplayTargetMismatchError extends Error {
  constructor() {
    super('商品明文 ID、混淆 ID 或平台状态无法通过实时列表核对');
    this.name = 'ProductDisplayTargetMismatchError';
  }
}

export class ProductDisplayNoChangeError extends Error {
  constructor(productId: string, display: 'online' | 'offline') {
    super(`商品 ${productId} 已处于${display === 'online' ? '上架' : '下架'}状态`);
    this.name = 'ProductDisplayNoChangeError';
  }
}

export class ProductMutationRecoveryNotAvailableError extends Error {
  constructor() {
    super('当前任务不允许执行自动状态恢复');
    this.name = 'ProductMutationRecoveryNotAvailableError';
  }
}

function statusAfterRefreshError(
  current: ProductMutationJobStatus,
  waitAndRetry: boolean
): ProductMutationJobStatus {
  if (current === 'recovery-required') return current;
  if (waitAndRetry) return 'auditing';
  return 'recovery-required';
}

function summarizeMismatch(missing: readonly string[], mismatched: readonly string[]): string {
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`回读缺少 ${missing.length} 个字段`);
  if (mismatched.length > 0) parts.push(`回读有 ${mismatched.length} 个字段值不一致`);
  return `${parts.join('，')}，请保留本地草稿并人工确认是否需要恢复`;
}

function normalizeLanguage(value: string): 'zh_CN' | 'en_US' {
  if (value !== 'zh_CN' && value !== 'en_US') throw new Error('商品语言无效');
  return value;
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
    retryable: false
  };
}

function assertDisplayRequestPairing(request: ProductDisplayRequest): void {
  if (request.productIds.length === 0 || request.productIds.length !== request.encryptedProductIds.length) {
    throw new ProductDisplayTargetMismatchError();
  }
}

async function createDisplayFingerprint(
  productId: string,
  encryptedProductId: string,
  display: 'online' | 'offline'
): Promise<string> {
  const bytes = new TextEncoder().encode(`${productId}\n${encryptedProductId}\n${display}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
