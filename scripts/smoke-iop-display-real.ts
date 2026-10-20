/** Bounded IOP-only display lifecycle acceptance; never imports into the active workbench. */
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AlibabaClient } from '../packages/core/src/alibaba-client';
import { ProductAdapter } from '../packages/core/src/product-adapter';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import {
  createIopBusinessRequest,
  normalizeIopBusinessResponse
} from '../packages/core/src/alibaba-iop-business';
import { IOP_BUSINESS_ENDPOINT, isRecord } from '../packages/core/src/alibaba-iop';
import { NativeFetchTransport, NetworkManager } from '../packages/core/src/network';
import { normalizeGatewayError } from '../packages/core/src/errors';
import {
  createProductOperationContext,
  assertProductOperationContext
} from '../packages/core/src/product-operation-context';
import { openNodeDatabase, applyNodeMigrations } from '../apps/api/src/db/node-database';
import { SqlProductMutationJobRepository } from '../apps/api/src/product-mutations/repository';
import {
  ProductMutationLifecycleService,
  type ProductMutationGateway
} from '../apps/api/src/product-mutations/service';
import { atomicWriteJson } from './openapi-auth/storage';

const args = process.argv.slice(2);
const value = (key: string) => args.find((arg) => arg.startsWith(key))?.slice(key.length) ?? '';
if (
  args.length !== 4 ||
  !args.some((arg) =>
    ['--read-only', '--confirm-real-write', '--recover-existing', '--verify-existing'].includes(arg)
  ) ||
  ['--credential=', '--receipt=', '--product-id='].some(
    (key) => args.filter((arg) => arg.startsWith(key)).length !== 1
  )
)
  throw new Error('EXPLICIT_TARGET_AND_MODE_REQUIRED');
const productId = value('--product-id=');
if (!/^[1-9][0-9]*$/u.test(productId) || !Number.isSafeInteger(Number(productId)))
  throw new Error('INVALID_TARGET');
const receipt = resolve(value('--receipt='));
if (!receipt.startsWith(resolve('artifacts') + sep)) throw new Error('IGNORED_RECEIPT_REQUIRED');
await mkdir(dirname(receipt), { recursive: true });
const recoveringExisting = args.includes('--recover-existing');
const verifyingExisting = args.includes('--verify-existing');
if (!verifyingExisting) {
  const claim = await open(receipt + (recoveringExisting ? '.recovery-claim' : '.claim'), 'wx', 0o600);
  await claim.close();
}
const bundle = parseAlibabaOpenApiCredentialBundle(
  JSON.parse(await readFile(resolve(value('--credential=')), 'utf8')) as unknown
);
if (
  bundle.protocol !== 'iop' ||
  (bundle.oauth.expiresAtUtc !== null && Date.parse(bundle.oauth.expiresAtUtc) < Date.now() + 600000)
)
  throw new Error('VALID_IOP_REQUIRED');
const credentials = {
  protocol: 'iop' as const,
  appKey: bundle.application.appKey,
  appSecret: bundle.application.appSecret,
  accessToken: bundle.oauth.accessToken,
  endpoint: IOP_BUSINESS_ENDPOINT,
  signMethod: 'hmac-sha256' as const
};
const actor = {
  actorId: 'isolated-iop-display-acceptance',
  username: 'acceptance',
  role: 'admin',
  source: 'bff'
} as const;
const productContext = await createProductOperationContext(actor.actorId, credentials);
const report = {
  runId: crypto.randomUUID() as string,
  productId,
  protocol: 'iop',
  status: 'prepared',
  baseline: null as string | null,
  writes: 0,
  reads: 0,
  configurationChanged: false,
  events: [] as Record<string, unknown>[]
};
if (recoveringExisting || verifyingExisting) {
  const saved: unknown = JSON.parse(await readFile(receipt, 'utf8'));
  if (
    !isRecord(saved) ||
    saved.productId !== productId ||
    saved.protocol !== 'iop' ||
    (recoveringExisting && (saved.status !== 'stopped-requires-review' || saved.writes !== 1)) ||
    typeof saved.writes !== 'number' ||
    saved.writes < 1 ||
    saved.writes > 2 ||
    !['online', 'offline'].includes(String(saved.baseline)) ||
    !Array.isArray(saved.events) ||
    typeof saved.reads !== 'number' ||
    typeof saved.runId !== 'string'
  )
    throw new Error('RECOVERY_RECEIPT_REQUIRED');
  report.runId = saved.runId;
  report.baseline = String(saved.baseline);
  report.writes = saved.writes;
  report.reads = saved.reads;
  report.events = saved.events.filter(isRecord);
}
const persist = () => atomicWriteJson(receipt, report);
await persist();
const native = new NativeFetchTransport();
let lastRequest = 0;
const method = 'alibaba.icbu.product.batch.update.display';
const network = new NetworkManager({
  transport: {
    async send(input, init) {
      const request = new Request(input, init),
        url = new URL(request.url);
      if (
        url.origin !== 'https://openapi-api.alibaba.com' ||
        request.method !== 'POST' ||
        url.search ||
        !['/rest/alibaba/icbu/product/list', '/rest/icbu/product/update/display'].includes(url.pathname)
      )
        throw new Error('BOUNDED_IOP_DISPLAY_ONLY');
      if (url.pathname.endsWith('/display')) {
        if (args.includes('--read-only') || verifyingExisting || report.writes >= 2)
          throw new Error('NO_MUTATION_RETRY');
        report.writes += 1;
      } else if (++report.reads > 80) throw new Error('READ_BOUND_EXCEEDED');
      await persist();
      await delay(Math.max(0, 350 - (Date.now() - lastRequest)));
      lastRequest = Date.now();
      return native.send(input, init);
    }
  },
  policies: {
    alibaba: { allowedOrigins: ['https://openapi-api.alibaba.com'], redirect: 'error', cache: 'no-store' }
  }
});
const client = new AlibabaClient(credentials, network, { maxAttempts: 1 });
const adapter = new ProductAdapter({
  protocol: 'iop',
  call: async (target, parameters) => {
    if (target !== method) return client.call(target, parameters);
    const signed = await createIopBusinessRequest(credentials, target, parameters);
    const response = await network.request({
      service: 'alibaba',
      url: signed.url,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(signed.parameters),
      responseType: 'json',
      requestId: crypto.randomUUID()
    });
    const body = isRecord(response.data) ? response.data : {};
    const result = isRecord(body.result) ? body.result : {};
    report.events.push({
      phase: 'response-shape',
      keys: Object.keys(body),
      code: body.code,
      resultType: typeof body.result,
      resultKeys: Object.keys(result),
      failureMapType: typeof result.fail_id_map,
      errorCode: result.error_code,
      traceId: result.trace_id
    });
    await persist();
    return {
      method: target,
      requestId: response.requestId,
      data: normalizeIopBusinessResponse(response.data, target, credentials)
    };
  }
});
const database = openNodeDatabase(receipt + '.sqlite');
applyNodeMigrations(database);
const repository = new SqlProductMutationJobRepository(database.executor);
const unsupported = () => Promise.reject(new Error('ACCEPTANCE_METHOD_FORBIDDEN'));
const gateway: ProductMutationGateway = {
  publish: unsupported,
  saveDraft: unsupported,
  update: unsupported,
  get: unsupported,
  render: unsupported,
  assertProductContext: (expected) => {
    assertProductOperationContext(expected, productContext);
    return Promise.resolve();
  },
  list: async (query, _requestId, options) => {
    if (query.productId !== productId || query.page !== 1 || query.pageSize !== 1 || !options?.productContext)
      throw new Error('EXACT_TARGET_CONTEXT_REQUIRED');
    assertProductOperationContext(options.productContext, productContext);
    return adapter.list(query);
  },
  updateDisplay: async (request, requestId, options) => {
    if (
      !options?.productContext ||
      request.protocol !== 'iop' ||
      request.productIds.length !== 1 ||
      request.productIds[0] !== productId
    )
      throw new Error('EXACT_TARGET_CONTEXT_REQUIRED');
    assertProductOperationContext(options.productContext, productContext);
    const stored = await repository.findBlocking(productId);
    if (
      !stored ||
      (report.writes === 0
        ? stored.status !== 'submitted'
        : stored.status !== 'recovering' || stored.recoveryRequestId !== requestId)
    )
      throw new Error('DURABLE_INTENT_REQUIRED');
    return adapter.updateDisplay(request);
  }
};
const lifecycle = new ProductMutationLifecycleService(repository, gateway);
const read = async () => {
  const page = await gateway.list(
    { page: 1, pageSize: 1, productId, language: 'en_US' },
    crypto.randomUUID(),
    { productContext }
  );
  if (
    page.items.length !== 1 ||
    page.items[0]?.id !== productId ||
    /dont[- ]?edit/iu.test(page.items[0].subject)
  )
    throw new Error('TARGET_NOT_CONFIRMED');
  return page.items[0];
};
const event = async (phase: string, details: Record<string, unknown>) => {
  report.events.push({ phase, atUtc: new Date().toISOString(), ...details });
  await persist();
  process.stdout.write(JSON.stringify({ phase, ...details }) + '\n');
};
const waitFor = async (display: string) => {
  for (let attempt = 0; attempt < 30; attempt++) {
    const product = await read();
    await event('readback', { status: product.status, expected: display });
    if (product.status === display) return;
    if (!['online', 'offline'].includes(product.status)) throw new Error('PLATFORM_REVIEW_STOP');
    await delay(5000);
  }
  throw new Error('READBACK_PENDING_NO_RETRY');
};
try {
  if (verifyingExisting) {
    await event('recovery-observed', { display: (await read()).status });
    const jobs = await repository.list({ page: 1, pageSize: 10, productId });
    const current = jobs.items[0];
    if (!current?.recoveryRequestId || current.originalDisplay !== report.baseline)
      throw new Error('RECOVERY_TASK_REQUIRED');
    const refreshed = await lifecycle.refresh({
      actor,
      requestId: crypto.randomUUID(),
      id: current.id,
      expectedRevision: current.revision
    });
    report.status =
      refreshed.status === 'recovered' ? 'restored-after-unconfirmed-response' : 'recovery-pending-platform';
    await event('recovery-readback', { status: refreshed.status, writes: report.writes });
  } else if (recoveringExisting) {
    const existing = await repository.findBlocking(productId);
    if (
      !existing?.productContext ||
      existing.protocol !== 'iop' ||
      existing.originalDisplay !== report.baseline ||
      existing.recoveryRequestId
    )
      throw new Error('RECOVERY_TASK_REQUIRED');
    assertProductOperationContext(existing.productContext, productContext);
    try {
      await lifecycle.recover({
        actor,
        requestId: crypto.randomUUID(),
        id: existing.id,
        expectedRevision: existing.revision
      });
    } catch (cause) {
      const error = normalizeGatewayError(cause);
      await event('recovery-response-unconfirmed', { code: error.code });
    }
    if (!report.baseline) throw new Error('BASELINE_REQUIRED');
    await waitFor(report.baseline);
    const current = await repository.get(existing.id);
    if (!current) throw new Error('MISSING_TASK');
    const recovered = await lifecycle.refresh({
      actor,
      requestId: crypto.randomUUID(),
      id: existing.id,
      expectedRevision: current.revision
    });
    if (recovered.status !== 'recovered') throw new Error('RECOVERY_NOT_CONFIRMED');
    report.status = 'restored-after-unconfirmed-response';
    await event('restored', { status: recovered.status, writes: report.writes });
  } else {
    const baseline = await read();
    if (baseline.status !== 'online' && baseline.status !== 'offline')
      throw new Error('STABLE_BASELINE_REQUIRED');
    report.baseline = baseline.status;
    await event('baseline', { status: baseline.status, encryptedIdPresent: Boolean(baseline.encryptedId) });
    if (args.includes('--read-only')) report.status = 'read-only-passed';
    else {
      const target = baseline.status === 'online' ? 'offline' : 'online';
      const submission = await lifecycle.submitDisplay({
        actor,
        requestId: crypto.randomUUID(),
        protocol: 'iop',
        options: { productContext },
        request: { protocol: 'iop', productIds: [productId], encryptedProductIds: [], display: target }
      });
      const job = submission.jobs[0];
      if (job?.protocol !== 'iop' || job.status !== 'verifying') throw new Error('IOP_RECEIPT_REQUIRED');
      await event('accepted', {
        jobId: job.id,
        requestId: job.requestId,
        status: job.status,
        traceId: job.traceId
      });
      await waitFor(target);
      await event('target-confirmed', { status: target });
      const recovering = await lifecycle.recover({
        actor,
        requestId: crypto.randomUUID(),
        id: job.id,
        expectedRevision: job.revision
      });
      await event('recovery-accepted', {
        status: recovering.status,
        recoveryRequestId: recovering.recoveryRequestId,
        traceId: recovering.traceId
      });
      await waitFor(baseline.status);
      const recovered = await new ProductMutationLifecycleService(
        new SqlProductMutationJobRepository(database.executor),
        gateway
      ).refresh({ actor, requestId: crypto.randomUUID(), id: job.id, expectedRevision: recovering.revision });
      if (recovered.status !== 'recovered' || report.writes !== 2) throw new Error('RECOVERY_NOT_CONFIRMED');
      report.status = 'passed';
      await event('restored', { status: recovered.status, display: baseline.status, writes: report.writes });
    }
  }
} catch (cause) {
  const error = normalizeGatewayError(cause);
  report.status = report.writes ? 'stopped-requires-review' : 'failed-before-write';
  await event('stopped', {
    code: error.code,
    subCode: error.subCode ?? null,
    traceId: error.traceId ?? null
  });
} finally {
  await persist();
  database.connection.close();
  process.stdout.write(JSON.stringify({ receipt, status: report.status, writes: report.writes }) + '\n');
  if (!['passed', 'read-only-passed', 'restored-after-unconfirmed-response'].includes(report.status))
    process.exitCode = 1;
}
