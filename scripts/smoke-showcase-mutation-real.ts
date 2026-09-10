import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import {
  AlibabaClient,
  GatewayException,
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../packages/core/src/index';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { atomicWriteJson, redactText } from './openapi-auth/storage';
import { isRecord, responseShape } from './lib/product-stock-smoke';
import { runShowcaseSwap } from './lib/showcase-swap';
import { ProductAdapter } from '../packages/core/src/product-adapter';
import {
  mutationConfirmed,
  unwrapShowcaseResponse,
  newShowcaseEntry,
  restorationConfirmed,
  showcaseEntries,
  type ShowcaseEntry
} from './lib/showcase-smoke';

// Default is read-only. No generic runtime mutation flags are changed.
const execute = process.env.ONE_VEGETABLE_SHOWCASE_SMOKE === '1';
const replaceWindowId = process.env.ONE_VEGETABLE_SHOWCASE_REPLACE_WINDOW_ID;
if (replaceWindowId && !/^[1-9][0-9]*$/.test(replaceWindowId))
  throw new Error('INVALID_REPLACEMENT_WINDOW_ID');
const productId = process.env.ONE_VEGETABLE_SHOWCASE_PRODUCT_ID;
if (!productId || !/^[1-9][0-9]*$/.test(productId)) throw new Error('EXPLICIT_PRODUCT_ID_REQUIRED');
const credentials = createNodeAlibabaCredentialProvider({
  ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: resolve(
    process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ?? 'artifacts/openapi-auth/credentials.json'
  )
}).requireCredentials();
const gateway = new AlibabaReadGatewayClient(credentials, { maxAttempts: 1 });
const runId = randomUUID();
const directory = resolve('artifacts/showcase-mutation-real');
const output = resolve(directory, `${runId}.json`);
const reports: Record<string, unknown>[] = [];
let before: ShowcaseEntry[] = [];
let added: ShowcaseEntry | null = null;
let stage = 'preflight';
const persist = () =>
  atomicWriteJson(output, {
    runId,
    capturedAtUtc: new Date().toISOString(),
    productId,
    replaceWindowId: replaceWindowId ?? null,
    execute,
    stage,
    before,
    added,
    maxAttempts: 1,
    reports
  });
const reason = (error: unknown) =>
  error instanceof GatewayException
    ? {
        code: error.gatewayError.code,
        diagnostic: redactText(
          [credentials.appKey, credentials.appSecret, credentials.accessToken].reduce(
            (text, secret) => (secret ? text.replaceAll(secret, '[REDACTED]') : text),
            error.gatewayError.message
          )
        ),
        subCode: error.gatewayError.subCode ?? null,
        traceId: error.gatewayError.traceId ?? null
      }
    : { code: error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'LOCAL_ERROR' };

async function read(
  method: 'alibaba.scbp.showcase.list' | 'alibaba.scbp.showcase.status',
  parameters: Record<string, unknown>
) {
  await setTimeout(350);
  const requestId = randomUUID();
  const record: Record<string, unknown> = { method, requestId, status: 'reading' };
  reports.push(record);
  await persist();
  try {
    const result = await gateway.request('callCapability', { method, parameters }, { requestId });
    Object.assign(record, { status: 'read', traceId: result.traceId, contractValid: result.contractValid });
    await persist();
    if (!result.contractValid) throw new Error('READ_CONTRACT_DRIFT');
    return result.data;
  } catch (error: unknown) {
    Object.assign(record, { status: 'read-failed', error: reason(error) });
    await persist();
    throw error;
  }
}

async function list(): Promise<ShowcaseEntry[]> {
  const rows: ShowcaseEntry[] = [];
  for (let page = 1; page <= 100; page++) {
    const next = showcaseEntries(
      await read('alibaba.scbp.showcase.list', { per_page_size: 20, to_page: page })
    );
    if (next.some((row) => rows.some((previous) => previous.windowId === row.windowId)))
      throw new Error('REPEATED_SHOWCASE_PAGE');
    rows.push(...next);
    if (next.length < 20) return rows;
  }
  throw new Error('SHOWCASE_PAGINATION_INCOMPLETE');
}

async function mutate(
  method: 'alibaba.scbp.showcase.addproduct' | 'alibaba.scbp.showcase.deleteproduct',
  parameters: Record<string, unknown>
) {
  if ((await validateCapabilityRequest(method, parameters)).length)
    throw new Error('INVALID_MUTATION_REQUEST');
  const requestId = randomUUID();
  const record: Record<string, unknown> = { method, requestId, status: 'intent-persisted' };
  reports.push(record);
  await persist(); // Must succeed before sending. Never retry after an uncertain result.
  try {
    const response = await AlibabaClient.create(credentials, { maxAttempts: 1, requestId }).call(
      method,
      parameters
    );
    const data = unwrapShowcaseResponse(response.data, method);
    const issues = await validateCapabilityResponse(method, data);
    Object.assign(record, {
      status: issues.length === 0 && mutationConfirmed(data) ? 'acknowledged' : 'unknown',
      contractValid: issues.length === 0,
      contractIssues: issues,
      responseShape: responseShape(response.data),
      traceId: isRecord(data) && typeof data.request_id === 'string' ? data.request_id : null
    });
  } catch (error: unknown) {
    Object.assign(record, { status: 'unknown', error: reason(error) });
  }
  await persist();
  return record.status === 'acknowledged';
}

try {
  const status = await read('alibaba.scbp.showcase.status', {});
  if (!isRecord(status) || typeof status.total_count !== 'number' || typeof status.current_count !== 'number')
    throw new Error('INVALID_CAPACITY');
  before = await list();
  reports.push({ capacity: status.total_count, used: status.current_count, listed: before.length });
  if (before.length !== status.current_count) throw new Error('SHOWCASE_COUNT_MISMATCH');
  if (before.some((entry) => entry.productId === productId)) throw new Error('TARGET_ALREADY_IN_SHOWCASE');
  const requestId = randomUUID();
  const products = await gateway.request(
    'listProducts',
    { page: 1, pageSize: 100, language: 'en_US' },
    { requestId }
  );
  const product = products.items.find((item) => item.id === productId);
  if (product?.status !== 'online' || /dont.edit/i.test(product.subject)) {
    reports.push({
      eligibleProductIds: products.items
        .filter(
          (item) =>
            item.status === 'online' &&
            !/dont.edit/i.test(item.subject) &&
            !before.some((row) => row.productId === item.id)
        )
        .slice(0, 5)
        .map((item) => item.id)
    });
    throw new Error('TARGET_NOT_ELIGIBLE_ON_FIRST_PAGE');
  }
  reports.push({ method: 'alibaba.icbu.product.list', requestId, targetFound: true, status: product.status });
  const original = replaceWindowId ? before.find((entry) => entry.windowId === replaceWindowId) : undefined;
  if (replaceWindowId && !original) throw new Error('REPLACEMENT_NOT_FOUND');
  if (status.total_count <= status.current_count && !original) throw new Error('NO_FREE_SHOWCASE_SLOT');
  if (original) {
    const requestId = randomUUID();
    const detail = await new ProductAdapter(
      AlibabaClient.create(credentials, { maxAttempts: 1, requestId })
    ).get(original.productId);
    if (detail.status !== 'online' || /dont.edit/i.test(detail.subject))
      throw new Error('ORIGINAL_NOT_ELIGIBLE_FOR_RESTORE');
    reports.push({
      operation: 'original-product-read',
      requestId,
      productId: original.productId,
      status: detail.status,
      schemaHash: createHash('sha256').update(detail.schemaXml).digest('hex')
    });
  }
  stage = 'ready';
  await persist();
  if (execute) {
    // Retain this marker permanently: running again must not duplicate a previous uncertain write.
    await mkdir(directory, { recursive: true });
    const marker = await open(resolve(directory, `${productId}.once`), 'wx', 0o600);
    await marker.writeFile(runId);
    await marker.close();
    if (original) {
      await runShowcaseSwap({
        before,
        original,
        targetId: productId,
        list: async () => {
          await setTimeout(2000);
          return list();
        },
        mutate,
        checkpoint: async (nextStage, entry) => {
          stage = nextStage;
          reports.push({ stage, ...(entry ? { entry } : {}) });
          await persist();
        }
      });
    } else {
      stage = 'adding';
      const acknowledged = await mutate('alibaba.scbp.showcase.addproduct', { product_id_list: [productId] });
      // Bounded read-only reconciliation; never repeat the mutation.
      for (let attempt = 0; attempt < 3 && !added; attempt++) {
        await setTimeout(2000);
        const after = await list();
        if (after.some((row) => row.productId === productId))
          added = newShowcaseEntry(before, after, productId);
      }
      if (!added) throw new Error('ADD_NOT_CONFIRMED_NO_RETRY');
      if (!acknowledged) throw new Error('ADD_RECEIPT_UNKNOWN_MANUAL_REVIEW');
      stage = 'added-confirmed';
      await persist();
      const current = newShowcaseEntry(before, await list(), productId);
      if (current.windowId !== added.windowId) throw new Error('TARGET_CHANGED_STOP_RESTORE');
      stage = 'restoring';
      await mutate('alibaba.scbp.showcase.deleteproduct', { window_id_list: [added.windowId] });
      let restored = false;
      for (let attempt = 0; attempt < 3 && !restored; attempt++) {
        await setTimeout(2000);
        restored = restorationConfirmed(before, await list(), added);
      }
      if (!restored) throw new Error('RESTORE_NOT_CONFIRMED_NO_RETRY');
      stage = 'restored';
      await persist();
      if (reports.some((record) => record.status === 'unknown')) process.exitCode = 1;
    }
  }
} catch (error: unknown) {
  reports.push({
    stage,
    error: reason(error),
    requiresManualReview: execute && stage !== 'preflight' && stage !== 'ready'
  });
  await persist();
  process.exitCode = 1;
}
process.stdout.write(`${JSON.stringify({ output, runId, productId, stage, added, reports }, null, 2)}\n`);
