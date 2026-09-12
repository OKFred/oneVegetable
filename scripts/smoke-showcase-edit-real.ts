import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { AlibabaClient, GatewayException } from '../packages/core/src/index';
import { ProductAdapter } from '../packages/core/src/product-adapter';
import {
  ProductShowcaseAdapter,
  showcaseBaseline,
  sameShowcaseBaseline
} from '../packages/core/src/product-showcase';
import type { ProductShowcaseSnapshot, ProductShowcaseMutationResult } from '../packages/core/src/types';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { atomicWriteJson } from './openapi-auth/storage';

// Read-only by default; the opt-in authorizes exactly four mutations, each once.
const execute = process.env.ONE_VEGETABLE_SHOWCASE_EDIT_SMOKE === '1';
const credentials = createNodeAlibabaCredentialProvider({
  ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: resolve(
    process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ?? 'artifacts/openapi-auth/credentials.json'
  )
}).requireCredentials();
const runId = randomUUID();
const directory = resolve('artifacts/showcase-edit-real');
const output = resolve(directory, `${runId}.json`);
const reports: Record<string, unknown>[] = [];
let before: ReturnType<typeof showcaseBaseline> = [];
let current: ProductShowcaseSnapshot | null = null;
let stage = 'preflight';
let replacementId = '';
const persist = () =>
  atomicWriteJson(output, {
    runId,
    capturedAtUtc: new Date().toISOString(),
    execute,
    stage,
    before,
    current: current ? showcaseBaseline(current) : null,
    replacementId,
    reports
  });
const adapter = (requestId: string) =>
  new ProductShowcaseAdapter(AlibabaClient.create(credentials, { maxAttempts: 1, requestId }));
async function edit(
  name: string,
  action: (value: ProductShowcaseAdapter) => Promise<ProductShowcaseMutationResult>
) {
  const requestId = randomUUID();
  stage = name;
  const report: Record<string, unknown> = { stage, requestId, status: 'intent-persisted' };
  reports.push(report);
  await persist();
  await setTimeout(350);
  const result = await action(adapter(requestId));
  report.status = result.outcome;
  report.traceId = result.traceId;
  current = result.snapshot;
  await persist();
  if (result.outcome !== 'confirmed' || !result.snapshot) throw new Error('UNCONFIRMED_STOP_NO_RETRY');
  return result.snapshot;
}
try {
  const readId = randomUUID();
  current = await adapter(readId).get();
  before = showcaseBaseline(current);
  reports.push({
    operation: 'getProductShowcase',
    requestId: readId,
    used: current.used,
    total: current.total
  });
  const first = before[0];
  if (before.length !== 2 || !first) throw new Error('EXPECTED_TWO_EXISTING_SLOTS');
  const gateway = new AlibabaReadGatewayClient(credentials, { maxAttempts: 1 });
  const productsId = randomUUID();
  const products = await gateway.request(
    'listProducts',
    { page: 1, pageSize: 100, language: 'en_US' },
    { requestId: productsId }
  );
  const eligible = products.items.filter(
    (product) =>
      product.status === 'online' &&
      !/dont.edit/i.test(product.subject) &&
      !before.some((row) => row.productId === product.id)
  );
  const replacement = eligible.find((product) => /onevegetable|smoke/i.test(product.subject)) ?? eligible[0];
  if (!replacement) throw new Error('NO_ELIGIBLE_TEST_PRODUCT_ON_FIRST_PAGE');
  replacementId = replacement.id;
  const original = await new ProductAdapter(AlibabaClient.create(credentials, { maxAttempts: 1 })).getSummary(
    first.productId
  );
  if (original?.status !== 'online' || /dont.edit/i.test(original.subject))
    throw new Error('ORIGINAL_NOT_SAFE_TO_RESTORE');
  const typeId = randomUUID();
  const types = await gateway.request(
    'callCapability',
    {
      method: 'alibaba.icbu.product.type.available.get',
      parameters: { type_request: { cat_id: replacement.categoryId, language: 'zh_cn' } }
    },
    { requestId: typeId }
  );
  reports.push({
    operation: 'product-type-availability',
    requestId: typeId,
    contractValid: types.contractValid,
    traceId: types.traceId,
    data: types.data
  });
  if (
    !types.contractValid ||
    !types.data ||
    typeof types.data !== 'object' ||
    !('biz_success' in types.data) ||
    types.data.biz_success !== true
  )
    throw new Error('TYPE_QUERY_FAILED');
  stage = 'ready';
  await persist();
  if (execute) {
    await mkdir(directory, { recursive: true });
    const fingerprint = createHash('sha256').update(JSON.stringify(before)).digest('hex');
    const marker = await open(resolve(directory, `${fingerprint}.once`), 'wx', 0o600);
    await marker.writeFile(runId);
    await marker.close();
    const sorted = await edit('sort', (value) =>
      value.sort({ windowId: first.windowId, sourceOrder: 1, targetOrder: 2, expectedEntries: before })
    );
    const restoredOrder = await edit('restore-sort', (value) =>
      value.sort({
        windowId: first.windowId,
        sourceOrder: 2,
        targetOrder: 1,
        expectedEntries: showcaseBaseline(sorted)
      })
    );
    if (!sameShowcaseBaseline(before, showcaseBaseline(restoredOrder)))
      throw new Error('ORDER_RESTORE_FAILED');
    const replaced = await edit('replace', (value) =>
      value.replace({ windowId: first.windowId, newProductId: replacementId, expectedEntries: before })
    );
    const restored = await edit('restore-replacement', (value) =>
      value.replace({
        windowId: first.windowId,
        newProductId: first.productId,
        expectedEntries: showcaseBaseline(replaced)
      })
    );
    if (!sameShowcaseBaseline(before, showcaseBaseline(restored)))
      throw new Error('REPLACEMENT_RESTORE_FAILED');
    stage = 'restored';
    await persist();
  }
} catch (cause) {
  reports.push({
    stage,
    error:
      cause instanceof GatewayException
        ? {
            code: cause.gatewayError.code,
            subCode: cause.gatewayError.subCode ?? null,
            traceId: cause.gatewayError.traceId ?? null
          }
        : {
            code: cause instanceof Error && /^[A-Z0-9_]+$/.test(cause.message) ? cause.message : 'LOCAL_ERROR'
          }
  });
  await persist();
  process.exitCode = 1;
}
console.log(JSON.stringify({ runId, output, stage, execute, before, replacementId, reports }, null, 2));
