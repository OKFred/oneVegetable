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
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { atomicWriteJson } from './openapi-auth/storage';
import { installNodeXmlDomGlobals } from './node-xml-dom';

const LANGUAGE = 'en_US' as const;
const DEFAULT_SOURCE_PRODUCT_ID = '1601928079741';
const TITLE_MARKER = `oneVegetable API validation ${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;

installNodeXmlDomGlobals();
if (existsSync('.env')) loadEnvFile('.env');
const allowMutation = process.env.ONE_VEGETABLE_REAL_PRODUCT_PUBLISH_SMOKE === '1';
const cleanupOnlineProduct = process.env.ONE_VEGETABLE_REAL_PRODUCT_PUBLISH_KEEP_ONLINE !== '1';

const reportPath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_REAL_PRODUCT_PUBLISH_OUTPUT ??
    'artifacts/real-smoke/product-publish-20260828.json'
);
const previousReport = await readReport(reportPath);

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
const requests: { operation: OperationId; requestId: string }[] = readRequestEntries(previousReport);

await main();

async function main(): Promise<void> {
  if (allowMutation && previousReport?.status === 'passed') {
    process.stdout.write(
      `真实商品发布 Smoke 已通过：${requiredReportString(previousReport, 'productId')}；不会重复创建。\n`
    );
    process.stdout.write(`脱敏报告：${reportPath}\n`);
    return;
  }
  if (allowMutation && isAcceptedPublishReport(previousReport)) {
    await verifyAcceptedPublish(readAcceptedPublish(previousReport));
    return;
  }
  if (allowMutation) assertNoPreviousPublishAttempt(previousReport);

  try {
    const candidate = await selectPublishCandidate();
    const title = findTitleField(candidate.model);
    const originalTitle = productSchemaFieldText(title.field).trim();
    if (!originalTitle) throw new Error('源商品标题为空，不能构造发布 Smoke');
    const smokeTitle = createSmokeTitle(originalTitle, title.field);
    const model = updateField(candidate.model, title.field.key, title.rootKey, (field) =>
      withProductSchemaFieldText(field, smokeTitle)
    );
    const inspection = inspectProductSchemaSerialization(model);
    if (!inspection.safe) {
      throw new Error(`发布 Schema XML 结构异常：${inspection.structuralDiffs.join('；')}`);
    }
    const blockingIssues = validateProductSchemaModel(model).filter((issue) => issue.severity === 'error');
    const preflight = {
      sourceProductId: candidate.product.id,
      categoryId: candidate.product.categoryId,
      language: LANGUAGE,
      titleMarker: TITLE_MARKER,
      changedFieldCount: inspection.changedFieldKeys.length,
      blockingIssueCount: blockingIssues.length,
      blockingIssueRules: [...new Set(blockingIssues.map((issue) => issue.rule))]
    };
    if (blockingIssues.length > 0) {
      await writeReport('preflight-blocked', { ...preflight, mutationAttempted: false });
      throw new Error(`发布前仍有 ${blockingIssues.length} 个 Schema 硬错误，拒绝真实提交`);
    }

    if (!allowMutation) {
      await writeReport('preflight-ready', { ...preflight, mutationAttempted: false });
      process.stdout.write(
        `真实发品预检通过；设置 ONE_VEGETABLE_REAL_PRODUCT_PUBLISH_SMOKE=1 后执行提交。\n`
      );
      process.stdout.write(`脱敏报告：${reportPath}\n`);
      return;
    }

    await writeReport('publish-started', { ...preflight, mutationAttempted: true });
    const published = await call('publishProduct', {
      categoryId: candidate.product.categoryId,
      language: LANGUAGE,
      schemaXml: inspection.xml
    });
    await writeReport('publish-accepted', {
      ...preflight,
      mutationAttempted: true,
      productId: published.productId,
      traceId: published.traceId
    });
    await verifyAcceptedPublish({
      ...preflight,
      productId: published.productId,
      traceId: published.traceId
    });
  } catch (error: unknown) {
    const previous = await readReportStatus(reportPath);
    if (!['publish-accepted', 'passed', 'accepted-unverified'].includes(previous ?? '')) {
      await writeReport(previous === 'publish-started' ? 'publish-failed' : 'preflight-failed', {
        mutationAttempted: previous === 'publish-started',
        error: errorRecord(error)
      });
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
    nonEmpty(process.env.ONE_VEGETABLE_REAL_PRODUCT_PUBLISH_SOURCE_ID) ?? DEFAULT_SOURCE_PRODUCT_ID;
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

async function listProducts(): Promise<Product[]> {
  const items: Product[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const result = await call('listProducts', { page, pageSize: 100, language: LANGUAGE });
    items.push(...result.items);
    if (page * result.pageSize >= result.total) break;
  }
  return items;
}

async function verifyAcceptedPublish(context: AcceptedPublishContext): Promise<void> {
  const visible = await waitForPublishedProduct(context.productId, context.titleMarker);
  let cleanup: Record<string, unknown> = { attempted: false, reason: '商品尚未处于 online 状态' };
  if (visible?.status === 'online' && visible.encryptedId && cleanupOnlineProduct) {
    const result = await call('updateProductDisplay', {
      productIds: [visible.id],
      encryptedProductIds: [visible.encryptedId],
      display: 'offline'
    });
    const offline = await waitForProductStatus(visible.id, 'offline');
    cleanup = {
      attempted: true,
      accepted: result.success,
      traceId: result.traceId,
      verifiedOffline: offline
    };
  }

  await writeReport(visible ? 'passed' : 'accepted-unverified', {
    ...context,
    mutationAttempted: true,
    readBackVisible: visible !== null,
    productStatus: visible?.status ?? null,
    titleRoundTrip: visible?.subject.includes(context.titleMarker) ?? false,
    cleanup
  });
  process.stdout.write(
    visible
      ? `真实商品发布已被平台接受并回读：${context.productId}（${visible.status}）。\n`
      : `真实商品发布已被平台接受：${context.productId}；暂未在列表回读，禁止重复创建。\n`
  );
  process.stdout.write(`脱敏报告：${reportPath}\n`);
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

function createSmokeTitle(original: string, field: ProductSchemaField): string {
  const configuredLimit = field.rules
    .filter((rule) => rule.name === 'maxLengthRule')
    .map((rule) => Number(rule.value))
    .find((value) => Number.isSafeInteger(value) && value > 0);
  const limit = Math.min(configuredLimit ?? 128, 128);
  const suffix = ` ${TITLE_MARKER}`;
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

async function waitForPublishedProduct(productId: string, titleMarker: string): Promise<Product | null> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const result = await call('listProducts', {
        page: 1,
        pageSize: 100,
        subject: titleMarker,
        language: LANGUAGE
      });
      const product = result.items.find((item) => item.id === productId);
      if (product?.subject.includes(titleMarker)) return product;
    } catch (error: unknown) {
      if (!verificationMayRetry(error)) throw error;
    }
    await delay(5_000);
  }
  return null;
}

async function waitForProductStatus(productId: string, status: 'offline'): Promise<boolean> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const product = (await listProducts()).find((item) => item.id === productId);
      if (product?.status === status) return true;
    } catch (error: unknown) {
      if (!verificationMayRetry(error)) throw error;
    }
    await delay(5_000);
  }
  return false;
}

async function call<K extends OperationId>(operation: K, payload: RequestOf<K>): Promise<ResponseOf<K>> {
  const requestId = randomUUID();
  requests.push({ operation, requestId });
  return gateway.request(operation, payload, { requestId });
}

function assertNoPreviousPublishAttempt(report: Record<string, unknown> | null): void {
  const status = typeof report?.status === 'string' ? report.status : null;
  if (
    status &&
    ['publish-started', 'publish-failed', 'publish-accepted', 'passed', 'accepted-unverified'].includes(
      status
    )
  ) {
    throw new Error(`真实发布 Smoke 已存在 ${status} 记录；为避免重复商品，本脚本拒绝再次执行`);
  }
}

async function readReportStatus(path: string): Promise<string | null> {
  const value = await readReport(path);
  return typeof value?.status === 'string' ? value.status : null;
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

interface AcceptedPublishContext {
  sourceProductId: string;
  categoryId: number;
  language: typeof LANGUAGE;
  titleMarker: string;
  changedFieldCount: number;
  blockingIssueCount: number;
  blockingIssueRules: string[];
  productId: string;
  traceId: string;
}

function isAcceptedPublishReport(report: Record<string, unknown> | null): report is Record<string, unknown> {
  return report?.status === 'publish-accepted' || report?.status === 'accepted-unverified';
}

function readAcceptedPublish(report: Record<string, unknown>): AcceptedPublishContext {
  return {
    sourceProductId: requiredReportString(report, 'sourceProductId'),
    categoryId: requiredReportNumber(report, 'categoryId'),
    language: LANGUAGE,
    titleMarker: requiredReportString(report, 'titleMarker'),
    changedFieldCount: requiredReportNumber(report, 'changedFieldCount'),
    blockingIssueCount: requiredReportNumber(report, 'blockingIssueCount'),
    blockingIssueRules: Array.isArray(report.blockingIssueRules)
      ? report.blockingIssueRules.filter((value): value is string => typeof value === 'string')
      : [],
    productId: requiredReportString(report, 'productId'),
    traceId: requiredReportString(report, 'traceId')
  };
}

function readRequestEntries(
  report: Record<string, unknown> | null
): { operation: OperationId; requestId: string }[] {
  if (!Array.isArray(report?.requests)) return [];
  return report.requests.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.operation !== 'string' || typeof entry.requestId !== 'string') {
      return [];
    }
    return [{ operation: entry.operation as OperationId, requestId: entry.requestId }];
  });
}

function requiredReportString(report: Record<string, unknown>, key: string): string {
  const value = report[key];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`真实发布报告缺少 ${key}`);
  return value;
}

function requiredReportNumber(report: Record<string, unknown>, key: string): number {
  const value = report[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`真实发布报告缺少 ${key}`);
  return value;
}

function safeMessage(error: unknown): string {
  return sanitizeDiagnosticMessage(error instanceof Error ? error.message : '未知错误');
}

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (normalized === undefined || normalized === '') return null;
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, milliseconds));
}
