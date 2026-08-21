import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

import { GatewayException, sanitizeDiagnosticMessage } from '../packages/core/src/index';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { atomicWriteJson } from './openapi-auth/storage';

if (existsSync('.env')) loadEnvFile('.env');
if (process.env.ONE_VEGETABLE_REAL_PRODUCT_DRAFT_VERIFY !== '1') {
  throw new Error(
    '真实草稿回读必须显式设置 ONE_VEGETABLE_REAL_PRODUCT_DRAFT_VERIFY=1；该脚本只读，不会修改商品'
  );
}

const productId = process.env.ONE_VEGETABLE_REAL_PRODUCT_DRAFT_ID?.trim() ?? '';
if (!/^\d+$/u.test(productId)) throw new Error('必须提供数字格式的 ONE_VEGETABLE_REAL_PRODUCT_DRAFT_ID');
const language = process.env.ONE_VEGETABLE_REAL_PRODUCT_DRAFT_LANGUAGE === 'zh_CN' ? 'zh_CN' : 'en_US';
const expectedText =
  process.env.ONE_VEGETABLE_REAL_PRODUCT_DRAFT_EXPECTED_TEXT ??
  '[oneVegetable-draft-smoke-20260821] API draft validation edited';
const reportPath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_REAL_PRODUCT_DRAFT_VERIFY_OUTPUT ??
    'artifacts/real-smoke/product-draft-edit-verification-20260821.json'
);
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
const requestId = randomUUID();

try {
  const draft = await gateway.request('getProductDraft', { productId, language }, { requestId });
  const expectedTextRoundTrip = draft.schemaXml.includes(expectedText);
  await atomicWriteJson(reportPath, {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    status: expectedTextRoundTrip ? 'passed' : 'contract-drift',
    requestId,
    method: 'alibaba.icbu.product.schema.render.draft',
    productId,
    language,
    expectedTextRoundTrip,
    schemaLength: draft.schemaXml.length
  });
  if (!expectedTextRoundTrip) throw new Error('草稿回读未包含预期编辑内容');
  process.stdout.write(`真实平台草稿编辑已回读确认：${productId}；报告：${reportPath}\n`);
} catch (error: unknown) {
  const gatewayError = error instanceof GatewayException ? error.gatewayError : undefined;
  await atomicWriteJson(reportPath, {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    status: 'failed',
    requestId,
    method: 'alibaba.icbu.product.schema.render.draft',
    productId,
    language,
    error: {
      code: gatewayError?.code ?? 'VERIFY_FAILED',
      traceId: gatewayError?.traceId ?? null,
      message: sanitizeDiagnosticMessage(error instanceof Error ? error.message : String(error))
    }
  });
  throw error;
}
