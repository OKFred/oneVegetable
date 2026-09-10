import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { GatewayException } from '../packages/core/src/index';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { atomicWriteJson } from './openapi-auth/storage';
import { assessStockRead, responseShape, STOCK_SHOWCASE_METHODS } from './lib/product-stock-smoke';

if (process.env.ONE_VEGETABLE_STOCK_SMOKE !== '1') throw new Error('Explicit opt-in required');
const provider = createNodeAlibabaCredentialProvider({
  ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: resolve(
    process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ?? 'artifacts/openapi-auth/credentials.json'
  )
});
const gateway = new AlibabaReadGatewayClient(provider.requireCredentials(), { maxAttempts: 1 });
const runId = randomUUID();
const output = resolve(`artifacts/product-stock-showcase-real/${runId}.json`);
const reports: Record<string, unknown>[] = [];
let product: { id: string; categoryId: number | null } | undefined;
const errorSummary = (error: unknown) => {
  const e = error instanceof GatewayException ? error.gatewayError : null;
  return {
    status:
      e?.code === '11' || /permission|auth/i.test(e?.subCode ?? '') ? 'permission-denied' : 'provider-error',
    reasonCode: e?.subCode ?? e?.code ?? 'LOCAL_ERROR'
  };
};
const persist = () =>
  atomicWriteJson(output, {
    runId,
    capturedAtUtc: new Date().toISOString(),
    sessionSent: true,
    maxAttempts: 1,
    reports
  });
const requestId = randomUUID();
try {
  const list = await gateway.request(
    'listProducts',
    { page: 1, pageSize: 20, language: 'en_US' },
    { requestId }
  );
  product = list.items.find((item) => /^[1-9][0-9]*$/.test(item.id));
  reports.push({
    method: 'alibaba.icbu.product.list',
    requestId,
    status: product ? 'passed' : 'no-data',
    recordCount: list.items.length
  });
} catch (error: unknown) {
  reports.push({ method: 'alibaba.icbu.product.list', requestId, ...errorSummary(error) });
}
await persist();
for (const method of STOCK_SHOWCASE_METHODS) {
  await setTimeout(350);
  const requestId = randomUUID();
  if (method.endsWith('inventory.get') && !product) {
    reports.push({ method, requestId, status: 'skipped-prerequisite', reasonCode: 'NO_REAL_PRODUCT_ID' });
    await persist();
    continue;
  }
  const parameters = method.endsWith('inventory.get')
    ? { product_id: product?.id, language: 'en_US' }
    : method.endsWith('type.available.get')
      ? {
          type_request: { language: 'zh_cn', ...(product?.categoryId ? { cat_id: product.categoryId } : {}) }
        }
      : method.endsWith('showcase.list')
        ? { per_page_size: 20, to_page: 1 }
        : {};
  const started = performance.now();
  try {
    const result = await gateway.request('callCapability', { method, parameters }, { requestId });
    reports.push({
      method,
      requestId,
      traceId: result.traceId,
      durationMilliseconds: Math.round(performance.now() - started),
      ...assessStockRead(method, result.data, result.contractValid),
      contractIssues: result.contractIssues,
      shape: responseShape(result.data)
    });
  } catch (error: unknown) {
    reports.push({ method, requestId, ...errorSummary(error) });
  }
  await persist();
}
process.stdout.write(
  `${JSON.stringify({ output, results: reports.map(({ shape: _shape, ...report }) => report) }, null, 2)}\n`
);
if (reports.some((r) => !['passed', 'no-data'].includes(String(r.status)))) process.exitCode = 1;
