import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium, type BrowserContext, type Page } from '@playwright/test';

import {
  ALIBABA_GATEWAY,
  GatewayException,
  inspectProductSchemaSerialization,
  isProductMutationJob,
  markProductSchemaFieldTouched,
  parseAlibabaOpenApiCredentialBundle,
  parseProductSchemaXml,
  productMutationJobIsTerminal,
  productSchemaFieldText,
  sanitizeDiagnosticMessage,
  validateProductSchemaModel,
  withProductSchemaFieldText,
  type GatewaySettings,
  type OperationId,
  type Product,
  type ProductMutationJob,
  type ProductMutationResult,
  type ProductSchemaField,
  type ProductSchemaModel,
  type RequestOf,
  type ResponseOf
} from '../packages/core/src/index';

import { atomicWriteJson } from './openapi-auth/storage';
import { installNodeXmlDomGlobals } from './node-xml-dom';

const LANGUAGE = 'en_US' as const;
const DEFAULT_SOURCE_PRODUCT_ID = '1601928079741';
const DEFAULT_OUTPUT = 'artifacts/real-smoke/extension-product-creation-20260901.json';
const DEFAULT_PROFILE = 'artifacts/real-smoke/extension-product-creation-profile';
const DEFAULT_EXTENSION = 'apps/extension/.output/chrome-mv3';
const RUN_DATE = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const DRAFT_MARKER = `[oneVegetable-extension-draft-smoke-${RUN_DATE}]`;
const PUBLISH_MARKER = `[oneVegetable-extension-publish-smoke-${RUN_DATE}]`;

installNodeXmlDomGlobals();

const allowMutation = process.env.ONE_VEGETABLE_REAL_EXTENSION_PRODUCT_CREATION_SMOKE === '1';
const reportPath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_REAL_EXTENSION_PRODUCT_CREATION_OUTPUT ?? DEFAULT_OUTPUT
);
const profileDirectory = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_REAL_EXTENSION_PRODUCT_CREATION_PROFILE ?? DEFAULT_PROFILE
);
const extensionDirectory = resolve(process.cwd(), DEFAULT_EXTENSION);
const credentialPath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ??
    process.env.OPEN_API_OUTPUT ??
    'artifacts/openapi-auth/credentials.json'
);

if (!existsSync(resolve(extensionDirectory, 'manifest.json'))) {
  throw new Error('未找到已构建的 MV3 扩展，请先运行 pnpm build:extension');
}

const bundle = parseAlibabaOpenApiCredentialBundle(
  JSON.parse(await readFile(credentialPath, 'utf8')) as unknown
);
const settings: GatewaySettings = {
  appKey: bundle.application.appKey,
  appSecret: bundle.application.appSecret,
  accessToken: bundle.oauth.accessToken,
  endpoint: ALIBABA_GATEWAY,
  signMethod: 'hmac'
};
const vaultPassphrase = createHash('sha256')
  .update(bundle.application.appSecret)
  .update('\0one-vegetable-extension-real-smoke')
  .digest('base64url')
  .slice(0, 32);
const requests: { operation: string; requestId: string; outcome: 'success' | 'error' }[] = [];
let context: BrowserContext | null = null;

await main();

async function main(): Promise<void> {
  const previous = await readReport(reportPath);
  if (previous?.status === 'passed') {
    process.stdout.write('插件真实草稿与发布 Smoke 已通过，不会重复创建。\n');
    process.stdout.write(`脱敏报告：${reportPath}\n`);
    return;
  }

  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      headless: false,
      args: [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`]
    });
    let serviceWorker = context.serviceWorkers()[0];
    serviceWorker ??= await context.waitForEvent('serviceworker', { timeout: 60_000 });
    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await configureVault(page, settings, vaultPassphrase);

    const existing = await loadCreationJobs(page);
    const previousDraft = resultFromReport(previous, 'draft');
    const previousPublish = resultFromReport(previous, 'publish');
    const draftJob = await resumeJob(page, latestJob(existing, 'saveProductDraft'));
    const publishJob = await resumeJob(page, latestJob(existing, 'publishProduct'));

    if (previous?.status === 'draft-started' && !previousDraft && !draftJob) {
      throw new Error('上次草稿请求已开始但没有可回读的任务或商品 ID；为避免重复创建，拒绝自动重试');
    }
    if (previous?.status === 'publish-started' && !previousPublish && !publishJob) {
      throw new Error('上次发布请求已开始但没有可回读的任务或商品 ID；为避免重复创建，拒绝自动重试');
    }

    const candidate = await selectPublishCandidate(page);
    const draftRequest = prepareRequest(candidate, DRAFT_MARKER);
    const publishRequest = prepareRequest(candidate, PUBLISH_MARKER);
    const preflight = {
      sourceProductId: candidate.product.id,
      categoryId: candidate.product.categoryId,
      language: LANGUAGE,
      draftTitleMarker: DRAFT_MARKER,
      publishTitleMarker: PUBLISH_MARKER,
      draftChangedFieldCount: draftRequest.changedFieldCount,
      publishChangedFieldCount: publishRequest.changedFieldCount,
      blockingIssueCount: 0
    };

    if (!allowMutation) {
      await writeReport('preflight-ready', { ...preflight, mutationAttempted: false });
      process.stdout.write(
        '插件真实草稿与发布预检通过；设置 ONE_VEGETABLE_REAL_EXTENSION_PRODUCT_CREATION_SMOKE=1 后执行。\n'
      );
      process.stdout.write(`脱敏报告：${reportPath}\n`);
      return;
    }

    let draft = previousDraft ?? resultFromJob(draftJob);
    if (!draft) {
      await writeReport('draft-started', { ...preflight, mutationAttempted: true });
      const accepted = await runtimeCall(page, 'saveProductDraft', draftRequest.request);
      const result = requireMutationResult(accepted);
      const verified = await waitForJob(page, result.job);
      draft = resultFromMutation(result, verified);
      await writeReport('draft-passed', { ...preflight, mutationAttempted: true, draft });
    }
    if (draft.status !== 'verified') {
      throw new Error(`平台草稿 ${draft.productId} 尚未完成回读确认，停止正式发布 Smoke`);
    }

    let publish = previousPublish ?? resultFromJob(publishJob);
    if (!publish) {
      await writeReport('publish-started', { ...preflight, mutationAttempted: true, draft });
      const accepted = await runtimeCall(page, 'publishProduct', publishRequest.request);
      const result = requireMutationResult(accepted);
      const verified = await waitForJob(page, result.job);
      publish = resultFromMutation(result, verified);
      await writeReport('publish-passed', {
        ...preflight,
        mutationAttempted: true,
        draft,
        publish
      });
    }
    if (publish.status !== 'verified') {
      throw new Error(`正式发布商品 ${publish.productId} 尚未完成列表回读确认`);
    }

    await writeReport('passed', {
      ...preflight,
      mutationAttempted: true,
      draft,
      publish,
      cleanup: { attempted: false, reason: '按用户要求保留平台状态，不自动下架或删除' }
    });
    process.stdout.write(`插件真实平台草稿已回读：${draft.productId}。\n`);
    process.stdout.write(`插件真实发布商品已回读：${publish.productId}。\n`);
    process.stdout.write(`脱敏报告：${reportPath}\n`);
  } catch (error: unknown) {
    const previous = await readReport(reportPath);
    await writeReport('failed', {
      mutationAttempted: previous?.mutationAttempted === true,
      ...(resultFromReport(previous, 'draft') ? { draft: resultFromReport(previous, 'draft') } : {}),
      ...(resultFromReport(previous, 'publish') ? { publish: resultFromReport(previous, 'publish') } : {}),
      error: errorRecord(error)
    });
    throw error;
  } finally {
    await context?.close();
  }
}

async function configureVault(
  page: Page,
  gatewaySettings: GatewaySettings,
  passphrase: string
): Promise<void> {
  const result = await page.evaluate(
    async ({ settings: serializedSettings, vaultPassphrase: serializedPassphrase }) => {
      const extension = (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage(value: object): Promise<unknown> } };
        }
      ).chrome;
      const status = (await extension.runtime.sendMessage({
        requestId: crypto.randomUUID(),
        kind: 'credential-vault-request',
        operation: 'status',
        payload: {}
      })) as {
        ok?: boolean;
        data?: { state?: string };
        error?: { code?: string; message?: string };
      };
      if (!status.ok) return { ok: false, error: status.error };
      if (status.data?.state === 'empty') {
        return extension.runtime.sendMessage({
          requestId: crypto.randomUUID(),
          kind: 'credential-vault-request',
          operation: 'create',
          payload: { passphrase: serializedPassphrase, settings: serializedSettings }
        });
      }
      if (status.data?.state === 'locked') {
        const unlocked = (await extension.runtime.sendMessage({
          requestId: crypto.randomUUID(),
          kind: 'credential-vault-request',
          operation: 'unlock',
          payload: { passphrase: serializedPassphrase }
        })) as { ok?: boolean };
        if (!unlocked.ok) return unlocked;
      }
      return extension.runtime.sendMessage({
        requestId: crypto.randomUUID(),
        kind: 'credential-vault-request',
        operation: 'save',
        payload: serializedSettings
      });
    },
    { settings: gatewaySettings, vaultPassphrase: passphrase }
  );
  if (!isRecord(result) || result.ok !== true) {
    const error = isRecord(result) && isRecord(result.error) ? result.error : {};
    throw new Error(
      `插件凭证保险库配置失败：${safeString(error.code) || safeString(error.message) || '未知错误'}`
    );
  }
}

async function runtimeCall<K extends OperationId>(
  page: Page,
  operation: K,
  payload: RequestOf<K>
): Promise<ResponseOf<K>> {
  const response = await page.evaluate(
    async ({ runtimeOperation, runtimePayload }) => {
      const extension = (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage(value: object): Promise<unknown> } };
        }
      ).chrome;
      return extension.runtime.sendMessage({
        requestId: crypto.randomUUID(),
        kind: 'gateway-request',
        operation: runtimeOperation,
        payload: runtimePayload
      });
    },
    { runtimeOperation: operation, runtimePayload: payload }
  );
  if (!isRecord(response) || typeof response.requestId !== 'string' || typeof response.ok !== 'boolean') {
    throw new Error(`插件 ${operation} 返回无效 runtime 响应`);
  }
  requests.push({ operation, requestId: response.requestId, outcome: response.ok ? 'success' : 'error' });
  if (!response.ok) {
    const error = isRecord(response.error) ? response.error : {};
    throw new GatewayException(
      {
        code: safeString(error.code) || 'EXTENSION_RUNTIME_ERROR',
        message: safeString(error.message) || `插件 ${operation} 调用失败`,
        ...(safeString(error.traceId) ? { traceId: safeString(error.traceId) } : {}),
        retryable: error.retryable === true
      },
      response.requestId
    );
  }
  return response.data as ResponseOf<K>;
}

async function productJobCall(
  page: Page,
  operation: 'list' | 'refresh',
  payload: Record<string, unknown>
): Promise<unknown> {
  const response = await page.evaluate(
    async ({ jobOperation, jobPayload }) => {
      const extension = (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage(value: object): Promise<unknown> } };
        }
      ).chrome;
      return extension.runtime.sendMessage({
        requestId: crypto.randomUUID(),
        kind: 'product-mutation-job-request',
        operation: jobOperation,
        payload: jobPayload
      });
    },
    { jobOperation: operation, jobPayload: payload }
  );
  if (!isRecord(response) || typeof response.requestId !== 'string' || typeof response.ok !== 'boolean') {
    throw new Error(`插件商品任务 ${operation} 返回无效响应`);
  }
  requests.push({
    operation: `product-mutation-job:${operation}`,
    requestId: response.requestId,
    outcome: response.ok ? 'success' : 'error'
  });
  if (!response.ok) {
    const error = isRecord(response.error) ? response.error : {};
    throw new Error(`商品任务 ${operation} 失败：${safeString(error.code) || safeString(error.message)}`);
  }
  return response.data;
}

async function loadCreationJobs(page: Page): Promise<ProductMutationJob[]> {
  const value = await productJobCall(page, 'list', { page: 1, pageSize: 100 });
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error('插件商品任务列表响应无效');
  return value.items
    .filter(isProductMutationJob)
    .filter((job) => job.operation === 'saveProductDraft' || job.operation === 'publishProduct');
}

async function resumeJob(page: Page, job: ProductMutationJob | null): Promise<ProductMutationJob | null> {
  if (!job || productMutationJobIsTerminal(job.status)) return job;
  return waitForJob(page, job);
}

async function waitForJob(page: Page, initial: ProductMutationJob | undefined): Promise<ProductMutationJob> {
  if (!initial) throw new Error('平台已接受写入，但插件响应缺少持久任务');
  let current = initial;
  for (let attempt = 0; attempt < 12 && !productMutationJobIsTerminal(current.status); attempt += 1) {
    if (attempt > 0) await delay(5_000);
    const refreshed = await productJobCall(page, 'refresh', { id: current.id, revision: current.revision });
    if (!isProductMutationJob(refreshed)) throw new Error('插件商品任务回读响应无效');
    current = refreshed;
  }
  return current;
}

async function selectPublishCandidate(page: Page): Promise<{
  product: Product & { categoryId: number };
  model: ProductSchemaModel;
}> {
  const preferredId = process.env.ONE_VEGETABLE_REAL_PRODUCT_PUBLISH_SOURCE_ID ?? DEFAULT_SOURCE_PRODUCT_ID;
  const products: Product[] = [];
  for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) {
    const result = await runtimeCall(page, 'listProducts', {
      page: pageNumber,
      pageSize: 100,
      language: LANGUAGE
    });
    products.push(...result.items);
    if (pageNumber * result.pageSize >= result.total) break;
  }
  const candidates = products
    .filter(
      (product): product is Product & { categoryId: number } =>
        product.categoryId !== null &&
        product.categoryId > 0 &&
        (product.status === 'online' || product.status === 'offline')
    )
    .toSorted((left, right) => Number(right.id === preferredId) - Number(left.id === preferredId));
  const failures: string[] = [];
  for (const product of candidates.slice(0, 12)) {
    try {
      const rendered = await runtimeCall(page, 'renderProductSchema', {
        productId: product.id,
        categoryId: product.categoryId,
        language: LANGUAGE
      });
      const model = parseProductSchemaXml(rendered.xml);
      const inspection = inspectProductSchemaSerialization(model);
      const errors = validateProductSchemaModel(model).filter((issue) => issue.severity === 'error');
      if (inspection.safe && errors.length === 0) return { product, model };
      failures.push(`${product.id}:schema-errors=${errors.length}`);
    } catch (error: unknown) {
      failures.push(`${product.id}:${errorCode(error)}`);
    }
  }
  throw new Error(`没有找到可安全复用的真实商品 Schema：${failures.slice(0, 8).join('，')}`);
}

function prepareRequest(
  candidate: { product: Product & { categoryId: number }; model: ProductSchemaModel },
  marker: string
): { request: RequestOf<'publishProduct'>; changedFieldCount: number } {
  const title = findTitleField(candidate.model);
  const originalTitle = productSchemaFieldText(title.field).trim();
  if (!originalTitle) throw new Error('源商品标题为空，不能构造扩展真实 Smoke');
  const model = updateField(candidate.model, title.field.key, title.rootKey, (field) =>
    withProductSchemaFieldText(field, createSmokeTitle(originalTitle, field, marker))
  );
  const inspection = inspectProductSchemaSerialization(model);
  if (!inspection.safe) throw new Error(`Schema XML 结构异常：${inspection.structuralDiffs.join('；')}`);
  const errors = validateProductSchemaModel(model).filter((issue) => issue.severity === 'error');
  if (errors.length > 0) throw new Error(`扩展真实 Smoke 仍有 ${errors.length} 个最低发布条件未满足`);
  return {
    request: {
      categoryId: candidate.product.categoryId,
      language: LANGUAGE,
      schemaXml: inspection.xml
    },
    changedFieldCount: inspection.changedFieldKeys.length
  };
}

function requireMutationResult(value: unknown): ProductMutationResult {
  if (
    !isRecord(value) ||
    typeof value.productId !== 'string' ||
    !/^[1-9][0-9]*$/u.test(value.productId) ||
    typeof value.traceId !== 'string' ||
    value.success !== true ||
    !isProductMutationJob(value.job)
  ) {
    throw new Error('插件商品创建响应缺少明确成功字段或持久任务');
  }
  return value as ProductMutationResult;
}

function latestJob(
  jobs: readonly ProductMutationJob[],
  operation: 'saveProductDraft' | 'publishProduct'
): ProductMutationJob | null {
  return (
    jobs
      .filter((job) => job.operation === operation)
      .toSorted((left, right) => right.submittedTimeUtc - left.submittedTimeUtc)[0] ?? null
  );
}

function resultFromMutation(result: ProductMutationResult, job: ProductMutationJob): SmokeResult {
  return {
    productId: result.productId,
    traceId: result.traceId,
    jobId: job.id,
    requestId: job.requestId,
    status: job.status,
    reasonCode: job.reasonCode
  };
}

function resultFromJob(job: ProductMutationJob | null): SmokeResult | null {
  if (!job || !/^[1-9][0-9]*$/u.test(job.productId)) return null;
  return {
    productId: job.productId,
    traceId: job.traceId,
    jobId: job.id,
    requestId: job.requestId,
    status: job.status,
    reasonCode: job.reasonCode
  };
}

interface SmokeResult {
  productId: string;
  traceId: string | null;
  jobId: string;
  requestId: string;
  status: string;
  reasonCode: string | null;
}

function resultFromReport(
  report: Record<string, unknown> | null,
  key: 'draft' | 'publish'
): SmokeResult | null {
  const value = report?.[key];
  if (
    !isRecord(value) ||
    typeof value.productId !== 'string' ||
    typeof value.jobId !== 'string' ||
    typeof value.requestId !== 'string' ||
    typeof value.status !== 'string'
  ) {
    return null;
  }
  return {
    productId: value.productId,
    traceId: typeof value.traceId === 'string' ? value.traceId : null,
    jobId: value.jobId,
    requestId: value.requestId,
    status: value.status,
    reasonCode: typeof value.reasonCode === 'string' ? value.reasonCode : null
  };
}

function findTitleField(model: ProductSchemaModel): { rootKey: string; field: ProductSchemaField } {
  for (const root of model.fields) {
    const field = flattenFields(root).find((candidate) => titleFieldRank(candidate) < 10);
    if (field) return { rootKey: root.key, field };
  }
  throw new Error('商品 Schema 中没有找到标题字段');
}

function flattenFields(field: ProductSchemaField): ProductSchemaField[] {
  return [
    field,
    ...field.children.flatMap(flattenFields),
    ...field.instances.flatMap((instance) => instance.fields.flatMap(flattenFields))
  ];
}

function titleFieldRank(field: ProductSchemaField): number {
  const id = field.id.toLocaleLowerCase();
  if (['subject', 'productsubject', 'producttitle'].includes(id)) return 0;
  if (/product.*title|title.*product/u.test(id)) return 1;
  if (/product title|商品标题|商品名称/iu.test(field.name)) return 2;
  return 10;
}

function createSmokeTitle(original: string, field: ProductSchemaField, marker: string): string {
  const configuredLimit = field.rules
    .filter((rule) => rule.name === 'maxLengthRule')
    .map((rule) => Number(rule.value))
    .find((value) => Number.isSafeInteger(value) && value > 0);
  const limit = Math.min(configuredLimit ?? 128, 128);
  const suffix = ` ${marker}`;
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const originalSegments = Array.from(segmenter.segment(original), ({ segment }) => segment);
  const suffixSegments = Array.from(segmenter.segment(suffix), ({ segment }) => segment);
  return `${originalSegments.slice(0, Math.max(1, limit - suffixSegments.length)).join('')}${suffix}`;
}

function updateField(
  model: ProductSchemaModel,
  fieldKey: string,
  rootKey: string,
  update: (field: ProductSchemaField) => ProductSchemaField
): ProductSchemaModel {
  return markProductSchemaFieldTouched(
    {
      ...model,
      fields: model.fields.map((field) => replaceField(field, fieldKey, update))
    },
    rootKey
  );
}

function replaceField(
  field: ProductSchemaField,
  key: string,
  update: (field: ProductSchemaField) => ProductSchemaField
): ProductSchemaField {
  if (field.key === key) return update(field);
  return {
    ...field,
    children: field.children.map((child) => replaceField(child, key, update)),
    instances: field.instances.map((instance) => ({
      ...instance,
      fields: instance.fields.map((child) => replaceField(child, key, update))
    }))
  };
}

async function readReport(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

async function writeReport(status: string, detail: Record<string, unknown>): Promise<void> {
  await atomicWriteJson(reportPath, {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    status,
    runtime: 'chrome-extension-mv3',
    requests,
    ...detail
  });
}

function errorRecord(error: unknown): Record<string, unknown> {
  if (error instanceof GatewayException) {
    return {
      code: error.gatewayError.code,
      subCode: error.gatewayError.subCode ?? null,
      traceId: error.gatewayError.traceId ?? null,
      message: sanitizeDiagnosticMessage(error.gatewayError.message)
    };
  }
  return {
    code: 'UNEXPECTED_ERROR',
    message: sanitizeDiagnosticMessage(error instanceof Error ? error.message : '未知错误')
  };
}

function errorCode(error: unknown): string {
  return error instanceof GatewayException ? error.gatewayError.code : 'UNEXPECTED_ERROR';
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, milliseconds));
}
