/** One explicitly selected test product; two writes at most, no retry or automatic compensation. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, open, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { ProductBatchMaintenanceRunner } from '../packages/core/src/product-batch-runner';
import {
  previewProductBatchMaintenance,
  productBatchTargetFingerprint
} from '../packages/core/src/product-batch-maintenance';
import { ExtensionProductMutationJobClient } from '../packages/core/src/product-mutation-job-extension';
import { requireProductOperationContext } from '../packages/core/src/product-operation-context';
import {
  createProductMutationFingerprints,
  compareProductMutationFingerprints
} from '../packages/core/src/product-mutation-fingerprint';
import {
  parseProductSchemaXml,
  inspectProductSchemaPatchSerialization
} from '../packages/core/src/product-schema';
import { GatewayException } from '../packages/core/src/errors';
import type { GatewayClient, RequestOf, ResponseOf, OperationId } from '../packages/core/src/types';
import { buildDigest } from './smoke-iop-workbench-real';
import { atomicWriteJson } from './openapi-auth/storage';
import { installNodeXmlDomGlobals } from './node-xml-dom';

const METHODS = new Set([
  'alibaba.icbu.product.list',
  'alibaba.icbu.product.group.get',
  'alibaba.icbu.product.schema.render',
  'alibaba.icbu.product.schema.update'
]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseBatchOptions(args: readonly string[]): { credential: string; productId: string } {
  const credential = args.filter((a) => a.startsWith('--credential='));
  const products = args.filter((a) => a.startsWith('--product-id='));
  if (
    credential.length !== 1 ||
    products.length !== 1 ||
    args.filter((a) => a === '--confirm-change-and-restore').length !== 1 ||
    args.some(
      (a) =>
        !a.startsWith('--credential=') &&
        !a.startsWith('--product-id=') &&
        a !== '--confirm-change-and-restore'
    )
  )
    throw new Error('BATCH_ACCEPTANCE_ARGUMENTS_REQUIRED');
  const path = credential[0]?.slice('--credential='.length).trim();
  const productId = products[0]?.slice('--product-id='.length);
  if (!path || !productId || !/^[1-9][0-9]*$/u.test(productId) || !Number.isSafeInteger(Number(productId)))
    throw new Error('BATCH_ACCEPTANCE_ARGUMENTS_REQUIRED');
  return { credential: path, productId };
}
export function batchWireAllowed(url: string, body: string, target: string): boolean {
  if (url !== 'https://eco.taobao.com/router/rest') return false;
  const values = new URLSearchParams(body);
  const method = values.get('method');
  if (!method || !METHODS.has(method)) return false;
  if (method === 'alibaba.icbu.product.group.get') return true;
  if (method === 'alibaba.icbu.product.list')
    return values.get('id') === target && values.get('page_size') === '1';
  try {
    const payload: unknown = JSON.parse(values.get('param_product_top_publish_request') ?? 'null');
    if (!isRecord(payload) || String(payload.product_id) !== target) return false;
    if (method === 'alibaba.icbu.product.schema.update') {
      if (typeof payload.xml !== 'string') return false;
      const roots = parseProductSchemaXml(payload.xml)
        .fields.map((field) => field.id)
        .toSorted();
      return roots.join(',') === 'productGroup,productKeywords';
    }
    return true;
  } catch {
    return false;
  }
}

/** A pending write keeps its claim across process exits; never silently start a fresh profile. */
export async function claimBatchAcceptance(
  root: string,
  productId: string,
  appKey: string,
  reportPath: string
): Promise<() => Promise<void>> {
  const claims = resolve(root, 'claims');
  await mkdir(claims, { recursive: true });
  const scope = createHash('sha256')
    .update(JSON.stringify([appKey, productId]))
    .digest('hex');
  const path = resolve(claims, `${scope}.json`);
  const handle = await open(path, 'wx').catch(() => {
    throw new Error('PREVIOUS_BATCH_REQUIRES_READONLY_RECONCILIATION');
  });
  try {
    await handle.writeFile(JSON.stringify({ reportPath, createdAtUtc: new Date().toISOString() }));
    await handle.sync();
  } finally {
    await handle.close();
  }
  return () => unlink(path);
}

export async function main(args: readonly string[]): Promise<void> {
  const options = parseBatchOptions(args);
  installNodeXmlDomGlobals();
  const bundle = parseAlibabaOpenApiCredentialBundle(
    JSON.parse(await readFile(resolve(options.credential), 'utf8')) as unknown
  );
  if (bundle.protocol === 'iop') throw new Error('TOP_ACCEPTANCE_REQUIRED');
  const outputRoot = resolve('artifacts/extension-batch-maintenance');
  await mkdir(outputRoot, { recursive: true });
  const folder = await mkdtemp(resolve(outputRoot, `${randomUUID()}-`));
  const reportPath = resolve(folder, 'report.json');
  const extension = resolve(folder, 'extension');
  const source = resolve('apps/extension/.output/chrome-mv3');
  const digest = await buildDigest(source);
  await cp(source, extension, { recursive: true, errorOnExist: true, force: false });
  if ((await buildDigest(extension)) !== digest || (await buildDigest(source)) !== digest)
    throw new Error('BUILD_CHANGED');
  const report: Record<string, unknown> = {
    productId: options.productId,
    checkedAtUtc: new Date().toISOString(),
    stage: 'initializing',
    buildSha256: digest,
    manifestChanged: false,
    activeConfigurationChanged: false,
    writes: 0,
    restored: false,
    untouchedFieldsMatched: false
  };
  let armed: { operation: OperationId; requestId: string } | null = null;
  let lastWire = 0;
  let queue: Promise<void> = Promise.resolve();
  let writes = 0;
  let releaseClaim: (() => Promise<void>) | null = null;
  const context = await chromium.launchPersistentContext(resolve(folder, 'profile'), {
    headless: false,
    locale: 'zh-CN',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const persist = () => atomicWriteJson(reportPath, { ...report, writes });
  try {
    await context.addInitScript({ content: 'globalThis.__name = value => value;' });
    await context.route(/^https?:\/\//u, async (route) => {
      const request = route.request();
      const current = armed;
      if (
        !current ||
        !request.serviceWorker() ||
        request.method() !== 'POST' ||
        request.headers()['x-request-id'] !== current.requestId ||
        !batchWireAllowed(request.url(), request.postData() ?? '', options.productId)
      ) {
        await route.abort('blockedbyclient');
        return;
      }
      const mutation =
        new URLSearchParams(request.postData() ?? '').get('method') === 'alibaba.icbu.product.schema.update';
      const previous = queue;
      let release: () => void = () => undefined;
      queue = new Promise<void>((done) => {
        release = done;
      });
      await previous;
      try {
        await delay(Math.max(0, 350 - (Date.now() - lastWire)));
        if (armed !== current || (mutation && (current.operation !== 'updateProduct' || writes >= 2))) {
          await route.abort('blockedbyclient');
          return;
        }
        if (mutation) {
          writes++;
          // This durable sent/unknown marker must precede the actual network request.
          await persist();
        }
        lastWire = Date.now();
        await route.continue();
        await request.response();
      } finally {
        release();
      }
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await worker.evaluate('globalThis.__name = value => value;');
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#/settings`);
    async function send(message: Record<string, unknown>): Promise<unknown> {
      return page.evaluate(
        (value) =>
          (
            globalThis as unknown as {
              chrome: { runtime: { sendMessage(input: unknown): Promise<unknown> } };
            }
          ).chrome.runtime.sendMessage(value),
        message
      );
    }
    function data(response: unknown, requestId: string): unknown {
      if (!isRecord(response) || response.requestId !== requestId || typeof response.ok !== 'boolean')
        throw new Error('RUNTIME_ENVELOPE_INVALID');
      if (!response.ok) {
        const error = isRecord(response.error) ? response.error : {};
        const code = typeof error.code === 'string' ? error.code : 'RUNTIME_FAILURE';
        throw new GatewayException({ code, message: code, retryable: false });
      }
      return response.data;
    }
    const vaultId = randomUUID();
    data(
      await send({
        kind: 'credential-vault-request',
        operation: 'create',
        requestId: vaultId,
        payload: {
          passphrase: randomBytes(32).toString('base64url'),
          settings: {
            protocol: 'top',
            endpoint: 'https://eco.taobao.com/router/rest',
            signMethod: 'hmac',
            appKey: bundle.application.appKey,
            appSecret: bundle.application.appSecret,
            accessToken: bundle.oauth.accessToken
          }
        }
      }),
      vaultId
    );
    const gateway: GatewayClient = {
      productOperationContext: async () => {
        const requestId = randomUUID();
        return requireProductOperationContext(
          data(await send({ kind: 'product-operation-context', requestId }), requestId)
        );
      },
      request: async <K extends OperationId>(
        operation: K,
        payload: RequestOf<K>,
        callOptions?: Parameters<GatewayClient['request']>[2]
      ): Promise<ResponseOf<K>> => {
        const requestId = callOptions?.requestId ?? randomUUID();
        const mutation = operation === 'updateProduct';
        if (mutation) {
          report.stage = writes === 0 ? 'change-sending' : 'restore-sending';
          await persist();
        }
        armed = { operation, requestId };
        try {
          return data(
            await send({
              kind: 'gateway-request',
              requestId,
              operation,
              payload,
              ...callOptions,
              ...(mutation
                ? {
                    productMutationFingerprint: await createProductMutationFingerprints(
                      (payload as RequestOf<'updateProduct'>).schemaPatchXml
                    )
                  }
                : {})
            }),
            requestId
          ) as ResponseOf<K>;
        } finally {
          armed = null;
        }
      }
    };
    const jobs = new ExtensionProductMutationJobClient(
      { send: (message) => send({ ...message }) },
      {
        compare: async (job) => {
          if (!job.categoryId || !job.productContext) throw new Error('PERSISTED_CONTEXT_REQUIRED');
          const xml = await gateway.request(
            'renderProductSchema',
            { productId: job.productId, categoryId: job.categoryId, language: 'en_US' },
            { productContext: job.productContext }
          );
          return compareProductMutationFingerprints(xml.xml, job.fieldExpectations);
        }
      }
    );
    const pageResult = await gateway.request('listProducts', {
      productId: options.productId,
      page: 1,
      pageSize: 1,
      language: 'en_US'
    });
    const product = pageResult.items.find((item) => item.id === options.productId);
    if (
      !product?.categoryId ||
      !['online', 'offline'].includes(product.status) ||
      !/one.?vegetable/iu.test(product.subject) ||
      /dont-edit/iu.test(product.subject)
    )
      throw new Error('EXPLICIT_TEST_PRODUCT_REQUIRED');
    const groups = await gateway.request('listProductGroups', {});
    const schema = await gateway.request('renderProductSchema', {
      productId: product.id,
      categoryId: product.categoryId,
      language: 'en_US'
    });
    const probe = await previewProductBatchMaintenance(schema.xml, {
      groupPath: [{ id: groups[0]?.id ?? 0, name: '' }],
      keywords: { action: 'remove', values: ['not-present-probe'] }
    });
    if (probe.status === 'unsupported' || !probe.before.keywords.length)
      throw new Error('REVERSIBLE_BASELINE_REQUIRED');
    const targetGroup = groups.find(
      (group) => /test/iu.test(group.name) && !probe.before.groups.includes(String(group.id))
    );
    if (!targetGroup) throw new Error('EXISTING_TEST_GROUP_REQUIRED');
    const firstKeyword = probe.before.keywords[0];
    if (!firstKeyword) throw new Error('REVERSIBLE_BASELINE_REQUIRED');
    const nextKeywords =
      probe.before.keywords.length > 1 ? [...probe.before.keywords].reverse() : [firstKeyword + ' outdoor'];
    if (probe.before.keywords.length === 1 && !/outdoor/iu.test(product.subject))
      throw new Error('RELATED_TEST_KEYWORD_REQUIRED');
    const expected = await createProductMutationFingerprints(schema.xml);
    await atomicWriteJson(resolve(folder, 'baseline.json'), {
      productId: product.id,
      categoryId: product.categoryId,
      rootIds: probe.rootIds,
      fingerprint: probe.baseline,
      groups: probe.before.groups,
      keywords: probe.before.keywords,
      fieldExpectations: expected.fieldExpectations
    });
    releaseClaim = await claimBatchAcceptance(outputRoot, product.id, bundle.application.appKey, reportPath);
    const runner = new ProductBatchMaintenanceRunner({
      gateway,
      jobs,
      products: [product],
      language: 'en_US'
    });
    await runner.preview({
      groupPath: [{ id: targetGroup.id, name: targetGroup.name }],
      keywords: { action: 'replace', values: nextKeywords }
    });
    if (runner.items[0]?.state !== 'ready' || runner.items[0].preview?.baseline !== probe.baseline)
      throw new Error('BASELINE_CONFLICT');
    await runner.execute();
    const changed = runner.items[0];
    report.change = {
      batchId: runner.batchId,
      jobId: changed.job?.id,
      requestId: changed.requestId,
      state: changed.state,
      reasonCode: changed.job?.reasonCode
    };
    await persist();
    if (changed.state !== 'verified' || !changed.job) throw new Error('CHANGE_PENDING_NO_COMPENSATION');
    const productContext = requireProductOperationContext(changed.job.productContext);
    const current = await gateway.request(
      'renderProductSchema',
      { productId: product.id, categoryId: product.categoryId, language: 'en_US' },
      { productContext }
    );
    if (!(await compareProductMutationFingerprints(current.xml, changed.job.fieldExpectations)).matched)
      throw new Error('TARGET_CHANGED_NO_COMPENSATION');
    const originalModel = parseProductSchemaXml(schema.xml);
    const currentModel = parseProductSchemaXml(current.xml);
    const rootSet = new Set(probe.rootIds);
    const nextModel = {
      ...currentModel,
      fields: currentModel.fields.map((field) => {
        if (!rootSet.has(field.id)) return field;
        const original = originalModel.fields.find((old) => old.id === field.id);
        if (!original) throw new Error('ORIGINAL_FIELD_MISSING');
        return { ...original, key: field.key };
      }),
      touchedFieldKeys: currentModel.fields.filter((field) => rootSet.has(field.id)).map((field) => field.key)
    };
    const patch = inspectProductSchemaPatchSerialization(nextModel);
    if (
      !patch.safe ||
      patch.changedFieldKeys.length !== 2 ||
      !(
        await compareProductMutationFingerprints(
          patch.xml,
          expected.fieldExpectations.filter((field) => rootSet.has(field.fieldId))
        )
      ).matched
    )
      throw new Error('ORIGINAL_FIELD_PATCH_INVALID');
    const restored = await gateway.request(
      'updateProduct',
      { productId: product.id, categoryId: product.categoryId, language: 'en_US', schemaPatchXml: patch.xml },
      { productContext, productBatchId: randomUUID() }
    );
    if (!restored.job) throw new Error('RESTORE_RECEIPT_MISSING');
    report.restore = {
      jobId: restored.job.id,
      requestId: restored.job.requestId,
      traceId: restored.job.traceId
    };
    await persist();
    let job = restored.job;
    for (let attempt = 0; attempt < 30 && job.status !== 'verified'; attempt++) {
      await delay(10_000);
      job = await jobs.refresh(job.id, job.revision);
      if (job.status === 'failed' || job.status === 'recovery-required') break;
    }
    if (job.status !== 'verified') throw new Error('RESTORE_PENDING_READONLY_ONLY');
    const final = await gateway.request(
      'renderProductSchema',
      { productId: product.id, categoryId: product.categoryId, language: 'en_US' },
      { productContext: requireProductOperationContext(job.productContext) }
    );
    report.restored = (await productBatchTargetFingerprint(final.xml, probe.rootIds)) === probe.baseline;
    report.untouchedFieldsMatched = (
      await compareProductMutationFingerprints(
        final.xml,
        expected.fieldExpectations.filter((field) => !rootSet.has(field.fieldId))
      )
    ).matched;
    report.stage =
      report.restored && report.untouchedFieldsMatched ? 'restored-and-confirmed' : 'baseline-not-matched';
    if (report.stage !== 'restored-and-confirmed') process.exitCode = 1;
  } catch (error) {
    const code =
      error instanceof GatewayException
        ? error.gatewayError.code
        : error instanceof Error
          ? error.message
          : 'UNKNOWN';
    report.errorCode = /^[A-Za-z0-9_.:;-]{1,160}$/u.test(code) ? code : 'ERROR_REDACTED';
    process.exitCode = 1;
  } finally {
    await persist();
    if (releaseClaim && (writes === 0 || report.stage === 'restored-and-confirmed')) await releaseClaim();
    await context.close();
    console.log(JSON.stringify({ ...report, writes, reportPath }));
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch {
    console.error('BATCH_ACCEPTANCE_SETUP_FAILED');
    process.exitCode = 1;
  }
}
