/** Read-only diagnosis of a stopped inventory receipt. This file has NO mutation call path. */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { AlibabaClient } from '../../packages/core/src/alibaba-client';
import { NetworkManager } from '../../packages/core/src/network';
import type { GatewayCredentials } from '../../packages/core/src/types';
import {
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../../packages/core/src/capability-validation-lazy';
import { inspectRealCredentials } from './free-api-real-credentials';
import {
  array,
  object,
  safeId,
  fingerprint,
  inventoryCells,
  SequentialCalls,
  unwrap,
  assess,
  assessError,
  responseShape,
  authorize
} from './free-api-real-smoke';
import { atomicWriteJson } from '../openapi-auth/storage';

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, '../..');
  const args = process.argv.slice(2);
  const key = args.find((a) => a.startsWith('--receipt='))?.slice(10) ?? '';
  const allow = new Set((args.find((a) => a.startsWith('--allow='))?.slice(8) ?? '').split(','));
  const required = [
    'alibaba.icbu.product.list',
    'alibaba.icbu.product.sku.inventory.get',
    'alibaba.icbu.product.inventory.get'
  ];
  if (
    !args.includes('--read') ||
    !/^[a-f0-9]{64}$/.test(key) ||
    required.some((m) => !allow.has(m)) ||
    [...allow].some((m) => !required.includes(m))
  )
    throw new Error('EXACT_READ_OPT_INS_REQUIRED');
  const directory = resolve(root, 'artifacts/free-api-validation');
  const receipt = object(
    JSON.parse(await readFile(resolve(directory, 'write-receipts', `${key}.intent.json`), 'utf8')) as unknown
  );
  if (receipt.method !== 'alibaba.icbu.product.inventory.update' || receipt.key !== key)
    throw new Error('RECEIPT_NOT_INVENTORY');
  const inspected = await inspectRealCredentials(root);
  let credentials: GatewayCredentials;
  try {
    credentials = await inspected.provider.requireCredentials();
  } finally {
    inspected.close();
  }
  if (credentials.endpoint !== 'https://eco.taobao.com/router/rest') throw new Error('UNREVIEWED_ENDPOINT');
  const network = new NetworkManager({
    policies: {
      alibaba: {
        allowedOrigins: ['https://eco.taobao.com'],
        timeoutMilliseconds: 30000,
        maxResponseBytes: 10 * 1024 * 1024,
        redirect: 'error',
        cache: 'no-store',
        defaultHeaders: { 'Cache-Control': 'no-cache' }
      }
    }
  });
  const sequential = new SequentialCalls(350);
  const report: Record<string, unknown> = {
    schemaVersion: 1,
    receiptKey: key,
    capturedAtUtc: new Date().toISOString(),
    readOnly: true,
    originalBaseline: object(receipt.recovery).baseline ?? null,
    baselineMissingFromOriginalReceipt: !receipt.recovery,
    warning: 'Do not infer original quantity from current reads. No automatic subtraction or retry.',
    target: null,
    observations: [] as unknown[],
    calls: [] as unknown[]
  };
  const output = resolve(directory, `inventory-reconcile-${randomUUID()}.json`);
  const calls = report.calls as unknown[];
  async function read(
    method: string,
    parameters: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    authorize(method, 'read', { read: true, write: false, allow });
    if ((await validateCapabilityRequest(method, parameters)).length)
      throw new Error('REQUEST_CONTRACT_INVALID');
    const requestId = randomUUID();
    const invocation: Record<string, unknown> = {
      requestId,
      method,
      preparedAtUtc: new Date().toISOString(),
      status: 'result-unknown',
      reason: 'READ_DISPATCH_INTENT'
    };
    calls.push(invocation);
    await atomicWriteJson(output, report);
    try {
      const result = await sequential.run(async () => {
        invocation.startedAtUtc = new Date().toISOString();
        await atomicWriteJson(output, report);
        return new AlibabaClient(credentials, network, {
          requestId,
          maxAttempts: 1,
          shouldRetry: () => false
        }).call(method, parameters);
      });
      const data = unwrap(method, result.data);
      const contract = await validateCapabilityResponse(method, data);
      const outcome = assess(method, data, contract.length === 0);
      Object.assign(invocation, {
        finishedAtUtc: new Date().toISOString(),
        ...outcome,
        contractIssueCount: contract.length,
        shape: responseShape(data)
      });
      await atomicWriteJson(output, report);
      return ['passed', 'no-data'].includes(outcome.status) ? data : null;
    } catch (error) {
      Object.assign(invocation, { finishedAtUtc: new Date().toISOString(), ...assessError(error) });
      await atomicWriteJson(output, report);
      return null;
    }
  }
  await atomicWriteJson(output, report);
  const list = await read(required[0] ?? '', { current_page: 1, page_size: 10, language: 'ENGLISH' });
  const productIds = array(list?.products)
    .map((p) => safeId(object(p).id))
    .filter((p): p is number => p !== undefined);
  const accountKey = fingerprint(credentials.appKey);
  for (const productId of productIds) {
    const sku = await read('alibaba.icbu.product.sku.inventory.get', {
      product_id: productId,
      language: 'en_US'
    });
    const cells = inventoryCells(sku);
    if (!cells?.length) continue;
    const candidate = fingerprint([
      receipt.method,
      [accountKey, productId, cells.map((c) => [c.skuId, c.code])]
    ]);
    if (candidate !== key) continue;
    const selected = cells[0];
    if (!selected) continue;
    report.target = {
      productId,
      skuId: selected.skuId,
      inventoryCode: selected.code,
      matchedOriginalReceiptFingerprint: true
    };
    const observations = report.observations as unknown[];
    observations.push({
      atUtc: new Date().toISOString(),
      source: 'sku',
      rowCount: cells.length,
      selectedQuantity: selected.quantity
    });
    // Multiple delayed reads distinguish a single stale response from sustained visibility.
    // They do not repair missing historical baseline evidence or authorize a compensating write.
    for (let check = 1; check <= 3; check++) {
      await setTimeout(3000);
      for (const method of ['alibaba.icbu.product.sku.inventory.get', 'alibaba.icbu.product.inventory.get']) {
        const data = await read(method, { product_id: productId, language: 'en_US' });
        const snapshot = inventoryCells(data);
        const target = snapshot?.find((c) => c.skuId === selected.skuId && c.code === selected.code);
        observations.push({
          check,
          atUtc: new Date().toISOString(),
          source: method.includes('.sku.') ? 'sku' : 'product',
          rowCount: snapshot?.length ?? null,
          selectedQuantity: target?.quantity ?? null,
          otherCellsSameAsFirstReconciliationRead: snapshot
            ? fingerprint(snapshot.filter((c) => c.skuId !== selected.skuId || c.code !== selected.code)) ===
              fingerprint(cells.filter((c) => c.skuId !== selected.skuId || c.code !== selected.code))
            : null
        });
        await atomicWriteJson(output, report);
      }
    }
    break;
  }
  report.completedAtUtc = new Date().toISOString();
  await atomicWriteJson(output, report);
  console.log(
    JSON.stringify({
      output,
      target: report.target,
      observations: report.observations,
      baselineMissingFromOriginalReceipt: report.baselineMissingFromOriginalReceipt
    })
  );
}
try {
  await main();
} catch {
  console.error('READ_ONLY_RECONCILIATION_FAILED_NO_MUTATION_OR_SECRET_OUTPUT');
  process.exitCode = 1;
}
