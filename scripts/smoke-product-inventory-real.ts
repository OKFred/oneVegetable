import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { GatewayException } from '../packages/core/src/errors';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { atomicWriteJson } from './openapi-auth/storage';
import { assessStockRead, responseShape } from './lib/product-stock-smoke';

if (process.env.ONE_VEGETABLE_INVENTORY_SMOKE !== '1') throw new Error('Explicit read-only opt-in required');
const provider = createNodeAlibabaCredentialProvider({
  ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: resolve(
    process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ?? 'artifacts/openapi-auth/credentials.json'
  )
});
const gateway = new AlibabaReadGatewayClient(provider.requireCredentials(), { maxAttempts: 1 });
const dedicated = process.argv.includes('--dedicated');
const sampleLimit = Number(process.argv.find((arg) => arg.startsWith('--limit='))?.slice(8) ?? '10');
if (!Number.isInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 10)
  throw new Error('Sample limit must be 1–10');
const methods = ['alibaba.icbu.product.inventory.get', 'alibaba.icbu.product.sku.inventory.get'] as const;
const runId = randomUUID();
const output = resolve(`artifacts/product-inventory-real/${runId}.json`);
const reports: Record<string, unknown>[] = [];
const persist = () =>
  atomicWriteJson(output, {
    runId,
    capturedAtUtc: new Date().toISOString(),
    readOnly: true,
    dedicated,
    maxAttempts: 1,
    reports
  });
function failure(error: unknown) {
  const value = error instanceof GatewayException ? error.gatewayError : null;
  const raw = value?.subCode ?? value?.code ?? 'LOCAL_ERROR';
  const reasonCode = /^[a-zA-Z0-9_.:-]{1,100}$/.test(raw) ? raw : 'PROVIDER_ERROR';
  return {
    status:
      /permission|auth|token|session|credential/i.test(reasonCode) || value?.code === '11'
        ? 'permission-denied'
        : 'provider-error',
    reasonCode
  };
}
try {
  const requestId = randomUUID();
  const page = await gateway.request(
    'listProducts',
    { page: 1, pageSize: 30, language: 'en_US' },
    { requestId }
  );
  const products = [
    ...new Map(page.items.filter((p) => /^[1-9][0-9]*$/.test(p.id)).map((p) => [p.id, p])).values()
  ].slice(0, sampleLimit);
  reports.push({
    method: 'alibaba.icbu.product.list',
    requestId,
    status: products.length ? 'passed' : 'no-data',
    sampleCount: products.length
  });
  await persist();
  let stopped = false;
  for (const [index, product] of products.entries()) {
    if (stopped) break;
    for (const method of methods) {
      await setTimeout(350);
      const requestId = randomUUID();
      const started = performance.now();
      try {
        if (dedicated) {
          const result = await gateway.request(
            'getProductInventory',
            {
              productId: product.id,
              language: 'en_US',
              source: method.includes('.sku.') ? 'sku' : 'product'
            },
            { requestId }
          );
          reports.push({
            sampleIndex: index + 1,
            method,
            requestId,
            traceId: result.traceId,
            durationMilliseconds: Math.round(performance.now() - started),
            status: result.status === 'ready' ? 'passed' : result.status,
            recordCount: result.records.length,
            issues: result.issues
          });
          await persist();
          continue;
        }
        const result = await gateway.request(
          'callCapability',
          {
            method,
            parameters: { product_id: product.id, language: 'en_US' }
          },
          { requestId }
        );
        reports.push({
          sampleIndex: index + 1,
          method,
          requestId,
          traceId: result.traceId,
          durationMilliseconds: Math.round(performance.now() - started),
          ...assessStockRead(method, result.data, result.contractValid),
          contractIssues: result.contractIssues,
          shape: responseShape(result.data)
        });
      } catch (error: unknown) {
        const result = failure(error);
        reports.push({ sampleIndex: index + 1, method, requestId, ...result });
        stopped = true;
      }
      await persist();
      if (stopped) break;
    }
  }
} catch (error: unknown) {
  reports.push({ stage: 'list', ...failure(error) });
  await persist();
}
process.stdout.write(
  `${JSON.stringify({ output, results: reports.map(({ shape: _shape, ...r }) => r) }, null, 2)}\n`
);
if (reports.some((r) => !['passed', 'no-data'].includes(String(r.status)))) process.exitCode = 1;
