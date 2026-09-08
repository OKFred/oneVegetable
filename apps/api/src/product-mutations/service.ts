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
  ProductDetail,
  ProductDisplayMutationResult,
  ProductDisplayRequest,
  ProductListQuery,
  ProductPage,
  ProductMutationResult,
  ProductSchema,
  SchemaPublishRequest,
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
  publish(request: SchemaPublishRequest, requestId: string): Promise<ProductMutationResult>;
  saveDraft(request: SchemaPublishRequest, requestId: string): Promise<ProductMutationResult>;
  update(request: ProductSchemaUpdateRequest, requestId: string): Promise<ProductMutationResult>;
  get(
    productId: string,
    draft: boolean,
    language: 'zh_CN' | 'en_US',
    requestId: string
  ): Promise<ProductDetail>;
  render(request: ProductSchemaRenderRequest, requestId: string): Promise<ProductSchema>;
  updateDisplay(request: ProductDisplayRequest, requestId: string): Promise<ProductDisplayMutationResult>;
  list(request: ProductListQuery, requestId: string): Promise<ProductPage>;
}

export type ProductMutationSubmissionResult = ProductMutationResult & { job: ProductMutationJob };
export type ProductDisplayMutationSubmissionResult = ProductDisplayMutationResult & {
  jobs: ProductMutationJob[];
};

const DISPLAY_VERIFICATION_TIMEOUT_MILLISECONDS = 2 * 60 * 1000;
const CREATION_VERIFICATION_TIMEOUT_MILLISECONDS = 2 * 60 * 1000;

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

  async submitCreation(input: {
    requestId: string;
    actor: AuthPrincipal;
    operation: 'publishProduct' | 'saveProductDraft';
    request: SchemaPublishRequest;
  }): Promise<ProductMutationSubmissionResult> {
    const payloadFingerprint = await createCreationFingerprint(input.operation, input.request);
    const blocking = await this.#repository.findBlockingCreation(input.operation, payloadFingerprint);
    if (blocking) throw new ProductMutationAlreadyInProgressError(blocking);
    let job = await this.#repository.createCreation({
      requestId: input.requestId,
      operation: input.operation,
      categoryId: input.request.categoryId,
      language: normalizeLanguage(input.request.language),
      payloadFingerprint,
      actorId: input.actor.actorId
    });
    await this.#audit(job, input.requestId, input.actor.actorId, 'submitted', null);
    let result: ProductMutationResult;
    try {
      result =
        input.operation === 'saveProductDraft'
          ? await this.#gateway.saveDraft(input.request, input.requestId)
          : await this.#gateway.publish(input.request, input.requestId);
    } catch (error: unknown) {
      const details = errorDetails(error);
      const status: ProductMutationJobStatus = details.retryable ? 'recovery-required' : 'failed';
      const transitioned = await this.#repository.transition({
        id: job.id,
        expectedRevision: job.revision,
        status,
        actorId: input.actor.actorId,
        traceId: details.traceId,
        reasonCode: details.code,
        message: details.retryable
          ? `请求结果不确定，已停止重复创建并等待人工核对：${details.message}`
          : details.message
      });
      await this.#audit(transitioned, input.requestId, input.actor.actorId, status, job.revision);
      throw error;
    }
    job = await this.#repository.transition({
      id: job.id,
      expectedRevision: job.revision,
      status: 'verifying',
      actorId: input.actor.actorId,
      productId: result.productId,
      traceId: result.traceId,
      reasonCode:
        input.operation === 'saveProductDraft'
          ? 'ALIBABA_PRODUCT_DRAFT_ACCEPTED'
          : 'ALIBABA_PRODUCT_PUBLISH_ACCEPTED',
      message:
        input.operation === 'saveProductDraft'
          ? 'Alibaba 已接受平台草稿创建，等待草稿 Schema 回读确认'
          : 'Alibaba 已接受正式发布，等待商品列表回读确认'
    });
    await this.#audit(job, input.requestId, input.actor.actorId, 'verifying', 1);
    job = await this.#refreshCreation(job, input.requestId, input.actor);
    return { ...result, job };
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
    if (isCreationOperation(current.operation)) {
      return this.#refreshCreation(current, input.requestId, input.actor);
    }
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
      if (product.status === 'auditing') {
        const status = current.status === 'recovering' ? 'recovering' : 'auditing';
        const updated = await this.#repository.transition({
          id: current.id,
          expectedRevision: current.revision,
          status,
          actorId: input.actor.actorId,
          reasonCode:
            status === 'recovering'
              ? 'PRODUCT_DISPLAY_RECOVERY_PLATFORM_AUDITING'
              : 'PRODUCT_DISPLAY_PLATFORM_AUDITING',
          message: '平台已进入商品审核，等待最终上下架状态；审核完成前不会重复提交',
          checked: true
        });
        await this.#audit(updated, input.requestId, input.actor.actorId, status, current.revision);
        return updated;
      }
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

  async #refreshCreation(
    current: ProductMutationJob,
    requestId: string,
    actor: AuthPrincipal
  ): Promise<ProductMutationJob> {
    if (!isCreationOperation(current.operation) || current.categoryId === null || current.language === null) {
      throw new Error('新增商品任务缺少类目或语言快照');
    }
    if (!/^[1-9][0-9]*$/u.test(current.productId)) {
      const uncertain = await this.#repository.transition({
        id: current.id,
        expectedRevision: current.revision,
        status: 'recovery-required',
        actorId: actor.actorId,
        reasonCode: 'PRODUCT_CREATION_RESULT_UNKNOWN',
        message: '请求可能已经到达平台，但本地未取得商品 ID；为避免重复创建，请先在国际站后台人工核对',
        checked: true
      });
      await this.#audit(uncertain, requestId, actor.actorId, 'recovery-required', current.revision);
      return uncertain;
    }
    try {
      if (current.operation === 'saveProductDraft') {
        const detail = await this.#gateway.get(current.productId, true, current.language, requestId);
        if (detail.id !== current.productId || detail.schemaXml.trim() === '') {
          throw new Error('平台草稿回读缺少匹配的商品 ID 或 Schema');
        }
        const verified = await this.#repository.transition({
          id: current.id,
          expectedRevision: current.revision,
          status: 'verified',
          actorId: actor.actorId,
          reasonCode: 'PRODUCT_DRAFT_READBACK_MATCHED',
          message: `平台草稿 ${current.productId} 已通过 schema.render.draft 回读确认`,
          checked: true
        });
        await this.#audit(verified, requestId, actor.actorId, 'verified', current.revision);
        return verified;
      }

      const product = await this.#findProductById(current.productId, current.language, requestId);
      if (product) {
        const verified = await this.#repository.transition({
          id: current.id,
          expectedRevision: current.revision,
          status: 'verified',
          actorId: actor.actorId,
          reasonCode: 'PRODUCT_PUBLISH_READBACK_MATCHED',
          message:
            product.status === 'auditing'
              ? `商品 ${current.productId} 已在列表回读，当前由平台审核中`
              : `商品 ${current.productId} 已在列表回读，当前状态为${productStatusDescription(product.status)}`,
          checked: true
        });
        await this.#audit(verified, requestId, actor.actorId, 'verified', current.revision);
        return verified;
      }
      const timedOut = this.#clock() - current.submittedTimeUtc >= CREATION_VERIFICATION_TIMEOUT_MILLISECONDS;
      const status: ProductMutationJobStatus = timedOut ? 'recovery-required' : 'verifying';
      const pending = await this.#repository.transition({
        id: current.id,
        expectedRevision: current.revision,
        status,
        actorId: actor.actorId,
        reasonCode: timedOut ? 'PRODUCT_PUBLISH_READBACK_TIMEOUT' : 'PRODUCT_PUBLISH_READBACK_PENDING',
        message: timedOut
          ? '平台已受理发布，但商品列表暂未回读到该商品；已禁止重复创建，请稍后人工核对'
          : '平台已受理发布，商品列表暂未回读到该商品',
        checked: true
      });
      await this.#audit(pending, requestId, actor.actorId, status, current.revision);
      return pending;
    } catch (error: unknown) {
      const details = errorDetails(error);
      const timedOut = this.#clock() - current.submittedTimeUtc >= CREATION_VERIFICATION_TIMEOUT_MILLISECONDS;
      const status: ProductMutationJobStatus = timedOut ? 'recovery-required' : 'verifying';
      const pending = await this.#repository.transition({
        id: current.id,
        expectedRevision: current.revision,
        status,
        actorId: actor.actorId,
        traceId: details.traceId,
        reasonCode: details.code,
        message: timedOut
          ? `平台回读超时，已禁止重复创建：${details.message}`
          : `平台回读尚未完成：${details.message}`,
        checked: true
      });
      await this.#audit(pending, requestId, actor.actorId, status, current.revision);
      return pending;
    }
  }

  async #findProductById(
    productId: string,
    language: 'zh_CN' | 'en_US',
    requestId: string
  ): Promise<Product | null> {
    for (let page = 1; page <= 100; page += 1) {
      const result = await this.#gateway.list({ page, pageSize: 30, language }, requestId);
      const product = result.items.find((candidate) => candidate.id === productId);
      if (product) return product;
      if (page * result.pageSize >= result.total) return null;
    }
    return null;
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
        !['online', 'offline', 'auditing'].includes(product.status)
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

async function createCreationFingerprint(
  operation: 'publishProduct' | 'saveProductDraft',
  request: SchemaPublishRequest
): Promise<string> {
  const bytes = new TextEncoder().encode(
    `${operation}\n${request.categoryId}\n${request.language}\n${request.schemaXml}`
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function isCreationOperation(
  operation: ProductMutationJob['operation']
): operation is 'publishProduct' | 'saveProductDraft' {
  return operation === 'publishProduct' || operation === 'saveProductDraft';
}

function productStatusDescription(status: Product['status']): string {
  if (status === 'online') return '上架';
  if (status === 'offline') return '下架';
  if (status === 'draft') return '草稿';
  if (status === 'auditing') return '审核中';
  if (status === 'rejected') return '已驳回';
  return '待平台确认';
}
