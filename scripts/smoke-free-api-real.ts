/**
 * Windows: pnpm exec tsx scripts/smoke-free-api-real.ts --preflight
 * Real calls require --read / --write AND --allow=<comma separated exact methods or docIds>.
 * Prerequisite reads outside Scope35 must also be named individually in --allow.
 * Local .env is read only for existing Node configuration, never copied into process.env or printed.
 * No credential refresh, browser login, example-ID fallback or write retry.
 * Optional --translation-app-name is a registered BUSINESS scenario, not an application display name.
 * Optional --video-manifest is an ignored local ownership/storage attestation (see helper).
 * Reports always have exactly 35 results; support reads are a separate array.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { atomicWriteJson } from './openapi-auth/storage';
import { inspectRealCredentials } from './lib/free-api-real-credentials';
import type { GatewayCredentials } from '../packages/core/src/types';
import {
  READ_METHODS,
  WRITE_METHODS,
  BLOCKERS,
  SequentialCalls,
  WriteReceipts,
  authorize,
  planRead,
  collectContext,
  unwrap,
  object,
  array,
  safeId,
  responseShape,
  assess,
  assessError,
  inventoryCells,
  inventoryRoundTrip,
  fingerprint,
  readOwnedVideoManifest,
  type Assessment,
  type Context,
  type Definition,
  type InventoryCell
} from './lib/free-api-real-smoke';

const root = resolve(import.meta.dirname, '..');
interface Result extends Assessment {
  docId: number | null;
  method: string;
  attempted: boolean;
  calls: number;
  requestShape?: unknown;
  responseShape?: unknown;
  contractIssueCount?: number;
  requestContractIssueCount?: number;
  code?: string;
  phase?: string;
  requestIds?: string[];
}
interface Invocation extends Assessment {
  requestId: string;
  method: string;
  phase: string;
  preparedAtUtc: string;
  startedAtUtc?: string;
  finishedAtUtc?: string;
  code?: string;
}
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flags = new Set(['--read', '--write', '--preflight']);
  const keys = ['--allow=', '--credential-file=', '--translation-app-name=', '--video-manifest='];
  if (args.some((a) => !flags.has(a) && !keys.some((k) => a.startsWith(k))))
    throw new Error('UNKNOWN_OPTION');
  for (const key of keys)
    if (args.filter((a) => a.startsWith(key)).length > 1) throw new Error('DUPLICATE_OPTION');
  const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const preflight = args.includes('--preflight');
  const scope = JSON.parse(await readFile(resolve(root, 'config/alibaba-free-api-scope.json'), 'utf8')) as {
    entries: Definition[];
  };
  if (
    scope.entries.length !== 35 ||
    new Set(scope.entries.map((d) => d.docId)).size !== 35 ||
    new Set(scope.entries.map((d) => d.method)).size !== 35
  )
    throw new Error('SCOPE_MUST_CONTAIN_35_UNIQUE_IDENTITIES');
  const allowed = (option('allow') ?? '')
    .split(',')
    .filter(Boolean)
    .map((s) => scope.entries.find((d) => String(d.docId) === s)?.method ?? s);
  if (allowed.some((m) => !READ_METHODS.has(m) && !WRITE_METHODS.has(m)))
    throw new Error('UNKNOWN_ALLOWLIST_METHOD');
  const options = {
    read: !preflight && args.includes('--read'),
    write: !preflight && args.includes('--write'),
    allow: new Set(allowed)
  };
  if (options.write && !options.read) throw new Error('WRITE_REQUIRES_READBACK_OPT_IN');
  const runId = randomUUID();
  const output = resolve(root, 'artifacts/free-api-validation', `${runId}.json`);
  execFileSync('git', ['check-ignore', '--quiet', '--', relative(root, output)], {
    cwd: root,
    stdio: 'pipe'
  });
  const results: Result[] = scope.entries.map((d) => ({
    docId: d.docId,
    method: d.method,
    attempted: false,
    calls: 0,
    status: 'skipped-prerequisite',
    reason: 'NOT_EVALUATED_YET'
  }));
  const support: Result[] = [];
  const report = {
    schemaVersion: 1,
    runId,
    capturedAtUtc: new Date().toISOString(),
    completed: false,
    officialSandboxEstablished: false,
    accountEnvironment: 'real-provider-test-account-user-authorized',
    maxAttempts: 1,
    minimumSpacingMilliseconds: 350,
    requestedScopeCount: 35,
    readOptIn: options.read,
    writeOptIn: options.write,
    allowlist: [...options.allow],
    credentialStatus: {} as Record<string, unknown>,
    source: 'docs/alibaba-free-api-docs.json',
    results,
    support,
    invocations: [] as Invocation[],
    counts: {} as Record<string, number>
  };
  const persist = async () => {
    report.counts = Object.fromEntries(
      [...new Set(results.map((r) => r.status))].map((s) => [s, results.filter((r) => r.status === s).length])
    );
    await atomicWriteJson(output, report);
  };
  await persist();
  let credentials: GatewayCredentials;
  try {
    const inspected = await inspectRealCredentials(root, option('credential-file'));
    try {
      const s = await inspected.provider.status();
      report.credentialStatus = {
        source: s.source,
        configured: s.configured,
        hasAppKey: s.hasAppKey,
        hasAppSecret: s.hasAppSecret,
        hasAccessToken: s.hasAccessToken
      };
      credentials = await inspected.provider.requireCredentials();
    } finally {
      inspected.close();
    }
  } catch {
    report.credentialStatus = { configured: false };
    results.forEach((r) => {
      r.reason = 'CREDENTIALS_UNAVAILABLE_OR_EXPIRED_NO_AUTO_REFRESH';
    });
    await persist();
    console.log(JSON.stringify({ output, credentialReady: false, counts: report.counts }));
    process.exitCode = 2;
    return;
  }
  if (preflight) {
    for (const r of results) r.reason = BLOCKERS[r.method] ?? 'PREFLIGHT_ONLY_NO_NETWORK';
    report.completed = true;
    await persist();
    console.log(
      JSON.stringify({ output, credentialReady: true, networkCalls: 0, scopeCount: results.length })
    );
    return;
  }
  const snapshotPath = resolve(root, 'docs/alibaba-free-api-docs.json');
  if (!existsSync(snapshotPath)) {
    results.forEach((r) => {
      r.reason = 'FRESH_SCOPE35_DOCUMENT_SNAPSHOT_NOT_AVAILABLE';
    });
    await persist();
    console.log(JSON.stringify({ output, counts: report.counts }));
    process.exitCode = 2;
    return;
  }
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as { definitions: Definition[] };
  if (
    snapshot.definitions.length !== 35 ||
    scope.entries.some(
      (s) =>
        !snapshot.definitions.some((d) => d.docId === s.docId && d.method === s.method && d.risk === s.risk)
    )
  )
    throw new Error('SNAPSHOT_SCOPE_MISMATCH');
  const { AlibabaClient } = await import('../packages/core/src/alibaba-client');
  const { NetworkManager } = await import('../packages/core/src/network');
  const { validateCapabilityRequest, validateCapabilityResponse } =
    await import('../packages/core/src/capability-validation-lazy');
  const { FREE_API_CAPABILITY_DEFINITIONS } =
    await import('../packages/core/src/generated/free-api-capabilities');
  const openapi = JSON.parse(await readFile(resolve(root, 'openapi/one-vegetable.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const extension = object(openapi['x-free-api-capabilities']);
  for (const d of snapshot.definitions) {
    const generated = object(object(FREE_API_CAPABILITY_DEFINITIONS)[d.method]);
    if (!generated.requestSchema || JSON.stringify(extension[d.method]) !== JSON.stringify(generated))
      throw new Error('GENERATED_DEFINITION_DRIFT');
  }
  if (credentials.endpoint !== 'https://eco.taobao.com/router/rest')
    throw new Error('REAL_PROVIDER_ENDPOINT_NOT_REVIEWED');
  const network = new NetworkManager({
    policies: {
      alibaba: {
        allowedOrigins: ['https://eco.taobao.com'],
        timeoutMilliseconds: 30_000,
        maxRequestBytes: 1024 * 1024,
        maxResponseBytes: 10 * 1024 * 1024,
        redirect: 'error'
      }
    }
  });
  const sequential = new SequentialCalls();
  const receipts = new WriteReceipts(resolve(root, 'artifacts/free-api-validation/write-receipts'));
  // Access token never enters receipts; stable app fingerprint is used only for replay exclusion.
  const accountKey = fingerprint(credentials.appKey);
  let context: Context = {};
  const translationAppName = option('translation-app-name');
  if (translationAppName) context.translationAppName = translationAppName;
  let ownedProducts: number[] = [];
  const unresolvedWrites = await receipts.unresolved();
  let stopWrites = unresolvedWrites.length > 0;
  const rawRead = async (
    method: string,
    parameters: Record<string, unknown>,
    row: Result
  ): Promise<unknown> => {
    authorize(method, 'read', options);
    return execute(method, parameters, row, false);
  };
  async function execute(
    method: string,
    parameters: Record<string, unknown>,
    row: Result,
    write: boolean
  ): Promise<unknown> {
    authorize(method, write ? 'write' : 'read', options);
    const issues = await validateCapabilityRequest(method, parameters);
    row.requestShape = responseShape(parameters);
    row.requestContractIssueCount = issues.length;
    if (issues.length) {
      Object.assign(row, {
        status: 'contract-drift',
        reason: 'REQUEST_CONTRACT_INVALID_NO_DISPATCH',
        contractIssueCount: issues.length
      });
      await persist();
      return undefined;
    }
    // A persisted attempt precedes the network call. Mutation additionally has immutable fsync receipts.
    Object.assign(row, {
      attempted: true,
      calls: row.calls + 1,
      status: 'result-unknown',
      reason: 'DISPATCH_INTENT_NO_RESPONSE_YET'
    });
    const requestId = randomUUID();
    row.requestIds = [...(row.requestIds ?? []), requestId];
    const operate = object(array(object(parameters.request_param).inventory_list)[0]).operate;
    const invocation: Invocation = {
      requestId,
      method,
      phase: write ? (operate === 'plus' || operate === 'sub' ? operate : 'write') : (row.phase ?? 'read'),
      preparedAtUtc: new Date().toISOString(),
      status: 'result-unknown',
      reason: 'DISPATCH_INTENT_NO_RESPONSE_YET'
    };
    report.invocations.push(invocation);
    await persist();
    try {
      const result = await sequential.run(async () => {
        invocation.startedAtUtc = new Date().toISOString();
        await persist();
        return new AlibabaClient(credentials, network, {
          maxAttempts: 1,
          shouldRetry: () => false,
          requestId
        }).call(method, parameters);
      });
      const data = unwrap(method, result.data);
      const issues = await validateCapabilityResponse(method, data);
      Object.assign(row, assess(method, data, issues.length === 0, write), {
        responseShape: responseShape(data),
        contractIssueCount: issues.length
      });
      Object.assign(invocation, {
        status: row.status,
        reason: row.reason,
        finishedAtUtc: new Date().toISOString()
      });
      await persist();
      return data;
    } catch (error) {
      Object.assign(row, assessError(error, write));
      Object.assign(invocation, assessError(error, write), { finishedAtUtc: new Date().toISOString() });
      await persist();
      return undefined;
    }
  }
  const supportRead = async (
    method: string,
    parameters: Record<string, unknown>,
    phase = 'prerequisite-read'
  ): Promise<unknown> => {
    const row: Result = {
      docId: null,
      method,
      attempted: false,
      calls: 0,
      phase,
      status: 'skipped-prerequisite',
      reason: 'SUPPORT_READ_NOT_ENABLED'
    };
    support.push(row);
    if (!options.read || !options.allow.has(method)) {
      await persist();
      return undefined;
    }
    return rawRead(method, parameters, row);
  };
  // Only read prerequisites; no automatic credential refresh, auth challenge or creation of orders.
  if (options.read) {
    const productMethod = 'alibaba.icbu.product.list';
    if (options.allow.has(productMethod)) {
      const p = planRead(productMethod, context);
      const data = p.kind === 'call' ? await supportRead(productMethod, p.parameters) : undefined;
      if (support.at(-1)?.status === 'passed') {
        context = collectContext(productMethod, data, context);
        ownedProducts = [
          ...new Set(
            array(object(data).products)
              .map((v) => safeId(object(v).id))
              .filter((v): v is number => v !== undefined)
          )
        ];
      }
    }
    const orderMethod = 'alibaba.seller.order.list';
    if (options.allow.has(orderMethod)) {
      const p = planRead(orderMethod, context);
      const data = p.kind === 'call' ? await supportRead(orderMethod, p.parameters) : undefined;
      if (support.at(-1)?.status === 'passed') context = collectContext(orderMethod, data, context);
    }
  }
  const first = [
    'alibaba.icbu.distribution.product.query',
    'alibaba.icbu.industry.topic.list',
    'alibaba.seller.vendor.order.list'
  ];
  const definitions = [...snapshot.definitions].sort((a, b) => {
    const rank = (d: Definition) =>
      d.risk === 'mutation' ? 200 : first.includes(d.method) ? first.indexOf(d.method) : 100;
    return rank(a) - rank(b);
  });
  for (const d of definitions) {
    const row = results.find((r) => r.docId === d.docId);
    if (!row) throw new Error('SCOPE_RESULT_MISSING');
    if (d.risk === 'read') {
      const plan = planRead(d.method, context);
      if (plan.kind === 'skip') row.reason = plan.reason;
      else if (!options.read || !options.allow.has(d.method)) row.reason = 'READ_OR_METHOD_OPT_IN_MISSING';
      else {
        const data = await rawRead(d.method, plan.parameters, row);
        if (row.status === 'passed') context = collectContext(d.method, data, context);
      }
    } else if (!options.write || !options.allow.has(d.method)) {
      row.reason = `${BLOCKERS[d.method] ?? 'Individually authorized write required.'} WRITE_OR_METHOD_OPT_IN_MISSING`;
    } else if (stopWrites) {
      row.reason = 'PRIOR_WRITE_RESULT_UNKNOWN_MANUAL_RECONCILIATION_REQUIRED';
    } else {
      row.reason = BLOCKERS[d.method] ?? 'MISSING_REVIEWED_BUSINESS_PREREQUISITES';
      try {
        if (d.method === 'alibaba.dropshipping.token.create') {
          const receipt = await receipts.begin(d.method, accountKey);
          await execute(d.method, {}, row, true);
          await receipt.record('result', { status: row.status, reason: row.reason });
        } else if (d.method === 'alibaba.icbu.product.inventory.update') {
          const readMethod = 'alibaba.icbu.product.sku.inventory.get';
          if (!options.allow.has(readMethod)) row.reason = 'SKU_INVENTORY_READBACK_NOT_ALLOWLISTED';
          else {
            let baseline: InventoryCell[] | null = null;
            let target: number | undefined;
            for (const productId of ownedProducts.slice(0, 10)) {
              const data = await supportRead(readMethod, { product_id: productId, language: 'en_US' });
              const candidate = support.at(-1)?.status === 'passed' ? inventoryCells(data) : null;
              if (candidate?.length) {
                baseline = candidate;
                target = productId;
                break;
              }
            }
            if (!baseline?.length || !target)
              row.reason = 'NO_KNOWN_VALID_SKU_WAREHOUSE_BASELINE_IN_OWNED_PRODUCT_SAMPLE';
            else {
              const receipt = await receipts.begin(
                d.method,
                [accountKey, target, baseline.map((c) => [c.skuId, c.code])],
                { productId: target, baseline }
              );
              const read = async (phase: 'baseline' | 'after-plus' | 'after-sub') => {
                const data = await supportRead(
                  readMethod,
                  { product_id: target, language: 'en_US' },
                  `inventory-${phase}`
                );
                return support.at(-1)?.status === 'passed' ? inventoryCells(data) : null;
              };
              const outcome = await inventoryRoundTrip({
                baseline,
                read,
                record: receipt.record,
                write: async (operate, cell) => {
                  const data = await execute(
                    d.method,
                    {
                      request_param: {
                        product_id: target,
                        inventory_list: [
                          { sku_id: cell.skuId, inventory_code: cell.code, inventory: 1, operate }
                        ]
                      }
                    },
                    row,
                    true
                  );
                  const acknowledgement = object(object(data).result);
                  const requestId = row.requestIds?.at(-1);
                  return {
                    status: row.status,
                    reason: row.reason,
                    businessSuccess: acknowledgement.success === true,
                    businessDataTrue: acknowledgement.data === true || acknowledgement.data === 'true',
                    ...(requestId ? { requestId } : {})
                  };
                }
              });
              Object.assign(row, outcome);
              await receipt.record('cycle-result', outcome);
            }
          }
        } else if (d.method === 'alibaba.icbu.video.upload' && option('video-manifest')) {
          const manifestPath = resolve(root, option('video-manifest') ?? '');
          const rel = relative(resolve(root, 'artifacts'), manifestPath);
          if (rel.startsWith('..') || isAbsolute(rel))
            throw new Error('MANIFEST_MUST_BE_IN_IGNORED_ARTIFACTS');
          const media = await readOwnedVideoManifest(manifestPath);
          if (!media) row.reason = 'MEDIA_OWNERSHIP_STORAGE_ATTESTATION_INVALID';
          else {
            const receipt = await receipts.begin(d.method, [accountKey, media.sha256]);
            await execute(d.method, { video_path: media.url, video_name: media.name }, row, true);
            // Upload acknowledges queueing only. No association, publish or deletion is implied.
            if (row.status === 'passed') {
              row.status = 'result-unknown';
              row.reason = 'UPLOAD_ACKNOWLEDGED_REQUIRES_PUBLIC_VIDEO_QUERY_READBACK';
            }
            await receipt.record('result', { status: row.status, reason: row.reason });
          }
        }
      } catch (error) {
        const duplicate = object(error).code === 'EEXIST';
        Object.assign(row, {
          status: row.attempted ? 'result-unknown' : 'skipped-prerequisite',
          reason: duplicate
            ? 'EXISTING_WRITE_INTENT_NO_REPLAY_RECONCILE_RECEIPTS'
            : 'LOCAL_WRITE_GUARD_FAILURE_NO_AUTOMATIC_RECOVERY'
        });
      }
      if (row.status === 'result-unknown') stopWrites = true;
    }
    await persist();
    console.log(`${d.docId} ${d.method}: ${row.status}`);
  }
  report.completed = true;
  await persist();
  console.log(
    JSON.stringify({
      output,
      counts: report.counts,
      networkCalls: [...results, ...support].reduce((sum, r) => sum + r.calls, 0)
    })
  );
  if (
    results.some((r) => ['provider-error', 'contract-drift', 'result-unknown'].includes(r.status)) ||
    support.some((r) => ['provider-error', 'contract-drift', 'result-unknown'].includes(r.status))
  )
    process.exitCode = 1;
}
try {
  await main();
} catch (error) {
  // Never print raw exception/stack: provider exceptions may contain credentials or response bodies.
  const known = [
    'UNKNOWN_OPTION',
    'DUPLICATE_OPTION',
    'UNKNOWN_ALLOWLIST_METHOD',
    'WRITE_REQUIRES_READBACK_OPT_IN',
    'SCOPE_MUST_CONTAIN_35_UNIQUE_IDENTITIES',
    'SNAPSHOT_SCOPE_MISMATCH',
    'GENERATED_DEFINITION_DRIFT',
    'REAL_PROVIDER_ENDPOINT_NOT_REVIEWED',
    'SCOPE_RESULT_MISSING'
  ];
  const code =
    error instanceof Error && known.includes(error.message) ? error.message : 'LOCAL_READINESS_OR_IO_FAILURE';
  console.error(`FREE_API_SMOKE_LOCAL_FAILURE:${code}; no automatic refresh, retry or recovery.`);
  process.exitCode = 2;
}
