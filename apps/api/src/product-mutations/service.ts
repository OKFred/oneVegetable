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
}

export type ProductMutationSubmissionResult = ProductMutationResult & { job: ProductMutationJob };

export class ProductMutationLifecycleService {
  readonly #repository: ProductMutationJobRepository;
  readonly #gateway: ProductMutationGateway;
  readonly #authService: AuthService | undefined;

  constructor(
    repository: ProductMutationJobRepository,
    gateway: ProductMutationGateway,
    authService?: AuthService
  ) {
    this.#repository = repository;
    this.#gateway = gateway;
    this.#authService = authService;
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
    if (current.status === 'verified' || current.status === 'failed') return current;
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
