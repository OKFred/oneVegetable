/**
 * Explicitly authorized fresh-baseline experiment after a historical unresolved inventory receipt.
 * --prior-receipt=<sha256> --product-id=<owned ID> [--write]
 * --write --restore-delayed resumes ONLY subtraction after a persisted, acknowledged plus.
 * Defaults to reads only. A prior receipt can sponsor exactly one new write cycle.
 * It is NEVER erased or declared restored. No other unknown write may be present.
 */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, open, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { AlibabaClient } from '../packages/core/src/alibaba-client';
import { NetworkManager } from '../packages/core/src/network';
import {
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../packages/core/src/capability-validation-lazy';
import { inspectRealCredentials } from './lib/free-api-real-credentials';
import { atomicWriteJson } from './openapi-auth/storage';
import {
  SequentialCalls,
  WriteReceipts,
  fingerprint,
  inventoryCells,
  inventoryRoundTrip,
  safeId,
  object,
  unwrap,
  assess,
  assessError,
  type Assessment,
  type InventoryCell
} from './lib/free-api-real-smoke';
import {
  INVENTORY_UPDATE_METHOD,
  assertInventoryReceiptTarget,
  assertInventoryRebaseline,
  observeInventoryTransition,
  restoreDelayedInventory
} from './lib/inventory-rebaseline';

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, '..');
  const args = process.argv.slice(2);
  const keys = ['--prior-receipt=', '--product-id='];
  if (
    args.some(
      (arg) => !['--write', '--restore-delayed'].includes(arg) && !keys.some((key) => arg.startsWith(key))
    ) ||
    keys.some((key) => args.filter((arg) => arg.startsWith(key)).length !== 1) ||
    args.filter((arg) => arg === '--write').length > 1
  )
    throw new Error('EXACT_OPTIONS_REQUIRED');
  const priorKey = args.find((arg) => arg.startsWith(keys[0] ?? ''))?.slice(16) ?? '';
  const productId = safeId(args.find((arg) => arg.startsWith(keys[1] ?? ''))?.slice(13));
  if (!/^[a-f0-9]{64}$/.test(priorKey) || !productId) throw new Error('INVALID_TARGET');
  const writeEnabled = args.includes('--write');
  const restoreDelayed = args.includes('--restore-delayed');
  if (restoreDelayed && !writeEnabled) throw new Error('RESTORATION_REQUIRES_WRITE_AUTHORIZATION');
  const directory = resolve(root, 'artifacts/free-api-validation');
  const runId = randomUUID();
  const output = resolve(directory, `inventory-rebaseline-${runId}.json`);
  execFileSync('git', ['check-ignore', '--quiet', '--', relative(root, output)], {
    cwd: root,
    stdio: 'pipe'
  });
  const inspected = await inspectRealCredentials(root);
  const credentials = await inspected.provider.requireCredentials().finally(() => {
    inspected.close();
  });
  if (credentials.endpoint !== 'https://eco.taobao.com/router/rest') throw new Error('UNREVIEWED_ENDPOINT');
  const ledger = new WriteReceipts(resolve(directory, 'write-receipts'));
  const unresolved = await ledger.unresolved();
  const report = {
    schemaVersion: 1,
    runId,
    priorReceipt: priorKey,
    historicalOutcome: 'unresolved-original-baseline-unavailable',
    authorization: 'user-requested-new-experiment-using-current-recorded-baseline',
    productId,
    writeEnabled,
    startedAtUtc: new Date().toISOString(),
    baseline: null as InventoryCell[] | null,
    restoringRecordedBaseline: null as InventoryCell[] | null,
    observations: [] as { phase: string; cells: InventoryCell[] | null; checkedAtUtc: string }[],
    calls: [] as Record<string, unknown>[],
    outcome: { status: 'skipped-prerequisite', reason: 'NOT_STARTED' } as Assessment
  };
  await mkdir(directory, { recursive: true });
  const persist = () => atomicWriteJson(output, report);
  // Each intent/reply is exclusive and fsync'd, independently of the aggregate report.
  const event = async (requestId: string, phase: string, data: unknown) => {
    const file = await open(resolve(directory, `${runId}-${requestId}-${phase}.json`), 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(data));
      await file.sync();
    } finally {
      await file.close();
    }
  };
  const network = new NetworkManager({
    policies: {
      alibaba: {
        allowedOrigins: ['https://eco.taobao.com'],
        timeoutMilliseconds: 30_000,
        maxResponseBytes: 10 * 1024 * 1024,
        redirect: 'error',
        cache: 'no-store',
        defaultHeaders: { 'Cache-Control': 'no-cache' }
      }
    }
  });
  const sequential = new SequentialCalls(350);
  async function call(method: string, parameters: Record<string, unknown>, phase: string) {
    const mutation = method === INVENTORY_UPDATE_METHOD;
    if (mutation && !writeEnabled) throw new Error('WRITE_NOT_AUTHORIZED');
    if ((await validateCapabilityRequest(method, parameters)).length) throw new Error('INVALID_REQUEST');
    const requestId = randomUUID();
    const entry: Record<string, unknown> = {
      requestId,
      method,
      phase,
      parameters,
      preparedAtUtc: new Date().toISOString()
    };
    report.calls.push(entry);
    await event(requestId, 'intent', entry);
    await persist();
    let data: Record<string, unknown> | null = null;
    let outcome: Assessment;
    try {
      const response = await sequential.run(async () => {
        entry.startedAtUtc = new Date().toISOString();
        await persist();
        return new AlibabaClient(credentials, network, {
          requestId,
          maxAttempts: 1,
          shouldRetry: () => false
        }).call(method, parameters);
      });
      data = unwrap(method, response.data);
      const issues = await validateCapabilityResponse(method, data);
      outcome = assess(method, data, issues.length === 0, mutation);
      entry.contractIssueCount = issues.length;
      if (!mutation) entry.inventory = inventoryCells(data);
    } catch (error) {
      outcome = assessError(error, mutation);
    }
    Object.assign(entry, outcome, { finishedAtUtc: new Date().toISOString() });
    await event(requestId, 'response', entry);
    await persist();
    return { data, outcome: { ...outcome, requestId } };
  }
  async function readPair(phase: string): Promise<InventoryCell[] | null> {
    const snapshots: (InventoryCell[] | null)[] = [];
    for (const method of ['alibaba.icbu.product.sku.inventory.get', 'alibaba.icbu.product.inventory.get']) {
      const response = await call(method, { product_id: productId, language: 'en_US' }, phase);
      snapshots.push(response.outcome.status === 'passed' ? inventoryCells(response.data) : null);
    }
    const cells =
      snapshots[0] && JSON.stringify(snapshots[0]) === JSON.stringify(snapshots[1]) ? snapshots[0] : null;
    report.observations.push({ phase, cells, checkedAtUtc: new Date().toISOString() });
    await persist();
    console.log(
      JSON.stringify({
        phase,
        selectedQuantity: cells?.[0]?.quantity ?? null,
        matchingDualRead: cells !== null
      })
    );
    return cells;
  }
  await persist();
  try {
    const baseline = await readPair('new-baseline');
    if (!baseline?.length) throw new Error('NO_CONSISTENT_BASELINE');
    assertInventoryReceiptTarget(priorKey, fingerprint(credentials.appKey), productId, baseline);
    report.baseline = baseline;
    await event(runId, 'baseline', { priorKey, productId, baseline, originalBaselineStillUnknown: true });
    await persist();
    if (!writeEnabled) {
      report.outcome = { status: 'skipped-prerequisite', reason: 'BASELINE_RECORDED_READ_ONLY' };
    } else if (restoreDelayed) {
      const key = fingerprint([
        INVENTORY_UPDATE_METHOD,
        ['explicit-new-baseline-experiment', priorKey, fingerprint(credentials.appKey)]
      ]);
      const receiptPath = resolve(directory, 'write-receipts');
      const intent = object(
        JSON.parse(await readFile(resolve(receiptPath, `${key}.intent.json`), 'utf8')) as unknown
      );
      const plus = object(
        JSON.parse(await readFile(resolve(receiptPath, `${key}.plus-result.json`), 'utf8')) as unknown
      );
      const recovery = object(intent.recovery);
      const rawBaseline = recovery.baseline;
      const savedBaseline = Array.isArray(rawBaseline)
        ? inventoryCells({
            result: {
              success: true,
              data_list: rawBaseline.map((value: unknown) => {
                const item = object(value);
                return { sku_id: item.skuId, inventory_code: item.code, inventory: item.quantity };
              })
            }
          })
        : null;
      if (
        intent.key !== key ||
        intent.method !== INVENTORY_UPDATE_METHOD ||
        recovery.productId !== productId ||
        !savedBaseline?.length ||
        plus.status !== 'passed' ||
        plus.reason !== 'BUSINESS_ACKNOWLEDGED'
      )
        throw new Error('INVALID_ACKNOWLEDGED_RECOVERY_RECEIPT');
      assertInventoryReceiptTarget(priorKey, fingerprint(credentials.appKey), productId, savedBaseline);
      report.restoringRecordedBaseline = savedBaseline;
      await persist();
      const record = async (phase: string, assessment: Assessment, inventory?: InventoryCell[] | null) => {
        if (!/^[a-z0-9-]+$/.test(phase)) throw new Error('INVALID_PHASE');
        const handle = await open(resolve(receiptPath, `${key}.${phase}.json`), 'wx', 0o600);
        try {
          await handle.writeFile(
            JSON.stringify({
              method: INVENTORY_UPDATE_METHOD,
              key,
              phase,
              ...assessment,
              ...(inventory !== undefined ? { inventory } : {}),
              recordedAt: new Date().toISOString()
            })
          );
          await handle.sync();
        } finally {
          await handle.close();
        }
      };
      report.outcome = await restoreDelayedInventory({
        baseline: savedBaseline,
        read: () => readPair('delayed-restoration'),
        wait: () => setTimeout(10_000),
        record,
        write: async (cell) =>
          (
            await call(
              INVENTORY_UPDATE_METHOD,
              {
                request_param: {
                  product_id: productId,
                  inventory_list: [
                    { sku_id: cell.skuId, inventory_code: cell.code, inventory: 1, operate: 'sub' }
                  ]
                }
              },
              'sub'
            )
          ).outcome
      });
      await record('delayed-restoration-result', report.outcome);
    } else {
      assertInventoryRebaseline(priorKey, unresolved, fingerprint(credentials.appKey), productId, baseline);
      const receipt = await ledger.begin(
        INVENTORY_UPDATE_METHOD,
        ['explicit-new-baseline-experiment', priorKey, fingerprint(credentials.appKey)],
        { productId, baseline }
      );
      const increased = baseline.map((cell, i) =>
        i === 0 ? { ...cell, quantity: cell.quantity + 1 } : cell
      );
      report.outcome = await inventoryRoundTrip({
        baseline,
        record: receipt.record,
        read: (phase) =>
          phase === 'baseline'
            ? readPair(phase)
            : observeInventoryTransition({
                before: phase === 'after-plus' ? baseline : increased,
                expected: phase === 'after-plus' ? increased : baseline,
                read: () => readPair(phase),
                wait: () => setTimeout(10_000),
                attempts: 16
              }),
        write: async (operate, cell) => {
          const response = await call(
            INVENTORY_UPDATE_METHOD,
            {
              request_param: {
                product_id: productId,
                inventory_list: [{ sku_id: cell.skuId, inventory_code: cell.code, inventory: 1, operate }]
              }
            },
            operate
          );
          return response.outcome;
        }
      });
      await receipt.record('cycle-result', report.outcome);
    }
  } catch {
    report.outcome = {
      status: report.calls.some((entry) => entry.method === INVENTORY_UPDATE_METHOD)
        ? 'result-unknown'
        : 'skipped-prerequisite',
      reason: 'LOCAL_GUARD_OR_IO_FAILURE_NO_AUTOMATIC_RETRY'
    };
  }
  await persist();
  console.log(
    JSON.stringify({ output, outcome: report.outcome, historicalOutcome: report.historicalOutcome })
  );
  if (writeEnabled && report.outcome.status !== 'passed') process.exitCode = 1;
}

try {
  await main();
} catch {
  console.error('INVENTORY_REBASELINE_FAILED_NO_AUTOMATIC_RETRY');
  process.exitCode = 2;
}
