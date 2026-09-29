import { mkdir, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createApiApp } from '../apps/api/src/app';
import { StaticOperationFeatureFlags } from '../apps/api/src/abac';
import { AuthService } from '../apps/api/src/auth/service';
import { SqlAuthRepository } from '../apps/api/src/auth/repository';
import { SqlProductMutationJobRepository } from '../apps/api/src/product-mutations/repository';
import { applyNodeMigrations, openNodeDatabase } from '../apps/api/src/db/node-database';
import { ProductBatchMaintenanceRunner } from '../packages/core/src/product-batch-runner';
import {
  previewProductBatchMaintenance,
  productBatchTargetFingerprint
} from '../packages/core/src/product-batch-maintenance';
import { requireProductOperationContext } from '../packages/core/src/product-operation-context';
import {
  GatewayException,
  type GatewayClient,
  type OperationId,
  type RequestOf,
  type ResponseOf
} from '../packages/core/src/index';
import {
  isProductMutationJob,
  isProductMutationJobPage,
  type ProductMutationJobClient
} from '../packages/core/src/product-mutation-job-client';
import type { GalleryRequestOptions } from '../packages/core/src/gallery-transfer-context';
import { installNodeXmlDomGlobals } from './node-xml-dom';
import { atomicWriteJson } from './openapi-auth/storage';

installNodeXmlDomGlobals();
if (process.env.ONE_VEGETABLE_BATCH_SMOKE_WRITE === '1') {
  // A new isolated DB must never be used to bypass a previous unresolved real receipt.
  for (const entry of await readdir(resolve('artifacts/product-batch-maintenance'), {
    withFileTypes: true
  }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const previous: unknown = await readFile(
      resolve('artifacts/product-batch-maintenance', entry.name, 'report.json'),
      'utf8'
    )
      .then((text) => JSON.parse(text) as unknown)
      .catch(() => null);
    if (
      previous &&
      typeof previous === 'object' &&
      'stage' in previous &&
      ['change-sent', 'restore-sent', 'review-blocked'].includes(String(previous.stage))
    )
      throw new Error(
        'An earlier real receipt remains unresolved; inspect its baseline before any further smoke writes.'
      );
  }
}
const folder = resolve(
  'artifacts/product-batch-maintenance',
  new Date().toISOString().replace(/[:.]/gu, '-')
);
await mkdir(folder, { recursive: true });
const credential = createNodeAlibabaCredentialProvider({
  ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE:
    process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ?? 'artifacts/openapi-auth/credentials.json'
});
const actual = new AlibabaReadGatewayClient(credential.requireCredentials(), { maxAttempts: 1 });
const db = openNodeDatabase(resolve(folder, 'bff.sqlite'));
applyNodeMigrations(db);
// Isolated local administrator; no changes to the user's existing workbench accounts.
const bootstrapToken = randomUUID();
const authService = new AuthService({ repository: new SqlAuthRepository(db.executor), bootstrapToken });
const session = await authService.bootstrap({
  requestId: randomUUID(),
  bootstrapToken,
  username: 'batch-smoke',
  password: randomUUID()
});
const app = createApiApp({
  runtime: 'node',
  database: 'sqlite',
  environment: 'test',
  gatewayMode: 'real',
  gateway: actual,
  authService,
  featureFlags: new StaticOperationFeatureFlags(new Set(['operation:updateProduct'])),
  productMutationJobs: new SqlProductMutationJobRepository(db.executor),
  allowedOrigins: ['http://localhost']
});
const requests: { requestId: string; operation: string; ok: boolean; code?: string }[] = [];
async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
  const requestId = typeof body.requestId === 'string' ? body.requestId : randomUUID();
  const response = await app.request('/api/v1' + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Origin: 'http://localhost',
      Cookie: `ov_session=${session.sessionToken}`,
      'X-CSRF-Token': session.session.csrfToken
    },
    body: JSON.stringify({ ...body, requestId })
  });
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== 'object' ||
    !('ok' in result) ||
    !('requestId' in result) ||
    result.requestId !== requestId
  )
    throw new Error('Invalid BFF envelope');
  if (result.ok !== true) {
    const error = 'error' in result ? result.error : null;
    const code =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'BFF_ERROR';
    requests.push({
      requestId,
      operation: typeof body.operation === 'string' ? body.operation : path,
      ok: false,
      code
    });
    throw new GatewayException({ code, message: code, retryable: false });
  }
  requests.push({
    requestId,
    operation: typeof body.operation === 'string' ? body.operation : path,
    ok: true
  });
  return 'data' in result ? result.data : null;
}
const gateway: GatewayClient = {
  productOperationContext: async () =>
    requireProductOperationContext(await post('/product-mutation-jobs/context/get', {})),
  request: async <K extends OperationId>(
    operation: K,
    payload: RequestOf<K>,
    options?: GalleryRequestOptions
  ): Promise<ResponseOf<K>> =>
    (await post('/operations/call', { operation, payload: payload ?? {}, ...options })) as ResponseOf<K>
};
const jobs: ProductMutationJobClient = {
  list: async (input = {}) => {
    const value = await post('/product-mutation-jobs/list', { ...input });
    if (!isProductMutationJobPage(value)) throw new Error('Invalid jobs');
    return value;
  },
  get: async (id) => {
    const value = await post('/product-mutation-jobs/get', { id });
    if (!isProductMutationJob(value)) throw new Error('Invalid job');
    return value;
  },
  refresh: async (id, revision) => {
    const value = await post('/product-mutation-jobs/refresh', { id, revision });
    if (!isProductMutationJob(value)) throw new Error('Invalid job');
    return value;
  },
  recover: () => Promise.reject(new Error('Automatic recovery forbidden'))
};
let stage = 'read-only';
let activeRunner: ProductBatchMaintenanceRunner | null = null;
function stopOnReview(): void {
  if (activeRunner?.items.some((item) => item.job?.reasonCode?.includes('PRODUCT_IN_AUDITING'))) {
    stage = 'review-blocked';
    activeRunner.stop();
  }
}
try {
  const productId = process.env.ONE_VEGETABLE_BATCH_SMOKE_PRODUCT_ID;
  const products = await gateway.request('listProducts', {
    page: 1,
    pageSize: 30,
    language: 'en_US',
    ...(productId ? { productId } : {})
  });
  await new Promise((resolve) => setTimeout(resolve, 350));
  const groups = await gateway.request('listProductGroups', {});
  const candidates = [];
  for (const product of products.items
    .filter(
      (p) =>
        !p.subject.toLowerCase().includes('dont-edit') &&
        p.categoryId &&
        ['online', 'offline'].includes(p.status)
    )
    .slice(0, productId ? 1 : 4)) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    const xml = (
      await gateway.request('renderProductSchema', {
        productId: product.id,
        categoryId: product.categoryId ?? 0,
        language: 'en_US'
      })
    ).xml;
    const initial = await previewProductBatchMaintenance(xml, {
      groupPath: [{ id: groups[0]?.id ?? 1, name: '' }],
      keywords: { action: 'remove', values: ['onevegetable-readonly-probe-not-a-keyword'] }
    });
    candidates.push({
      id: product.id,
      categoryId: product.categoryId,
      status: product.status,
      preview: initial.status,
      reason: initial.reason,
      groups: initial.before.groups,
      keywords: initial.before.keywords
    });
    if (process.env.ONE_VEGETABLE_BATCH_SMOKE_WRITE !== '1') continue;
    if (!productId || products.items.length !== 1)
      throw new Error('Exactly one explicit product is required');
    if (
      initial.status === 'unsupported' ||
      initial.before.groups.length !== 1 ||
      !initial.before.keywords.length ||
      initial.before.keywords.some((v) => v !== v.trim()) ||
      new Set(initial.before.keywords.map((v) => v.toLowerCase())).size !== initial.before.keywords.length
    )
      throw new Error('No safely reversible baseline');
    const originalGroup = groups.find((g) => String(g.id) === initial.before.groups[0]);
    const targetGroup = groups.find(
      (g) => String(g.id) !== initial.before.groups[0] && g.id > 0 && /test/iu.test(g.name)
    );
    if (!originalGroup || !targetGroup)
      throw new Error('Need two existing root groups; no guessed parent path');
    const baseline = {
      productId,
      categoryId: product.categoryId,
      rootIds: initial.rootIds,
      fingerprint: initial.baseline,
      groups: initial.before.groups,
      keywords: initial.before.keywords
    };
    await atomicWriteJson(resolve(folder, 'baseline.json'), baseline);
    const target = {
      groupPath: [{ id: targetGroup.id, name: targetGroup.name }],
      keywords: { action: 'replace' as const, values: [...initial.before.keywords].reverse() }
    };
    if (target.keywords.values.length === 1)
      target.keywords.values = [(initial.before.keywords[0] ?? '') + ' test'];
    const changed = new ProductBatchMaintenanceRunner({
      gateway,
      jobs,
      products: [product],
      language: 'en_US',
      changed: stopOnReview
    });
    activeRunner = changed;
    await changed.preview(target);
    if (changed.items[0]?.state !== 'ready' || changed.items[0].preview?.baseline !== baseline.fingerprint)
      throw new Error('Baseline conflict');
    stage = 'change-sent';
    await atomicWriteJson(resolve(folder, 'report.json'), { stage, requests });
    await changed.execute();
    if (!changed.items.every((item) => item.state === 'verified'))
      throw new Error('Change not verified; stop without blind compensation');
    const restore = new ProductBatchMaintenanceRunner({
      gateway,
      jobs,
      products: [product],
      language: 'en_US',
      changed: stopOnReview
    });
    activeRunner = restore;
    await restore.preview({
      groupPath: [{ id: originalGroup.id, name: originalGroup.name }],
      keywords: { action: 'replace', values: baseline.keywords }
    });
    const restoredPreview = restore.items[0]?.preview;
    if (
      restore.items[0]?.state !== 'ready' ||
      JSON.stringify(restoredPreview?.before.keywords) !== JSON.stringify(target.keywords.values) ||
      restoredPreview?.before.groups[0] !== String(targetGroup.id)
    )
      throw new Error('Concurrent change; stop before recovery');
    stage = 'restore-sent';
    await atomicWriteJson(resolve(folder, 'report.json'), { stage, requests });
    await restore.execute();
    if (!restore.items.every((item) => item.state === 'verified'))
      throw new Error('Restore not verified; keep receipt');
    await new Promise((resolve) => setTimeout(resolve, 350));
    const restored = await gateway.request('renderProductSchema', {
      productId,
      categoryId: product.categoryId ?? 0,
      language: 'en_US'
    });
    if ((await productBatchTargetFingerprint(restored.xml, baseline.rootIds)) !== baseline.fingerprint)
      throw new Error('Baseline fingerprint differs');
    stage = 'restored';
  }
  await atomicWriteJson(resolve(folder, 'report.json'), {
    stage,
    requests,
    candidates,
    receipts: (await jobs.list({ pageSize: 100 })).items,
    groups: groups.map((g) => ({ id: g.id, name: g.name }))
  });
  console.log(
    JSON.stringify({
      stage,
      report: resolve(folder, 'report.json'),
      candidates: candidates.map(({ id, status, preview, reason }) => ({ id, status, preview, reason }))
    })
  );
} catch (error) {
  await atomicWriteJson(resolve(folder, 'report.json'), {
    stage,
    requests,
    receipts: (await new SqlProductMutationJobRepository(db.executor).list({ page: 1, pageSize: 100 })).items,
    error:
      error instanceof GatewayException
        ? error.gatewayError.code
        : error instanceof Error
          ? error.message
          : 'UNKNOWN'
  });
  console.log(
    JSON.stringify({
      stage,
      report: resolve(folder, 'report.json'),
      error:
        error instanceof GatewayException
          ? error.gatewayError.code
          : error instanceof Error
            ? error.message
            : 'UNKNOWN'
    })
  );
  process.exitCode = 1;
} finally {
  db.connection.close();
}
