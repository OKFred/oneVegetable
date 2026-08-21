import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

import {
  GatewayException,
  inspectProductSchemaSerialization,
  isProductSchemaImageField,
  markProductSchemaFieldTouched,
  parseProductSchemaXml,
  sanitizeDiagnosticMessage,
  withProductSchemaFieldText,
  type ProductSchemaField,
  type ProductSchemaModel,
  type RequestOf,
  type ResponseOf
} from '../packages/core/src/index';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { atomicWriteJson } from './openapi-auth/storage';

const CATEGORY_ID = 201712702;
const LANGUAGE = 'en_US' as const;
const TITLE_MARKER = '[oneVegetable-draft-smoke-20260821]';

if (existsSync('.env')) loadEnvFile('.env');
if (process.env.ONE_VEGETABLE_REAL_PRODUCT_DRAFT_SMOKE !== '1') {
  throw new Error(
    '真实商品草稿 Smoke 必须显式设置 ONE_VEGETABLE_REAL_PRODUCT_DRAFT_SMOKE=1；该操作会创建一条平台草稿'
  );
}

const reportPath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_REAL_PRODUCT_DRAFT_OUTPUT ?? 'artifacts/real-smoke/product-draft-20260821.json'
);
await assertNoPreviousMutationAttempt(reportPath);

const credentialFile = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ??
    process.env.OPEN_API_OUTPUT ??
    'artifacts/openapi-auth/credentials.json'
);
const credentialProvider = createNodeAlibabaCredentialProvider(
  {
    ...process.env,
    ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: credentialFile
  },
  { workingDirectory: process.cwd() }
);
const gateway = new AlibabaReadGatewayClient(credentialProvider.requireCredentials(), { maxAttempts: 1 });
type SmokeOperation = 'getProductSchema' | 'listPhotos' | 'saveProductDraft' | 'getProductDraft';
const OPERATION_METHODS: Record<SmokeOperation, string> = {
  getProductSchema: 'alibaba.icbu.product.schema.get',
  listPhotos: 'alibaba.icbu.photobank.list',
  saveProductDraft: 'alibaba.icbu.product.schema.add.draft',
  getProductDraft: 'alibaba.icbu.product.schema.render.draft'
};
const requests: { operation: SmokeOperation; requestId: string }[] = [];

try {
  const schema = await call('getProductSchema', {
    categoryId: CATEGORY_ID,
    language: LANGUAGE,
    market: 'wholesale'
  });
  const photos = await call('listPhotos', { page: 1, pageSize: 100, groupId: '-1' });
  const photo = photos.items.find((item) => item.id.trim() !== '' && item.url.startsWith('https://'));
  if (!photo) throw new Error('真实图库中没有可用于草稿 Smoke 的 HTTPS 素材');

  let model = parseProductSchemaXml(schema.xml);
  model = updateRankedField(model, titleFieldRank, (field) =>
    withProductSchemaFieldText(field, `${TITLE_MARKER} API draft validation`)
  );
  model = updateRankedField(model, imageFieldRank, (field) => ({
    ...field,
    values: [
      {
        text: photo.url,
        attributes: { fileId: photo.id },
        metadata: {
          fileName: photo.name,
          groupId: photo.groupId,
          ...(photo.width === null ? {} : { width: String(photo.width) }),
          ...(photo.height === null ? {} : { height: String(photo.height) }),
          fileSize: String(photo.fileSize),
          referenceCount: String(photo.referenceCount),
          modifiedAt: photo.modifiedAt
        }
      }
    ]
  }));
  const inspection = inspectProductSchemaSerialization(model);
  if (!inspection.safe) {
    throw new Error(`草稿 Schema 序列化结构异常：${inspection.structuralDiffs.join('；')}`);
  }

  await writeReport('mutation-started', {
    mutationAttempted: true,
    photoFileId: photo.id,
    changedFieldCount: inspection.changedFieldKeys.length
  });
  const created = await call('saveProductDraft', {
    categoryId: CATEGORY_ID,
    language: LANGUAGE,
    schemaXml: inspection.xml
  });

  let rendered;
  try {
    rendered = await call('getProductDraft', { productId: created.productId, language: LANGUAGE });
  } catch (error: unknown) {
    await writeReport('created-unverified', {
      mutationAttempted: true,
      productId: created.productId,
      traceId: created.traceId,
      error: errorRecord(error)
    });
    throw new Error(`平台草稿 ${created.productId} 已创建，但 schema.render.draft 回读失败；禁止重试创建`, {
      cause: error
    });
  }

  const titleRoundTrip = rendered.schemaXml.includes(TITLE_MARKER);
  const imageRoundTrip = rendered.schemaXml.includes(photo.id) || rendered.schemaXml.includes(photo.url);
  if (!titleRoundTrip || !imageRoundTrip) {
    await writeReport('created-contract-drift', {
      mutationAttempted: true,
      productId: created.productId,
      traceId: created.traceId,
      titleRoundTrip,
      imageRoundTrip
    });
    throw new Error(`平台草稿 ${created.productId} 已创建，但回读内容与请求不一致；禁止重试创建`);
  }

  await writeReport('passed', {
    mutationAttempted: true,
    productId: created.productId,
    traceId: created.traceId,
    titleRoundTrip,
    imageRoundTrip,
    prohibitedMethodsCalled: false
  });
  process.stdout.write(`真实平台草稿已创建并回读：${created.productId}；报告：${reportPath}\n`);
} catch (error: unknown) {
  const previous = await readReportStatus(reportPath);
  if (previous !== 'created-unverified' && previous !== 'created-contract-drift') {
    await writeReport(previous === 'mutation-started' ? 'mutation-failed' : 'preflight-failed', {
      mutationAttempted: previous === 'mutation-started',
      error: errorRecord(error)
    });
  }
  throw error;
}

async function call<K extends SmokeOperation>(operation: K, payload: RequestOf<K>): Promise<ResponseOf<K>> {
  const requestId = randomUUID();
  requests.push({ operation, requestId });
  return gateway.request(operation, payload, { requestId });
}

function updateRankedField(
  model: ProductSchemaModel,
  rank: (field: ProductSchemaField) => number,
  update: (field: ProductSchemaField) => ProductSchemaField
): ProductSchemaModel {
  const candidates = model.fields.flatMap((field, rootIndex) =>
    flattenFields(field).map((nested) => ({ rootIndex, field: nested, rank: rank(nested) }))
  );
  const selected = candidates
    .filter((candidate) => Number.isFinite(candidate.rank))
    .toSorted((left, right) => left.rank - right.rank || left.field.sourceIndex - right.field.sourceIndex)[0];
  if (!selected) throw new Error('商品 Schema 中没有找到 Smoke 所需字段');
  const root = model.fields[selected.rootIndex];
  if (!root) throw new Error('商品 Schema 字段索引无效');
  const updatedRoot = replaceField(root, selected.field.key, update);
  return markProductSchemaFieldTouched(
    {
      ...model,
      fields: model.fields.map((field, index) => (index === selected.rootIndex ? updatedRoot : field))
    },
    root.key
  );
}

function flattenFields(field: ProductSchemaField): ProductSchemaField[] {
  return [
    field,
    ...field.children.flatMap(flattenFields),
    ...field.instances.flatMap((instance) => instance.fields.flatMap(flattenFields))
  ];
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

function titleFieldRank(field: ProductSchemaField): number {
  const id = field.id.toLocaleLowerCase();
  if (['subject', 'productsubject', 'producttitle'].includes(id)) return 0;
  if (/product.*title|title.*product/.test(id)) return 1;
  if (/product title|商品标题|商品名称/i.test(field.name)) return 2;
  return Number.POSITIVE_INFINITY;
}

function imageFieldRank(field: ProductSchemaField): number {
  const id = field.id.toLocaleLowerCase();
  if (id === 'scimages') return 0;
  if (/main.*image|image.*main|product.*image/.test(id)) return 1;
  if (isProductSchemaImageField(field)) return 2;
  return Number.POSITIVE_INFINITY;
}

async function assertNoPreviousMutationAttempt(path: string): Promise<void> {
  const status = await readReportStatus(path);
  if (
    status === 'mutation-started' ||
    status === 'mutation-failed' ||
    status === 'created-unverified' ||
    status === 'created-contract-drift' ||
    status === 'passed'
  ) {
    throw new Error(`真实草稿 Smoke 已存在 ${status} 记录；为避免重复草稿，本脚本拒绝再次执行`);
  }
}

async function readReportStatus(path: string): Promise<string | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return isRecord(value) && typeof value.status === 'string' ? value.status : null;
  } catch {
    return null;
  }
}

async function writeReport(status: string, detail: Record<string, unknown>): Promise<void> {
  await atomicWriteJson(reportPath, {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    status,
    categoryId: CATEGORY_ID,
    language: LANGUAGE,
    titleMarker: TITLE_MARKER,
    requests,
    calledMethods: requests.map(({ operation }) => OPERATION_METHODS[operation]),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
