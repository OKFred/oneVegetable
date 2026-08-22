import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

import { sanitizeDiagnosticMessage } from '../packages/core/src/index';
import { applyNodeMigrations, openNodeDatabase } from '../apps/api/src/db/node-database';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { SqlProductMutationJobRepository } from '../apps/api/src/product-mutations/repository';
import {
  ProductMutationLifecycleService,
  type ProductMutationGateway
} from '../apps/api/src/product-mutations/service';
import { atomicWriteJson } from './openapi-auth/storage';

import type {
  OperationId,
  Product,
  ProductDisplayRequest,
  ProductMutationJob,
  RequestOf,
  ResponseOf
} from '../packages/core/src/index';
import type { AuthPrincipal } from '../apps/api/src/auth/types';

const DEFAULT_PRODUCT_ID = '1601928079741';
const DEFAULT_ENCRYPTED_ID = 'AAEz7fWKAJllV4DtZ4FKW45E';
const DEFAULT_SUBJECT =
  'Famous Brand Cheap Price Women Genuine Leather Water Resistant Tote Bags Customized Color & Logo LTB-0161 20260819-1';
const ACTOR: AuthPrincipal = {
  actorId: 'system:maintenance',
  username: 'product-display-smoke',
  role: 'admin',
  source: 'bff'
};

if (existsSync('.env')) loadEnvFile('.env');
if (process.env.ONE_VEGETABLE_REAL_PRODUCT_DISPLAY_SMOKE !== '1') {
  throw new Error(
    '真实商品上下架 Smoke 必须显式设置 ONE_VEGETABLE_REAL_PRODUCT_DISPLAY_SMOKE=1；该操作会短暂下架并恢复一个指定商品'
  );
}

const productId = nonEmpty(process.env.ONE_VEGETABLE_REAL_PRODUCT_ID) ?? DEFAULT_PRODUCT_ID;
const encryptedProductId =
  nonEmpty(process.env.ONE_VEGETABLE_REAL_PRODUCT_ENCRYPTED_ID) ?? DEFAULT_ENCRYPTED_ID;
const expectedSubject = nonEmpty(process.env.ONE_VEGETABLE_REAL_PRODUCT_SUBJECT) ?? DEFAULT_SUBJECT;
const reportPath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_REAL_PRODUCT_DISPLAY_OUTPUT ??
    'artifacts/real-smoke/product-display-lifecycle.json'
);
const databasePath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_REAL_PRODUCT_DISPLAY_DATABASE ??
    'artifacts/real-smoke/product-display-lifecycle.sqlite'
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
const database = openNodeDatabase(databasePath);
applyNodeMigrations(database);
const repository = new SqlProductMutationJobRepository(database.executor);
const requests: { operation: OperationId; requestId: string }[] = [];
const lifecycleGateway: ProductMutationGateway = {
  update: (request, requestId) => trackedRequest('updateProduct', request, requestId),
  render: (request, requestId) => trackedRequest('renderProductSchema', request, requestId),
  updateDisplay: (request, requestId) => trackedRequest('updateProductDisplay', request, requestId),
  list: (request, requestId) => trackedRequest('listProducts', request, requestId)
};
const lifecycle = new ProductMutationLifecycleService(repository, lifecycleGateway);
let activeJob: ProductMutationJob | null = null;
let displayNeedsRecovery = false;

try {
  const previous = readPreviousState();
  if (previous?.displayNeedsRecovery === true) {
    activeJob = previous.activeJobId ? await repository.get(previous.activeJobId) : null;
    displayNeedsRecovery = true;
    await recoverOnlineBaseline();
    await writeReport('recovered-after-interrupted-run');
    process.stdout.write(`检测到中断状态，已优先恢复商品上架；报告：${reportPath}\n`);
  } else {
    const baseline = await requireTargetProduct();
    if (baseline.status !== 'online') {
      throw new Error(`目标商品当前状态为 ${baseline.status}，预期为 online，拒绝开始 Smoke`);
    }

    displayNeedsRecovery = true;
    await writeReport('armed-before-offline');
    activeJob = await submitDisplay('offline');
    await writeReport('offline-submitted');
    activeJob = await waitForJob(activeJob, 'verified');
    await writeReport('offline-verified');

    activeJob = await submitDisplay('online');
    await writeReport('online-submitted');
    activeJob = await waitForJob(activeJob, 'verified');
    await requireDisplay('online');
    displayNeedsRecovery = false;
    await writeReport('passed');
    process.stdout.write(`真实商品上下架生命周期 Smoke 通过，商品已恢复上架；报告：${reportPath}\n`);
  }
} catch (error: unknown) {
  const recoveryErrors: string[] = [];
  try {
    await recoverOnlineBaseline();
  } catch (recoveryError: unknown) {
    recoveryErrors.push(safeMessage(recoveryError));
  }
  await writeReport(recoveryErrors.length === 0 ? 'failed-recovered' : 'failed-recovery-required', {
    error: safeMessage(error),
    recoveryErrors
  });
  throw new Error(`真实商品上下架生命周期 Smoke 失败；报告：${reportPath}`, { cause: error });
} finally {
  database.connection.close();
}

async function submitDisplay(display: 'online' | 'offline'): Promise<ProductMutationJob> {
  const result = await lifecycle.submitDisplay({
    requestId: randomUUID(),
    actor: ACTOR,
    request: displayRequest(display)
  });
  const job = result.jobs[0];
  if (!job || result.jobs.length !== 1) throw new Error('上下架 Smoke 未得到唯一持久任务');
  return job;
}

async function waitForJob(
  initial: ProductMutationJob,
  expected: 'verified' | 'recovered'
): Promise<ProductMutationJob> {
  let current = initial;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (current.status === expected) return current;
    if (current.status === 'failed' || current.status === 'recovery-required') {
      throw new Error(`商品上下架任务进入 ${current.status}：${current.reasonCode ?? 'UNKNOWN'}`);
    }
    await delay(2_000);
    current = await lifecycle.refresh({
      requestId: randomUUID(),
      actor: ACTOR,
      id: current.id,
      expectedRevision: current.revision
    });
  }
  throw new Error(`商品上下架任务未在限定时间内进入 ${expected}`);
}

async function recoverOnlineBaseline(): Promise<void> {
  const current = await requireTargetProduct();
  if (current.status === 'online') {
    displayNeedsRecovery = false;
    return;
  }
  if (
    activeJob?.operation === 'updateProductDisplay' &&
    activeJob.originalDisplay === 'online' &&
    ['submitted', 'verifying', 'recovery-required'].includes(activeJob.status)
  ) {
    activeJob = await lifecycle.recover({
      requestId: randomUUID(),
      actor: ACTOR,
      id: activeJob.id,
      expectedRevision: activeJob.revision
    });
    activeJob = await waitForJob(activeJob, 'recovered');
  } else {
    await trackedRequest('updateProductDisplay', displayRequest('online'), randomUUID());
    await requireDisplay('online');
  }
  displayNeedsRecovery = false;
}

async function requireDisplay(display: 'online' | 'offline'): Promise<Product> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const product = await requireTargetProduct();
    if (product.status === display) return product;
    await delay(2_000);
  }
  throw new Error(`目标商品未在限定时间内恢复为 ${display}`);
}

async function requireTargetProduct(): Promise<Product> {
  const page = await trackedRequest(
    'listProducts',
    { page: 1, pageSize: 100, subject: expectedSubject, language: 'en_US' },
    randomUUID()
  );
  const product = page.items.find((item) => item.id === productId && item.subject === expectedSubject);
  if (product?.encryptedId !== encryptedProductId) {
    throw new Error('目标商品标题、明文 ID 或混淆 ID 与预期不一致，拒绝执行写入');
  }
  return product;
}

function displayRequest(display: 'online' | 'offline'): ProductDisplayRequest {
  return { productIds: [productId], encryptedProductIds: [encryptedProductId], display };
}

async function trackedRequest<K extends OperationId>(
  operation: K,
  payload: RequestOf<K>,
  requestId: string
): Promise<ResponseOf<K>> {
  requests.push({ operation, requestId });
  return gateway.request(operation, payload, { requestId });
}

function readPreviousState(): { displayNeedsRecovery: boolean; activeJobId: string | null } | null {
  if (!existsSync(reportPath)) return null;
  try {
    const value = JSON.parse(readFileSync(reportPath, 'utf8')) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    return {
      displayNeedsRecovery: record.displayNeedsRecovery === true,
      activeJobId: typeof record.activeJobId === 'string' ? record.activeJobId : null
    };
  } catch {
    return null;
  }
}

async function writeReport(status: string, detail: Record<string, unknown> = {}): Promise<void> {
  await atomicWriteJson(reportPath, {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    status,
    productId,
    baselineDisplay: 'online',
    displayNeedsRecovery,
    activeJobId: activeJob?.id ?? null,
    activeJobStatus: activeJob?.status ?? null,
    requests,
    ...detail
  });
}

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized === '' ? null : normalized;
}

function safeMessage(error: unknown): string {
  return sanitizeDiagnosticMessage(error instanceof Error ? error.message : '未知错误');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
