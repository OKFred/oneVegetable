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
  type ProductSchemaField,
  type ProductSchemaModel
} from '../packages/core/src/index';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { atomicWriteJson } from './openapi-auth/storage';
import { installNodeXmlDomGlobals } from './node-xml-dom';

const PRODUCT_ID = '1601928079741';
const CATEGORY_ID = 201712702;
const LANGUAGE = 'en_US' as const;
const ORIGINAL_TITLE =
  'Famous Brand Cheap Price Women Genuine Leather Water Resistant Tote Bags Customized Color & Logo LTB-0161 20260819-1';
const reportPath = resolve(process.cwd(), 'artifacts/real-smoke/product-mutations-recovery-20260822.json');

installNodeXmlDomGlobals();
if (existsSync('.env')) loadEnvFile('.env');
if (process.env.ONE_VEGETABLE_REAL_PRODUCT_RECOVERY !== '1') {
  throw new Error('商品标题恢复必须显式设置 ONE_VEGETABLE_REAL_PRODUCT_RECOVERY=1');
}

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
const requestIds: string[] = [];

for (let attempt = 1; attempt <= 80; attempt += 1) {
  try {
    const rendered = await gateway.request(
      'renderProductSchema',
      { productId: PRODUCT_ID, categoryId: CATEGORY_ID, language: LANGUAGE },
      { requestId: nextRequestId() }
    );
    const model = parseProductSchemaXml(rendered.xml);
    const title = findTitleField(model);
    const currentTitle = productSchemaFieldText(title.field);
    if (currentTitle !== ORIGINAL_TITLE) {
      const inspection = inspectProductSchemaPatchSerialization(
        markProductSchemaFieldTouched(
          {
            ...model,
            fields: model.fields.map((field) => replaceField(field, title.field.key, ORIGINAL_TITLE))
          },
          title.rootKey
        )
      );
      if (!inspection.safe || inspection.noOp || inspection.changedFieldKeys.length !== 1) {
        throw new Error(`无法生成安全的标题恢复补丁：${inspection.structuralDiffs.join('；')}`);
      }
      await gateway.request(
        'updateProduct',
        {
          productId: PRODUCT_ID,
          categoryId: CATEGORY_ID,
          language: LANGUAGE,
          schemaPatchXml: inspection.xml
        },
        { requestId: nextRequestId() }
      );
    }
    await atomicWriteJson(reportPath, {
      schemaVersion: 1,
      capturedAtUtc: new Date().toISOString(),
      status: currentTitle === ORIGINAL_TITLE ? 'already-recovered' : 'recovery-submitted',
      productId: PRODUCT_ID,
      attempts: attempt,
      requestIds
    });
    process.stdout.write(
      `商品标题恢复${currentTitle === ORIGINAL_TITLE ? '已确认' : '请求已提交'}；报告：${reportPath}\n`
    );
    break;
  } catch (error: unknown) {
    if (isAuditing(error) && attempt < 80) {
      if (attempt % 4 === 0) process.stdout.write(`商品仍在审核，已等待 ${attempt * 15} 秒…\n`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 15_000));
      continue;
    }
    await atomicWriteJson(reportPath, {
      schemaVersion: 1,
      capturedAtUtc: new Date().toISOString(),
      status: 'recovery-failed',
      productId: PRODUCT_ID,
      attempts: attempt,
      requestIds,
      error: sanitizeDiagnosticMessage(error instanceof Error ? error.message : '未知错误')
    });
    throw error;
  }
}

function nextRequestId(): string {
  const requestId = randomUUID();
  requestIds.push(requestId);
  return requestId;
}

function isAuditing(error: unknown): boolean {
  return (
    error instanceof GatewayException &&
    (error.gatewayError.code.includes('PUB_BIZCHECK_PRODUCT_IN_AUDITING') ||
      error.gatewayError.message.includes('currently under review'))
  );
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
