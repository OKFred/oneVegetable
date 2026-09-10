import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AlibabaClient } from '../packages/core/src/alibaba-client';
import { ProductAdapter } from '../packages/core/src/product-adapter';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { isRecord } from './lib/product-stock-smoke';
import { showcaseEntries } from './lib/showcase-smoke';
import { atomicWriteJson } from './openapi-auth/storage';

const runId = process.argv[2];
if (!runId || !/^[a-f0-9-]{36}$/.test(runId)) throw new Error('EXPLICIT_SMOKE_RUN_REQUIRED');
const report: unknown = JSON.parse(
  await readFile(resolve(`artifacts/showcase-mutation-real/${runId}.json`), 'utf8')
);
if (
  !isRecord(report) ||
  report.stage !== 'swap-restored' ||
  !Array.isArray(report.before) ||
  !Array.isArray(report.reports) ||
  typeof report.productId !== 'string'
)
  throw new Error('COMPLETED_SWAP_REPORT_REQUIRED');
const baseline = report.before;
const original: unknown = report.reports.find(
  (entry: unknown) => isRecord(entry) && entry.operation === 'original-product-read'
);
if (!isRecord(original) || typeof original.productId !== 'string' || typeof original.schemaHash !== 'string')
  throw new Error('MISSING_ORIGINAL_PROOF');
const credentials = createNodeAlibabaCredentialProvider({
  ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: resolve('artifacts/openapi-auth/credentials.json')
}).requireCredentials();
const gateway = new AlibabaReadGatewayClient(credentials, { maxAttempts: 1 });
const listRequestId = randomUUID();
const result = await gateway.request(
  'callCapability',
  { method: 'alibaba.scbp.showcase.list', parameters: { per_page_size: 20, to_page: 1 } },
  { requestId: listRequestId }
);
if (!result.contractValid) throw new Error('LIST_CONTRACT_DRIFT');
const entries = showcaseEntries(result.data);
const restored =
  entries.length === baseline.length &&
  entries.length < 20 &&
  !entries.some((entry) => entry.productId === report.productId) &&
  baseline.every(
    (entry: unknown) =>
      isRecord(entry) &&
      entries.some(
        (row) =>
          row.productId === entry.productId &&
          (entry.productId === original.productId || row.windowId === entry.windowId)
      )
  );
const products = [];
for (const productId of [original.productId, report.productId]) {
  const requestId = randomUUID();
  const detail = await new ProductAdapter(
    AlibabaClient.create(credentials, { maxAttempts: 1, requestId })
  ).get(productId);
  products.push({
    productId,
    requestId,
    status: detail.status,
    schemaHash: createHash('sha256').update(detail.schemaXml).digest('hex')
  });
}
const originalSchemaUnchanged = products[0]?.schemaHash === original.schemaHash;
const output = resolve(`artifacts/showcase-mutation-real/${runId}-verification.json`);
const evidence = {
  capturedAtUtc: new Date().toISOString(),
  runId,
  restored,
  originalSchemaUnchanged,
  bothProductsOnline: products.every((item) => item.status === 'online'),
  entries,
  listRequestId,
  traceId: result.traceId,
  products,
  businessMutations: 0
};
await atomicWriteJson(output, evidence);
process.stdout.write(`${JSON.stringify({ output, ...evidence }, null, 2)}\n`);
if (!restored || !originalSchemaUnchanged || !evidence.bothProductsOnline) process.exitCode = 1;
