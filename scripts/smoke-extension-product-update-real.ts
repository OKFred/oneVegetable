import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium, type BrowserContext, type Page } from '@playwright/test';

import {
  ALIBABA_GATEWAY,
  compareProductMutationFingerprints,
  createProductMutationFingerprints,
  GatewayException,
  inspectProductSchemaPatchSerialization,
  isProductMutationJob,
  markProductSchemaFieldTouched,
  normalizeGatewayError,
  parseAlibabaOpenApiCredentialBundle,
  parseProductSchemaXml,
  productSchemaFieldText,
  sanitizeDiagnosticMessage,
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
const DEFAULT_PRODUCT_ID = '1601938537310';
const DEFAULT_EXTENSION = 'apps/extension/.output/chrome-mv3';
const DEFAULT_PROFILE = 'artifacts/real-smoke/extension-product-update-profile';
const DEFAULT_OUTPUT = 'artifacts/real-smoke/extension-product-update-20260906.json';
const DEFAULT_CREATION_REPORT = 'artifacts/real-smoke/extension-product-creation-20260901.json';
const MARKER = '[OV-EXT-UPDATE-20260906]';

installNodeXmlDomGlobals();

if (process.env.ONE_VEGETABLE_REAL_EXTENSION_PRODUCT_UPDATE_SMOKE !== '1') {
  throw new Error(
    '插件真实商品更新 Smoke 必须显式设置 ONE_VEGETABLE_REAL_EXTENSION_PRODUCT_UPDATE_SMOKE=1；该操作会短暂修改并恢复测试商品标题'
  );
}

const productId = nonEmpty(process.env.ONE_VEGETABLE_REAL_EXTENSION_PRODUCT_UPDATE_ID) ?? DEFAULT_PRODUCT_ID;
const extensionDirectory = resolve(process.cwd(), DEFAULT_EXTENSION);
const profileDirectory = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_REAL_EXTENSION_PRODUCT_UPDATE_PROFILE ?? DEFAULT_PROFILE
);
const reportPath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_REAL_EXTENSION_PRODUCT_UPDATE_OUTPUT ?? DEFAULT_OUTPUT
);
const credentialPath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ??
    process.env.OPEN_API_OUTPUT ??
    'artifacts/openapi-auth/credentials.json'
);
const creationReportPath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_REAL_EXTENSION_PRODUCT_CREATION_OUTPUT ?? DEFAULT_CREATION_REPORT
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
  .update('\0one-vegetable-extension-update-smoke')
  .digest('base64url')
  .slice(0, 32);
const requests: { operation: string; requestId: string; outcome: 'success' | 'error' }[] = [];
let context: BrowserContext | null = null;
let originalTitle = '';
let temporaryTitle = '';
let categoryId = 0;
let recoveryRequired = false;

await main();

async function main(): Promise<void> {
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

    const existingJobs = await loadUpdateJobs(page);
    const blocking = existingJobs.find((job) => productMutationJobIsBlocking(job.status));
    const product = await requireSmokeProduct(page, blocking !== undefined);
    if (product.categoryId === null || product.categoryId <= 0) {
      throw new Error('测试商品缺少可用于 Schema 回读的类目 ID');
    }
    categoryId = product.categoryId;
    let temporaryJob: ProductMutationJob;
    if (blocking) {
      originalTitle = await reconstructPublishedSmokeTitle(page);
      temporaryTitle = createTemporaryTitle(originalTitle);
      recoveryRequired = true;
      temporaryJob = await waitForVerifiedJob(page, blocking);
    } else {
      const source = await renderProduct(page);
      const title = findTitleField(source);
      originalTitle = productSchemaFieldText(title.field).trim();
      if (!originalTitle) throw new Error('测试商品标题为空，拒绝执行增量更新');
      temporaryTitle = createTemporaryTitle(originalTitle);

      await writeReport('temporary-update-started', true);
      recoveryRequired = true;
      const temporaryResult = requireMutationResult(
        await runtimeCall(page, 'updateProduct', {
          productId,
          categoryId,
          language: LANGUAGE,
          schemaPatchXml: createTitlePatch(source, title.field.key, title.rootKey, temporaryTitle)
        })
      );
      temporaryJob = await waitForVerifiedJob(page, temporaryResult.job);
    }
    await assertRenderedTitle(page, temporaryTitle);

    const temporaryModel = await renderProduct(page);
    const temporaryField = findTitleField(temporaryModel);
    await writeReport('restore-started', true, temporaryJob);
    const restoreResult = requireMutationResult(
      await runtimeCall(page, 'updateProduct', {
        productId,
        categoryId,
        language: LANGUAGE,
        schemaPatchXml: createTitlePatch(
          temporaryModel,
          temporaryField.field.key,
          temporaryField.rootKey,
          originalTitle
        )
      })
    );
    const restoreJob = await waitForVerifiedJob(page, restoreResult.job);
    await assertRenderedTitle(page, originalTitle);
    recoveryRequired = false;

    await writeReport('passed', false, restoreJob, {
      temporaryJobId: temporaryJob.id,
      restoreJobId: restoreJob.id,
      titleRoundTrip: true
    });
    process.stdout.write(`插件真实商品更新与原值恢复通过：${productId}。\n`);
    process.stdout.write(`脱敏报告：${reportPath}\n`);
  } catch (error: unknown) {
    const recovery = await tryRestoreOriginalTitle().catch((recoveryError: unknown) => ({
      restored: false,
      error: errorRecord(recoveryError)
    }));
    recoveryRequired = !recovery.restored;
    await writeReport(
      recovery.restored ? 'failed-recovered' : 'failed-recovery-required',
      recoveryRequired,
      null,
      {
        error: errorRecord(error),
        recovery
      }
    );
    throw new Error(`插件真实商品更新 Smoke 失败；脱敏报告：${reportPath}`, { cause: error });
  } finally {
    await context?.close();
  }
}

async function requireSmokeProduct(page: Page, allowAuditing: boolean): Promise<Product> {
  for (let pageNumber = 1; pageNumber <= 100; pageNumber += 1) {
    const result = await runtimeCall(page, 'listProducts', {
      page: pageNumber,
      pageSize: 100,
      language: LANGUAGE
    });
    const product = result.items.find((candidate) => candidate.id === productId);
    if (product) {
      if (!/one.?vegetable/iu.test(product.subject)) {
        throw new Error('目标商品不包含 oneVegetable Smoke 标记，拒绝修改普通线上商品');
      }
      if (
        product.status !== 'online' &&
        product.status !== 'offline' &&
        !(allowAuditing && product.status === 'auditing')
      ) {
        throw new Error(`目标测试商品当前状态为 ${product.status}，暂不能安全更新`);
      }
      return product;
    }
    if (pageNumber * result.pageSize >= result.total) break;
  }
  throw new Error(`未找到指定的 oneVegetable 测试商品 ${productId}`);
}

async function renderProduct(page: Page): Promise<ProductSchemaModel> {
  const rendered = await runtimeCall(page, 'renderProductSchema', {
    productId,
    categoryId,
    language: LANGUAGE
  });
  return parseProductSchemaXml(rendered.xml);
}

async function assertRenderedTitle(page: Page, expected: string): Promise<void> {
  const actual = productSchemaFieldText(findTitleField(await renderProduct(page)).field).trim();
  if (actual !== expected) throw new Error('商品标题回读值与本次增量更新不一致');
}

async function waitForVerifiedJob(page: Page, initial: ProductMutationJob): Promise<ProductMutationJob> {
  let current = initial;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (current.status === 'verified') return current;
    if (current.status === 'failed' || current.status === 'recovered') {
      throw new Error(`商品更新任务意外结束为 ${current.status}：${current.reasonCode ?? 'unknown'}`);
    }
    if (attempt > 0) await delay(15_000);
    let readbackResult: Record<string, unknown>;
    try {
      const rendered = await runtimeCall(page, 'renderProductSchema', {
        productId: current.productId,
        categoryId: requireJobCategoryId(current),
        language: requireJobLanguage(current)
      });
      readbackResult = {
        kind: 'comparison',
        comparison: await compareProductMutationFingerprints(rendered.xml, current.fieldExpectations)
      };
    } catch (error: unknown) {
      readbackResult = { kind: 'error', error: normalizeGatewayError(error) };
    }
    const value = await productJobCall(page, 'complete-update-readback', {
      id: current.id,
      revision: current.revision,
      result: readbackResult
    });
    if (!isProductMutationJob(value)) throw new Error('插件商品更新任务回读响应无效');
    current = value;
    if (attempt > 0 && attempt % 4 === 0 && current.status !== 'verified') {
      process.stdout.write(`商品仍在平台审核，已等待 ${attempt * 15} 秒…\n`);
    }
  }
  throw new Error(`商品更新任务未在限定时间内完成回读：${current.reasonCode ?? current.status}`);
}

function requireJobCategoryId(job: ProductMutationJob): number {
  if (job.categoryId === null) throw new Error('商品更新任务缺少类目 ID');
  return job.categoryId;
}

function requireJobLanguage(job: ProductMutationJob): 'zh_CN' | 'en_US' {
  if (job.language === null) throw new Error('商品更新任务缺少语言');
  return job.language;
}

async function tryRestoreOriginalTitle(): Promise<{ restored: boolean; reason: string }> {
  if (!context || !originalTitle || categoryId <= 0) {
    return { restored: !recoveryRequired, reason: 'mutation-not-started' };
  }
  const serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) return { restored: false, reason: 'service-worker-unavailable' };
  const pages = context.pages();
  const page = pages.find((candidate) => candidate.url().startsWith('chrome-extension://'));
  if (!page) return { restored: false, reason: 'extension-page-unavailable' };

  const currentModel = await renderProduct(page);
  const currentTitleField = findTitleField(currentModel);
  const currentTitle = productSchemaFieldText(currentTitleField.field).trim();
  if (currentTitle === originalTitle) return { restored: true, reason: 'original-value-confirmed' };
  if (currentTitle !== temporaryTitle) {
    return { restored: false, reason: 'unexpected-current-title' };
  }

  const jobs = await loadUpdateJobs(page);
  const blocking = jobs.find(
    (job) =>
      job.productId === productId &&
      ['submitted', 'auditing', 'verifying', 'recovery-required', 'recovering'].includes(job.status)
  );
  if (blocking) await waitForVerifiedJob(page, blocking);

  const refreshedModel = await renderProduct(page);
  const refreshedTitle = findTitleField(refreshedModel);
  const result = requireMutationResult(
    await runtimeCall(page, 'updateProduct', {
      productId,
      categoryId,
      language: LANGUAGE,
      schemaPatchXml: createTitlePatch(
        refreshedModel,
        refreshedTitle.field.key,
        refreshedTitle.rootKey,
        originalTitle
      )
    })
  );
  await waitForVerifiedJob(page, result.job);
  await assertRenderedTitle(page, originalTitle);
  return { restored: true, reason: 'restore-update-verified' };
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
      })) as { ok?: boolean; data?: { state?: string }; error?: { code?: string; message?: string } };
      if (!status.ok) return status;
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
  const productMutationFingerprint =
    operation === 'updateProduct'
      ? await createProductMutationFingerprints((payload as RequestOf<'updateProduct'>).schemaPatchXml)
      : null;
  const response = await page.evaluate(
    async ({ runtimeOperation, runtimePayload, mutationFingerprint }) => {
      const extension = (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage(value: object): Promise<unknown> } };
        }
      ).chrome;
      return extension.runtime.sendMessage({
        requestId: crypto.randomUUID(),
        kind: 'gateway-request',
        operation: runtimeOperation,
        payload: runtimePayload,
        ...(mutationFingerprint === null ? {} : { productMutationFingerprint: mutationFingerprint })
      });
    },
    {
      runtimeOperation: operation,
      runtimePayload: payload,
      mutationFingerprint: productMutationFingerprint
    }
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
        ...(safeString(error.subCode) ? { subCode: safeString(error.subCode) } : {}),
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
  operation: 'list' | 'get' | 'refresh' | 'complete-update-readback',
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

async function loadUpdateJobs(page: Page): Promise<ProductMutationJob[]> {
  const value = await productJobCall(page, 'list', { page: 1, pageSize: 100, productId });
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error('插件商品任务列表响应无效');
  return value.items.filter(isProductMutationJob).filter((job) => job.operation === 'updateProduct');
}

function productMutationJobIsBlocking(status: ProductMutationJob['status']): boolean {
  return ['submitted', 'auditing', 'verifying', 'recovery-required', 'recovering'].includes(status);
}

async function reconstructPublishedSmokeTitle(page: Page): Promise<string> {
  const report = JSON.parse(await readFile(creationReportPath, 'utf8')) as unknown;
  if (!isRecord(report)) throw new Error('插件发布 Smoke 报告无效，无法重建更新前标题');
  const sourceProductId = safeString(report.sourceProductId);
  const sourceCategoryId = Number(report.categoryId);
  const publishMarker = safeString(report.publishTitleMarker);
  if (
    !/^[1-9][0-9]*$/u.test(sourceProductId) ||
    !Number.isSafeInteger(sourceCategoryId) ||
    sourceCategoryId <= 0 ||
    !publishMarker
  ) {
    throw new Error('插件发布 Smoke 报告缺少源商品、类目或标题标记');
  }
  const rendered = await runtimeCall(page, 'renderProductSchema', {
    productId: sourceProductId,
    categoryId: sourceCategoryId,
    language: LANGUAGE
  });
  const title = findTitleField(parseProductSchemaXml(rendered.xml));
  const sourceTitle = productSchemaFieldText(title.field).trim();
  if (!sourceTitle) throw new Error('源商品标题为空，无法重建更新前标题');
  return createMarkedTitle(sourceTitle, title.field, publishMarker);
}

function requireMutationResult(value: unknown): ProductMutationResult & { job: ProductMutationJob } {
  if (
    !isRecord(value) ||
    value.productId !== productId ||
    typeof value.traceId !== 'string' ||
    value.success !== true ||
    !isProductMutationJob(value.job)
  ) {
    throw new Error('插件商品更新响应缺少明确成功字段或持久任务');
  }
  return value as unknown as ProductMutationResult & { job: ProductMutationJob };
}

function createTitlePatch(
  model: ProductSchemaModel,
  fieldKey: string,
  rootKey: string,
  value: string
): string {
  const patched = markProductSchemaFieldTouched(
    {
      ...model,
      fields: model.fields.map((field) => replaceField(field, fieldKey, value))
    },
    rootKey
  );
  const inspection = inspectProductSchemaPatchSerialization(patched);
  if (!inspection.safe || inspection.noOp || inspection.changedFieldKeys.length !== 1) {
    throw new Error(`无法生成安全的单字段增量补丁：${inspection.structuralDiffs.join('；')}`);
  }
  return inspection.xml;
}

function replaceField(field: ProductSchemaField, key: string, value: string): ProductSchemaField {
  if (field.key === key) return withProductSchemaFieldText(field, value);
  return {
    ...field,
    children: field.children.map((child) => replaceField(child, key, value)),
    instances: field.instances.map((instance) => ({
      ...instance,
      fields: instance.fields.map((child) => replaceField(child, key, value))
    }))
  };
}

function findTitleField(model: ProductSchemaModel): { field: ProductSchemaField; rootKey: string } {
  const candidates = model.fields.flatMap((root) =>
    flattenFields(root).map((field) => ({ field, rootKey: root.key, rank: titleFieldRank(field) }))
  );
  const selected = candidates
    .filter((candidate) => Number.isFinite(candidate.rank))
    .toSorted((left, right) => left.rank - right.rank || left.field.sourceIndex - right.field.sourceIndex)[0];
  if (!selected) throw new Error('商品 Schema 中没有找到标题字段');
  return selected;
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
  return Number.POSITIVE_INFINITY;
}

function createTemporaryTitle(value: string): string {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const markerLength = Array.from(segmenter.segment(MARKER)).length;
  const prefix = Array.from(segmenter.segment(value), ({ segment }) => segment)
    .slice(0, Math.max(1, 127 - markerLength))
    .join('')
    .trimEnd();
  return `${prefix} ${MARKER}`;
}

function createMarkedTitle(original: string, field: ProductSchemaField, marker: string): string {
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

async function writeReport(
  status: string,
  needsRecovery: boolean,
  job: ProductMutationJob | null = null,
  detail: Record<string, unknown> = {}
): Promise<void> {
  await atomicWriteJson(reportPath, {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    status,
    productId,
    categoryId: categoryId || null,
    language: LANGUAGE,
    mutationAttempted: requests.some((request) => request.operation === 'updateProduct'),
    recoveryRequired: needsRecovery,
    latestJobId: job?.id ?? null,
    latestJobStatus: job?.status ?? null,
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

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
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
