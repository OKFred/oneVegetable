import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

import {
  createProductTransferDocument,
  GatewayException,
  inspectProductSchemaSerialization,
  markProductSchemaFieldTouched,
  parseProductSchemaXml,
  parseProductTransferJson,
  productSchemaFieldText,
  productTransferQueueItemId,
  sanitizeDiagnosticMessage,
  serializeProductTransferDocument,
  withProductSchemaFieldText,
  type Product,
  type ProductSchemaField,
  type ProductSchemaModel,
  type RequestOf,
  type ResponseOf
} from '../packages/core/src/index';
import {
  completeProductBatchPublishItem,
  importProductBatchPublishItems,
  inspectProductBatchPublishItem,
  runProductBatchPublish
} from '../packages/ui/src/lib/product-batch-publish';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { atomicWriteJson } from './openapi-auth/storage';
import { installNodeXmlDomGlobals } from './node-xml-dom';

const LANGUAGE = 'en_US' as const;
const RUN_DATE = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const DEFAULT_SOURCE_PRODUCT_ID = '1601935983207';

installNodeXmlDomGlobals();
if (existsSync('.env')) loadEnvFile('.env');

const allowMutation = process.env.ONE_VEGETABLE_REAL_PRODUCT_TRANSFER_DRAFT_SMOKE === '1';
const reportPath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_REAL_PRODUCT_TRANSFER_DRAFT_OUTPUT ??
    `artifacts/real-smoke/product-transfer-draft-${RUN_DATE}.report.json`
);
const transferPath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_REAL_PRODUCT_TRANSFER_DRAFT_FILE ??
    `artifacts/real-smoke/product-transfer-draft-${RUN_DATE}.json`
);
const previousReport = await readReport(reportPath);
const runId = readString(previousReport, 'runId') ?? randomUUID().slice(0, 8);
const titleMarker =
  readString(previousReport, 'titleMarker') ?? `oneVegetable-transfer-draft-${RUN_DATE}-${runId}`;
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
const requests: RequestEntry[] = readRequests(previousReport);
let context = readRecord(previousReport, 'context');
let transferSummary = readRecord(previousReport, 'transfer');
let productId = readString(previousReport, 'productId');
let traceId = readString(previousReport, 'traceId');
let verification = readRecord(previousReport, 'verification');

async function main(): Promise<void> {
  const previousStatus = readString(previousReport, 'status');
  if (
    productId &&
    ['created-unverified', 'created-contract-drift', 'passed'].includes(previousStatus ?? '')
  ) {
    await verifyCreatedDraft(productId);
    return;
  }
  if (
    previousStatus &&
    !['preflight-ready', 'preflight-blocked', 'preflight-failed'].includes(previousStatus)
  ) {
    throw new Error(
      `真实商品 JSON 草稿验收已有 ${previousStatus} 记录但没有明确商品 ID；为避免重复草稿，拒绝再次提交`
    );
  }

  try {
    const transfer = await loadOrCreateTransfer();
    const serialized = serializeProductTransferDocument(transfer);
    if (!serialized.includes(titleMarker)) {
      throw new Error('商品 JSON 不包含本次预检标题标记，拒绝真实提交');
    }
    const sha256 = createHash('sha256').update(serialized).digest('hex');
    const previousSha256 = readString(transferSummary, 'sha256');
    if (previousSha256 && previousSha256 !== sha256) {
      throw new Error('商品 JSON 与已记录预检摘要不一致，拒绝真实提交');
    }

    const storage = new MemoryDraftStorage();
    const imported = importProductBatchPublishItems(
      storage,
      transfer.products.map((product) => ({
        id: productTransferQueueItemId(product),
        title: product.source.subject,
        categoryId: String(product.categoryId),
        language: product.language,
        market: product.market,
        xml: product.schemaXml
      }))
    );
    const item = imported.items[0];
    if (!item || imported.items.length !== 1 || imported.added !== 1) {
      throw new Error('商品 JSON 未原子导入为唯一待写入队列项');
    }
    const preflight = inspectProductBatchPublishItem(item, 'draft');
    context = {
      sourceProductId: transfer.products[0]?.source.productId ?? '',
      categoryId: transfer.products[0]?.categoryId ?? 0,
      language: LANGUAGE
    };
    transferSummary = {
      format: transfer.format,
      schemaVersion: transfer.schemaVersion,
      productCount: transfer.products.length,
      byteLength: new TextEncoder().encode(serialized).byteLength,
      sha256,
      importAdded: imported.added,
      importUpdated: imported.updated,
      importSkipped: imported.skipped
    };
    verification = {
      preflightReady: preflight.ready,
      schemaIssueCount: preflight.schemaIssueCount,
      blockingIssueCount: preflight.blockingIssues.length,
      titleMarkerRoundTrip: false,
      schemaRoundTripSafe: false
    };
    if (!preflight.ready || !preflight.request) {
      await writeReport('preflight-blocked', false, {
        code: 'PRODUCT_TRANSFER_PREFLIGHT_BLOCKED',
        message: sanitizeDiagnosticMessage(preflight.blockingIssues.join('；'))
      });
      throw new Error('商品 JSON 草稿预检未通过，拒绝真实提交');
    }

    await writeReport('preflight-ready', false);
    if (!allowMutation) {
      process.stdout.write(
        `真实商品 JSON 草稿预检通过；设置 ONE_VEGETABLE_REAL_PRODUCT_TRANSFER_DRAFT_SMOKE=1 后仅创建 1 条平台草稿。\n`
      );
      process.stdout.write(`商品 JSON：${transferPath}\n脱敏报告：${reportPath}\n`);
      return;
    }

    const results = await runProductBatchPublish({
      items: [item],
      target: 'draft',
      submit: async (request) => {
        const requestId = recordRequest('saveProductDraft');
        await writeReport('mutation-started', true);
        try {
          const created = await gateway.request('saveProductDraft', request, { requestId });
          productId = created.productId;
          traceId = created.traceId;
          await writeReport('created-unverified', true);
          const completed = completeProductBatchPublishItem(storage, item.id, 'draft', created.productId);
          const duplicatePreflight = inspectProductBatchPublishItem(completed, 'draft');
          verification = {
            ...(verification ?? {}),
            queueStatus: completed.status,
            duplicateSubmissionBlocked: !duplicatePreflight.ready
          };
          if (duplicatePreflight.ready) {
            throw new Error('平台已接受草稿，但本地完成态没有阻断重复提交');
          }
          await writeReport('created-unverified', true);
          return created;
        } catch (error: unknown) {
          await writeReport('mutation-failed', true, errorRecord(error));
          throw error;
        }
      }
    });
    const result = results[0];
    if (result?.status !== 'succeeded' || !productId) {
      throw new Error('真实草稿请求未取得明确成功和商品 ID；禁止自动重试');
    }
    await verifyCreatedDraft(productId);
  } catch (error: unknown) {
    const latestStatus = readString(await readReport(reportPath), 'status');
    if (
      !latestStatus ||
      ['preflight-ready', 'preflight-blocked', 'preflight-failed'].includes(latestStatus)
    ) {
      await writeReport('preflight-failed', false, errorRecord(error));
    }
    throw error;
  }
}

async function loadOrCreateTransfer() {
  if (existsSync(transferPath)) {
    if (!previousReport) {
      throw new Error('商品 JSON 文件存在但缺少配套预检报告，拒绝复用未知候选');
    }
    return parseProductTransferJson(await readFile(transferPath, 'utf8'));
  }
  if (readString(previousReport, 'status') === 'preflight-ready') {
    throw new Error('预检报告存在但商品 JSON 文件缺失，拒绝重新构造候选');
  }

  const candidate = await selectCandidate();
  const title = findTitleField(candidate.model);
  const originalTitle = productSchemaFieldText(title.field).trim();
  if (!originalTitle) throw new Error('源商品标题为空，不能构造 JSON 草稿验收候选');
  const smokeTitle = createSmokeTitle(originalTitle, ` [${titleMarker}]`, title.field);
  const model = updateField(candidate.model, title.field.key, title.rootKey, (field) =>
    withProductSchemaFieldText(field, smokeTitle)
  );
  const inspection = inspectProductSchemaSerialization(model);
  if (!inspection.safe) {
    throw new Error(`商品 JSON Schema XML 结构异常：${inspection.structuralDiffs.join('；')}`);
  }
  const transfer = createProductTransferDocument([
    {
      source: {
        productId: candidate.product.id,
        subject: smokeTitle,
        groupName: candidate.product.groupName,
        status: candidate.product.status,
        updatedAt: candidate.product.updatedAt
      },
      categoryId: candidate.product.categoryId,
      language: LANGUAGE,
      market: 'wholesale',
      schemaXml: inspection.xml
    }
  ]);
  serializeProductTransferDocument(transfer);
  await atomicWriteJson(transferPath, transfer);
  return parseProductTransferJson(await readFile(transferPath, 'utf8'));
}

type SourceProduct = Product & { categoryId: number };

async function selectCandidate(): Promise<{ product: SourceProduct; model: ProductSchemaModel }> {
  const configuredSourceId = process.env.ONE_VEGETABLE_REAL_PRODUCT_TRANSFER_DRAFT_SOURCE_ID?.trim() ?? '';
  const preferredId = configuredSourceId === '' ? DEFAULT_SOURCE_PRODUCT_ID : configuredSourceId;
  const products: Product[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const result = await call('listProducts', { page, pageSize: 100, language: LANGUAGE });
    products.push(...result.items);
    if (page * result.pageSize >= result.total) break;
  }
  const usableProducts = products.filter(
    (product): product is SourceProduct =>
      product.categoryId !== null &&
      product.categoryId > 0 &&
      (product.status === 'online' || product.status === 'offline')
  );
  const candidates =
    configuredSourceId === ''
      ? usableProducts.toSorted(
          (left, right) => Number(right.id === preferredId) - Number(left.id === preferredId)
        )
      : usableProducts.filter((product) => product.id === preferredId);
  if (configuredSourceId !== '' && candidates.length === 0) {
    throw new Error(`显式指定的源商品 ${preferredId} 不在当前可导出商品列表中`);
  }
  const failures: string[] = [];
  for (const product of candidates.slice(0, 12)) {
    try {
      const schema = await call('renderProductSchema', {
        productId: product.id,
        categoryId: product.categoryId,
        language: LANGUAGE
      });
      const model = parseProductSchemaXml(schema.xml);
      const inspection = inspectProductSchemaSerialization(model);
      if (!inspection.safe) throw new Error(inspection.structuralDiffs.join('；'));
      findTitleField(model);
      return { product, model };
    } catch (error: unknown) {
      failures.push(`${product.id}:${errorCode(error)}`);
    }
  }
  throw new Error(`没有找到可安全导出的真实商品 Schema：${failures.slice(0, 8).join('，')}`);
}

async function verifyCreatedDraft(id: string): Promise<void> {
  try {
    const rendered = await call('getProductDraft', { productId: id, language: LANGUAGE });
    const roundTrip = inspectProductSchemaSerialization(parseProductSchemaXml(rendered.schemaXml));
    const titleMarkerRoundTrip = rendered.schemaXml.includes(titleMarker);
    verification = {
      ...(verification ?? {}),
      titleMarkerRoundTrip,
      schemaRoundTripSafe: roundTrip.safe
    };
    if (!titleMarkerRoundTrip || !roundTrip.safe) {
      await writeReport('created-contract-drift', true, {
        code: 'PRODUCT_TRANSFER_DRAFT_READBACK_MISMATCH',
        message: '平台草稿已创建，但回读标题标记或 XML 结构不一致'
      });
      throw new Error(`平台草稿 ${id} 已创建但回读不一致；禁止重复创建`);
    }
    await writeReport('passed', true);
    process.stdout.write(`真实商品 JSON 已导入并创建平台草稿，回读通过：${id}\n`);
    process.stdout.write('平台草稿已保留，未正式发布、未删除。\n');
    process.stdout.write(`商品 JSON：${transferPath}\n脱敏报告：${reportPath}\n`);
  } catch (error: unknown) {
    const status = readString(await readReport(reportPath), 'status');
    if (status !== 'created-contract-drift') {
      await writeReport('created-unverified', true, errorRecord(error));
    }
    throw error;
  }
}

type TransferOperation = 'listProducts' | 'renderProductSchema' | 'saveProductDraft' | 'getProductDraft';

async function call<K extends TransferOperation>(
  operation: K,
  payload: RequestOf<K>
): Promise<ResponseOf<K>> {
  const requestId = recordRequest(operation);
  return gateway.request(operation, payload, { requestId });
}

function recordRequest(operation: TransferOperation): string {
  const requestId = randomUUID();
  requests.push({ operation, requestId });
  return requestId;
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

function createSmokeTitle(original: string, suffix: string, field: ProductSchemaField): string {
  const configuredLimit = field.rules
    .filter((rule) => rule.name === 'maxLengthRule')
    .map((rule) => Number(rule.value))
    .find((value) => Number.isSafeInteger(value) && value > 0);
  const limit = Math.min(configuredLimit ?? 128, 128);
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const originalSegments = Array.from(segmenter.segment(original), ({ segment }) => segment);
  const suffixSegments = Array.from(segmenter.segment(suffix), ({ segment }) => segment);
  if (suffixSegments.length >= limit) throw new Error('商品 JSON 草稿验收标记超过标题长度限制');
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

async function writeReport(status: string, mutationAttempted: boolean, error?: ErrorValue): Promise<void> {
  await atomicWriteJson(reportPath, {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    status,
    runId,
    titleMarker,
    mutationAttempted,
    cleanupAttempted: false,
    context,
    transfer: transferSummary,
    verification,
    requests,
    productId: productId ?? null,
    traceId: traceId ?? null,
    ...(error ? { error } : {})
  });
}

async function readReport(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function readRequests(report: Record<string, unknown> | null): RequestEntry[] {
  const value = report?.requests;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is RequestEntry =>
      isRecord(item) && typeof item.operation === 'string' && typeof item.requestId === 'string'
  );
}

function readRecord(record: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  const value = record?.[key];
  return isRecord(value) ? value : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
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
  return {
    code: 'UNEXPECTED_ERROR',
    message: sanitizeDiagnosticMessage(error instanceof Error ? error.message : '未知错误')
  };
}

function errorCode(error: unknown): string {
  return error instanceof GatewayException ? error.gatewayError.code : 'UNEXPECTED_ERROR';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class MemoryDraftStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

interface RequestEntry {
  operation: string;
  requestId: string;
}

interface ErrorValue {
  code: string;
  subCode?: string | null;
  traceId?: string | null;
  message: string;
}

await main();
