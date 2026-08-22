import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

import {
  GatewayException,
  inspectProductSchemaPatchSerialization,
  markProductSchemaFieldTouched,
  parseProductSchemaXml,
  productSchemaFieldText,
  sanitizeDiagnosticMessage,
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

const DEFAULT_PRODUCT_ID = '1601928079741';
const DEFAULT_CATEGORY_ID = 201712702;
const DEFAULT_ENCRYPTED_ID = 'AAEz7fWKAJllV4DtZ4FKW45E';
const DEFAULT_SUBJECT =
  'Famous Brand Cheap Price Women Genuine Leather Water Resistant Tote Bags Customized Color & Logo LTB-0161 20260819-1';
const LANGUAGE = 'en_US' as const;
const MARKER = '[OV-SMOKE-20260822]';

installNodeXmlDomGlobals();
if (existsSync('.env')) loadEnvFile('.env');
if (process.env.ONE_VEGETABLE_REAL_PRODUCT_MUTATION_SMOKE !== '1') {
  throw new Error(
    '真实商品写入 Smoke 必须显式设置 ONE_VEGETABLE_REAL_PRODUCT_MUTATION_SMOKE=1；该操作会短暂修改并恢复商品标题和上下架状态'
  );
}

const productId = nonEmpty(process.env.ONE_VEGETABLE_REAL_PRODUCT_ID) ?? DEFAULT_PRODUCT_ID;
const categoryId = Number(process.env.ONE_VEGETABLE_REAL_PRODUCT_CATEGORY_ID ?? DEFAULT_CATEGORY_ID);
const encryptedProductId =
  nonEmpty(process.env.ONE_VEGETABLE_REAL_PRODUCT_ENCRYPTED_ID) ?? DEFAULT_ENCRYPTED_ID;
const expectedSubject = nonEmpty(process.env.ONE_VEGETABLE_REAL_PRODUCT_SUBJECT) ?? DEFAULT_SUBJECT;
const reportPath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_REAL_PRODUCT_MUTATION_OUTPUT ??
    'artifacts/real-smoke/product-mutations-20260822.json'
);

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
const requests: { operation: OperationId; requestId: string }[] = [];
let titleNeedsRecovery = false;
let displayNeedsRecovery = false;
let originalTitle = '';

try {
  const target = await requireTargetProduct();
  if (target.encryptedId !== encryptedProductId) {
    throw new Error('目标商品加密 ID 与预期不一致，拒绝执行写入');
  }
  if (target.status !== 'online') throw new Error(`目标商品当前状态为 ${target.status}，预期为 online`);

  const rendered = await call('renderProductSchema', { productId, categoryId, language: LANGUAGE });
  const originalModel = parseProductSchemaXml(rendered.xml);
  const title = findTitleField(originalModel);
  originalTitle = productSchemaFieldText(title.field);
  if (originalTitle !== expectedSubject) throw new Error('Schema 标题与预期标题不一致，拒绝执行写入');

  const temporaryTitle = createTemporaryTitle(originalTitle);
  const temporaryPatch = createTitlePatch(originalModel, title.field.key, title.rootKey, temporaryTitle);
  await writeReport('title-update-started', { titleNeedsRecovery: true, displayNeedsRecovery: false });
  titleNeedsRecovery = true;
  await call('updateProduct', {
    productId,
    categoryId,
    language: LANGUAGE,
    schemaPatchXml: temporaryPatch
  });
  await waitForTitle(temporaryTitle);

  const temporaryModel = parseProductSchemaXml(
    (await call('renderProductSchema', { productId, categoryId, language: LANGUAGE })).xml
  );
  const temporaryField = findTitleField(temporaryModel);
  const restorePatch = createTitlePatch(
    temporaryModel,
    temporaryField.field.key,
    temporaryField.rootKey,
    originalTitle
  );
  await call('updateProduct', {
    productId,
    categoryId,
    language: LANGUAGE,
    schemaPatchXml: restorePatch
  });
  await waitForTitle(originalTitle);
  titleNeedsRecovery = false;

  await writeReport('display-off-started', { titleNeedsRecovery: false, displayNeedsRecovery: true });
  displayNeedsRecovery = true;
  await call('updateProductDisplay', {
    productIds: [productId],
    encryptedProductIds: [encryptedProductId],
    display: 'offline'
  });
  await waitForDisplay('offline');
  await call('updateProductDisplay', {
    productIds: [productId],
    encryptedProductIds: [encryptedProductId],
    display: 'online'
  });
  await waitForDisplay('online');
  displayNeedsRecovery = false;

  await writeReport('passed', {
    titleNeedsRecovery: false,
    displayNeedsRecovery: false,
    titleRoundTrip: true,
    displayRoundTrip: true
  });
  process.stdout.write(`真实商品增量更新与上下架 Smoke 通过，商品已恢复原状；报告：${reportPath}\n`);
} catch (error: unknown) {
  const recoveryErrors: string[] = [];
  if (titleNeedsRecovery && originalTitle) {
    try {
      await recoverTitle(originalTitle);
      titleNeedsRecovery = false;
    } catch (recoveryError: unknown) {
      recoveryErrors.push(`标题恢复失败：${safeMessage(recoveryError)}`);
    }
  }
  if (displayNeedsRecovery) {
    try {
      await call('updateProductDisplay', {
        productIds: [productId],
        encryptedProductIds: [encryptedProductId],
        display: 'online'
      });
      await waitForDisplay('online');
      displayNeedsRecovery = false;
    } catch (recoveryError: unknown) {
      recoveryErrors.push(`上架状态恢复失败：${safeMessage(recoveryError)}`);
    }
  }
  await writeReport(recoveryErrors.length === 0 ? 'failed-recovered' : 'failed-recovery-required', {
    titleNeedsRecovery,
    displayNeedsRecovery,
    error: errorRecord(error),
    recoveryErrors
  });
  throw new Error(`真实商品写入 Smoke 失败；报告：${reportPath}`, { cause: error });
}

async function call<K extends OperationId>(operation: K, payload: RequestOf<K>): Promise<ResponseOf<K>> {
  const requestId = randomUUID();
  requests.push({ operation, requestId });
  return gateway.request(operation, payload, { requestId });
}

async function requireTargetProduct(): Promise<Product> {
  const page = await call('listProducts', {
    page: 1,
    pageSize: 100,
    subject: expectedSubject,
    language: LANGUAGE
  });
  const target = page.items.find((item) => item.id === productId);
  if (!target) throw new Error('按精确标题查询后未找到目标商品，拒绝执行写入');
  return target;
}

async function waitForTitle(expected: string): Promise<void> {
  await poll(
    async () => {
      const rendered = await call('renderProductSchema', { productId, categoryId, language: LANGUAGE });
      return productSchemaFieldText(findTitleField(parseProductSchemaXml(rendered.xml)).field) === expected;
    },
    `商品标题未在限定时间内回读为 ${expected === originalTitle ? '原值' : 'Smoke 标记值'}`
  );
}

async function waitForDisplay(expected: 'online' | 'offline'): Promise<void> {
  await poll(async () => (await requireTargetProduct()).status === expected, `商品状态未回读为 ${expected}`);
}

async function poll(check: () => Promise<boolean>, message: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await check()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500));
  }
  throw new Error(message);
}

async function recoverTitle(expected: string): Promise<void> {
  const rendered = await call('renderProductSchema', { productId, categoryId, language: LANGUAGE });
  const model = parseProductSchemaXml(rendered.xml);
  const title = findTitleField(model);
  if (productSchemaFieldText(title.field) === expected) return;
  await call('updateProduct', {
    productId,
    categoryId,
    language: LANGUAGE,
    schemaPatchXml: createTitlePatch(model, title.field.key, title.rootKey, expected)
  });
  await waitForTitle(expected);
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

function findTitleField(model: ProductSchemaModel): {
  field: ProductSchemaField;
  rootKey: string;
} {
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

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized === '' ? null : normalized;
}

async function writeReport(status: string, detail: Record<string, unknown>): Promise<void> {
  await atomicWriteJson(reportPath, {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    status,
    productId,
    categoryId,
    language: LANGUAGE,
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

function safeMessage(error: unknown): string {
  return sanitizeDiagnosticMessage(error instanceof Error ? error.message : '未知错误');
}
