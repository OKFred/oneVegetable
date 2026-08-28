import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

import {
  GatewayException,
  inspectProductSchemaSerialization,
  markProductSchemaFieldTouched,
  parseProductSchemaXml,
  productSchemaFieldText,
  sanitizeDiagnosticMessage,
  validateProductSchemaModel,
  withProductSchemaFieldText,
  type OperationId,
  type Product,
  type ProductSchemaField,
  type ProductSchemaModel,
  type RequestOf,
  type ResponseOf
} from '../packages/core/src/index';
import {
  inspectProductBatchPublishItem,
  runProductBatchPublish,
  type ProductBatchPublishItem,
  type ProductBatchPublishRunResult
} from '../packages/ui/src/lib/product-batch-publish';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { atomicWriteJson } from './openapi-auth/storage';
import { installNodeXmlDomGlobals } from './node-xml-dom';

const LANGUAGE = 'en_US' as const;
const BATCH_SIZE = 3;
const DEFAULT_SOURCE_PRODUCT_ID = '1601928079741';
const RUN_DATE = new Date().toISOString().slice(0, 10).replaceAll('-', '');

installNodeXmlDomGlobals();
if (existsSync('.env')) loadEnvFile('.env');

const allowMutation = process.env.ONE_VEGETABLE_REAL_PRODUCT_BATCH_PUBLISH_SMOKE === '1';
const reportPath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_REAL_PRODUCT_BATCH_PUBLISH_OUTPUT ??
    `artifacts/real-smoke/product-batch-publish-${RUN_DATE}.json`
);
const previousReport = await readReport(reportPath);
const runId = readOptionalString(previousReport, 'runId') ?? randomUUID().slice(0, 8);
const titleMarker =
  readOptionalString(previousReport, 'titleMarker') ?? `oneVegetable-batch-smoke-${RUN_DATE}-${runId}`;
const credentialFile = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ??
    process.env.OPEN_API_OUTPUT ??
    'artifacts/openapi-auth/credentials.json'
);
const provider = createNodeAlibabaCredentialProvider(
  { ...process.env, ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: credentialFile },
  { workingDirectory: process.cwd() }
);
const gateway = new AlibabaReadGatewayClient(provider.requireCredentials(), { maxAttempts: 1 });
const requests: RequestEntry[] = readRequestEntries(previousReport);
let reportItems: ReportItem[] = readReportItems(previousReport);
let reportContext: ReportContext | null = readReportContext(previousReport);

await main();

async function main(): Promise<void> {
  assertSafePreviousState(previousReport);

  if (reportItems.length === BATCH_SIZE && reportItems.every(hasAcceptedProduct)) {
    await verifyAcceptedBatch();
    return;
  }

  try {
    const candidate = await selectPublishCandidate();
    const batchItems = createBatchItems(candidate);
    const preflights = batchItems.map((item) => inspectProductBatchPublishItem(item, 'publish'));
    const blocked = preflights.flatMap((preflight, index) =>
      preflight.ready
        ? []
        : [
            {
              index: index + 1,
              issues: preflight.blockingIssues,
              schemaIssueCount: preflight.schemaIssueCount
            }
          ]
    );
    reportContext = {
      sourceProductId: candidate.product.id,
      categoryId: candidate.product.categoryId,
      language: LANGUAGE,
      titleMarker
    };
    reportItems = batchItems.map((item, index) => ({
      index: index + 1,
      itemId: item.id,
      titleSuffix: `${titleMarker}-${String(index + 1).padStart(2, '0')}`,
      status: blocked.some((entry) => entry.index === index + 1) ? 'blocked' : 'queued',
      requestId: null,
      productId: null,
      traceId: null,
      readBackVisible: false,
      error: blocked.find((entry) => entry.index === index + 1)?.issues.join('；') ?? null
    }));

    if (blocked.length > 0) {
      await writeCurrentReport('preflight-blocked', false);
      throw new Error(`批量发布预检有 ${blocked.length} 条商品未通过，拒绝真实提交`);
    }

    await writeCurrentReport('preflight-ready', false);
    if (!allowMutation) {
      process.stdout.write(
        `真实批量发品预检通过：${BATCH_SIZE} 条；设置 ONE_VEGETABLE_REAL_PRODUCT_BATCH_PUBLISH_SMOKE=1 后提交。\n`
      );
      process.stdout.write(`脱敏报告：${reportPath}\n`);
      return;
    }

    await writeCurrentReport('batch-started', true);
    const results = await runProductBatchPublish({
      items: batchItems,
      target: 'publish',
      submit: async (request, item) => {
        const requestId = randomUUID();
        requests.push({ operation: 'publishProduct', requestId });
        updateReportItem(item.id, { status: 'submitting', requestId, error: null });
        await writeCurrentReport('batch-started', true);
        try {
          const response = await gateway.request('publishProduct', request, { requestId });
          updateReportItem(item.id, {
            status: 'accepted',
            productId: response.productId,
            traceId: response.traceId
          });
          await writeCurrentReport('batch-started', true);
          return response;
        } catch (error: unknown) {
          updateReportItem(item.id, { status: 'failed', error: errorRecord(error) });
          await writeCurrentReport('batch-started', true);
          throw error;
        }
      }
    });
    const failed = results.filter((result) => result.status !== 'succeeded');
    if (failed.length > 0) {
      await writeCurrentReport('completed-with-errors', true, results);
      throw new Error(`批量发布完成但有 ${failed.length} 条失败或阻断；不会自动重试`);
    }

    await writeCurrentReport('batch-accepted', true, results);
    await verifyAcceptedBatch(results);
  } catch (error: unknown) {
    const status = readOptionalString(await readReport(reportPath), 'status');
    if (!status || ['preflight-ready', 'preflight-blocked'].includes(status)) {
      await writeCurrentReport(status ?? 'preflight-failed', allowMutation, undefined, errorRecord(error));
    }
    throw error;
  }
}

type PublishSourceProduct = Product & { categoryId: number };

async function selectPublishCandidate(): Promise<{
  product: PublishSourceProduct;
  model: ProductSchemaModel;
}> {
  const preferredId =
    nonEmpty(process.env.ONE_VEGETABLE_REAL_PRODUCT_BATCH_PUBLISH_SOURCE_ID) ?? DEFAULT_SOURCE_PRODUCT_ID;
  const products = await listProducts();
  const candidates = products
    .filter(
      (product): product is PublishSourceProduct =>
        product.categoryId !== null &&
        product.categoryId > 0 &&
        ['online', 'offline'].includes(product.status)
    )
    .toSorted((left, right) => Number(right.id === preferredId) - Number(left.id === preferredId));
  const failures: string[] = [];
  for (const product of candidates.slice(0, 12)) {
    try {
      const rendered = await call('renderProductSchema', {
        productId: product.id,
        categoryId: product.categoryId,
        language: LANGUAGE
      });
      const model = parseProductSchemaXml(rendered.xml);
      const inspection = inspectProductSchemaSerialization(model);
      if (!inspection.safe) throw new Error(inspection.structuralDiffs.join('；'));
      const errors = validateProductSchemaModel(model).filter((issue) => issue.severity === 'error');
      if (errors.length === 0) return { product, model };
      failures.push(`${product.id}:local-schema-errors=${errors.length}`);
    } catch (error: unknown) {
      failures.push(`${product.id}:${errorCode(error)}`);
    }
  }
  throw new Error(`没有找到可安全复用的真实商品 Schema：${failures.slice(0, 8).join('，')}`);
}

function createBatchItems(candidate: {
  product: PublishSourceProduct;
  model: ProductSchemaModel;
}): ProductBatchPublishItem[] {
  const title = findTitleField(candidate.model);
  const originalTitle = productSchemaFieldText(title.field).trim();
  if (!originalTitle) throw new Error('源商品标题为空，不能构造批量发布 Smoke');

  return Array.from({ length: BATCH_SIZE }, (_, offset) => {
    const index = offset + 1;
    const suffix = ` [${titleMarker}-${String(index).padStart(2, '0')}]`;
    const smokeTitle = createSmokeTitle(originalTitle, suffix, title.field);
    const model = updateField(candidate.model, title.field.key, title.rootKey, (field) =>
      withProductSchemaFieldText(field, smokeTitle)
    );
    const inspection = inspectProductSchemaSerialization(model);
    if (!inspection.safe) {
      throw new Error(`第 ${index} 条 Schema XML 结构异常：${inspection.structuralDiffs.join('；')}`);
    }
    const now = Date.now() + index;
    return {
      schemaVersion: 1,
      id: `batch-smoke-${runId}-${String(index).padStart(2, '0')}`,
      title: smokeTitle,
      categoryId: String(candidate.product.categoryId),
      language: LANGUAGE,
      market: 'wholesale',
      xml: inspection.xml,
      status: 'queued',
      platformProductId: null,
      createdAtUtc: now,
      updatedAtUtc: now
    };
  });
}

async function verifyAcceptedBatch(results?: readonly ProductBatchPublishRunResult[]): Promise<void> {
  const expected = reportItems.filter(hasAcceptedProduct);
  if (expected.length !== BATCH_SIZE) {
    throw new Error(`仅有 ${expected.length}/${BATCH_SIZE} 条取得明确商品 ID，拒绝继续`);
  }
  const visibleIds = await waitForPublishedProducts(expected.map((item) => item.productId));
  for (const item of expected) {
    updateReportItem(item.itemId, {
      status: visibleIds.has(item.productId) ? 'verified' : 'accepted',
      readBackVisible: visibleIds.has(item.productId)
    });
  }
  const verifiedCount = reportItems.filter((item) => item.readBackVisible).length;
  await writeCurrentReport(verifiedCount === BATCH_SIZE ? 'passed' : 'accepted-unverified', true, results);
  process.stdout.write(
    verifiedCount === BATCH_SIZE
      ? `真实批量发品已全部被平台接受并回读：${BATCH_SIZE}/${BATCH_SIZE}。\n`
      : `真实批量发品已全部被平台接受，当前回读 ${verifiedCount}/${BATCH_SIZE}；禁止重复创建。\n`
  );
  for (const item of reportItems) {
    process.stdout.write(`第 ${item.index} 条：${item.productId ?? '无商品 ID'}（${item.status}）\n`);
  }
  process.stdout.write('按验收约定保留平台当前状态，未执行下架。\n');
  process.stdout.write(`脱敏报告：${reportPath}\n`);
}

async function waitForPublishedProducts(productIds: readonly string[]): Promise<Set<string>> {
  const expected = new Set(productIds);
  let visible = new Set<string>();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const result = await call('listProducts', {
        page: 1,
        pageSize: 100,
        subject: titleMarker,
        language: LANGUAGE
      });
      visible = new Set(
        result.items
          .filter((item) => expected.has(item.id) && item.subject.includes(titleMarker))
          .map((item) => item.id)
      );
      if (visible.size === expected.size) return visible;
    } catch (error: unknown) {
      if (!verificationMayRetry(error)) throw error;
    }
    await delay(5_000);
  }
  return visible;
}

async function listProducts(): Promise<Product[]> {
  const items: Product[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const result = await call('listProducts', { page, pageSize: 100, language: LANGUAGE });
    items.push(...result.items);
    if (page * result.pageSize >= result.total) break;
  }
  return items;
}

function findTitleField(model: ProductSchemaModel): {
  rootKey: string;
  field: ProductSchemaField;
} {
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

function createSmokeTitle(original: string, suffix: string, field: ProductSchemaField): string {
  const configuredLimit = field.rules
    .filter((rule) => rule.name === 'maxLengthRule')
    .map((rule) => Number(rule.value))
    .find((value) => Number.isSafeInteger(value) && value > 0);
  const limit = Math.min(configuredLimit ?? 128, 128);
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const originalSegments = Array.from(segmenter.segment(original), ({ segment }) => segment);
  const suffixSegments = Array.from(segmenter.segment(suffix), ({ segment }) => segment);
  if (suffixSegments.length >= limit) throw new Error('批量 Smoke 标记超过商品标题长度限制');
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

async function call<K extends OperationId>(operation: K, payload: RequestOf<K>): Promise<ResponseOf<K>> {
  const requestId = randomUUID();
  requests.push({ operation, requestId });
  return gateway.request(operation, payload, { requestId });
}

function updateReportItem(itemId: string, patch: Partial<ReportItem>): void {
  reportItems = reportItems.map((item) => (item.itemId === itemId ? { ...item, ...patch } : item));
}

async function writeCurrentReport(
  status: string,
  mutationAttempted: boolean,
  results?: readonly ProductBatchPublishRunResult[],
  error?: ErrorValue
): Promise<void> {
  await atomicWriteJson(reportPath, {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    status,
    runId,
    titleMarker,
    batchSize: BATCH_SIZE,
    mutationAttempted,
    cleanupAttempted: false,
    context: reportContext,
    requests,
    items: reportItems,
    ...(results ? { results } : {}),
    ...(error ? { error } : {})
  });
}

function assertSafePreviousState(report: Record<string, unknown> | null): void {
  const status = readOptionalString(report, 'status');
  if (!status || ['preflight-ready', 'preflight-blocked', 'preflight-failed'].includes(status)) return;
  if (reportItems.length === BATCH_SIZE && reportItems.every(hasAcceptedProduct)) return;
  throw new Error(
    `真实批量发布已有 ${status} 记录且未全部取得明确商品 ID；为避免重复商品，本脚本拒绝再次提交`
  );
}

function hasAcceptedProduct(item: ReportItem): item is ReportItem & { productId: string } {
  return (
    typeof item.productId === 'string' &&
    item.productId.length > 0 &&
    ['accepted', 'verified'].includes(item.status)
  );
}

interface ReportContext {
  sourceProductId: string;
  categoryId: number;
  language: typeof LANGUAGE;
  titleMarker: string;
}

interface RequestEntry {
  operation: OperationId;
  requestId: string;
}

interface ReportItem {
  index: number;
  itemId: string;
  titleSuffix: string;
  status: 'queued' | 'blocked' | 'submitting' | 'accepted' | 'verified' | 'failed';
  requestId: string | null;
  productId: string | null;
  traceId: string | null;
  readBackVisible: boolean;
  error: ErrorValue | string | null;
}

interface ErrorValue {
  code: string;
  subCode?: string | null;
  traceId?: string | null;
  message: string;
}

function readReportContext(report: Record<string, unknown> | null): ReportContext | null {
  const context = isRecord(report?.context) ? report.context : null;
  if (
    !context ||
    typeof context.sourceProductId !== 'string' ||
    typeof context.categoryId !== 'number' ||
    context.language !== LANGUAGE ||
    typeof context.titleMarker !== 'string'
  ) {
    return null;
  }
  return {
    sourceProductId: context.sourceProductId,
    categoryId: context.categoryId,
    language: LANGUAGE,
    titleMarker: context.titleMarker
  };
}

function readRequestEntries(report: Record<string, unknown> | null): RequestEntry[] {
  if (!Array.isArray(report?.requests)) return [];
  return report.requests.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.operation !== 'string' || typeof entry.requestId !== 'string') {
      return [];
    }
    return [{ operation: entry.operation as OperationId, requestId: entry.requestId }];
  });
}

function readReportItems(report: Record<string, unknown> | null): ReportItem[] {
  if (!Array.isArray(report?.items)) return [];
  return report.items.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.index !== 'number' ||
      typeof item.itemId !== 'string' ||
      typeof item.titleSuffix !== 'string' ||
      typeof item.status !== 'string'
    ) {
      return [];
    }
    return [
      {
        index: item.index,
        itemId: item.itemId,
        titleSuffix: item.titleSuffix,
        status: readReportItemStatus(item.status),
        requestId: typeof item.requestId === 'string' ? item.requestId : null,
        productId: typeof item.productId === 'string' ? item.productId : null,
        traceId: typeof item.traceId === 'string' ? item.traceId : null,
        readBackVisible: item.readBackVisible === true,
        error: typeof item.error === 'string' || isErrorValue(item.error) ? item.error : null
      }
    ];
  });
}

function readReportItemStatus(value: string): ReportItem['status'] {
  if (['queued', 'blocked', 'submitting', 'accepted', 'verified', 'failed'].includes(value)) {
    return value as ReportItem['status'];
  }
  return 'failed';
}

function errorRecord(error: unknown): ErrorValue {
  if (error instanceof GatewayException) {
    return {
      code: error.gatewayError.code,
      subCode: error.gatewayError.subCode ?? null,
      traceId: error.gatewayError.traceId ?? null,
      message: sanitizeDiagnosticMessage(error.gatewayError.message)
    };
  }
  return { code: 'UNEXPECTED_ERROR', message: safeMessage(error) };
}

function errorCode(error: unknown): string {
  return error instanceof GatewayException ? error.gatewayError.code : 'UNEXPECTED_ERROR';
}

function verificationMayRetry(error: unknown): boolean {
  return (
    error instanceof GatewayException &&
    (error.gatewayError.retryable ||
      error.gatewayError.code === '15' ||
      error.gatewayError.subCode === '000000')
  );
}

async function readReport(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function readOptionalString(report: Record<string, unknown> | null, key: string): string | null {
  const value = report?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function isErrorValue(value: unknown): value is ErrorValue {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string';
}

function safeMessage(error: unknown): string {
  return sanitizeDiagnosticMessage(error instanceof Error ? error.message : '未知错误');
}

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, milliseconds));
}
