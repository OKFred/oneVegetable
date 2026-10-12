/** Read-only baseline reconciliation. Never rebinds an old receipt or restores a product. */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { AlibabaClient } from '../packages/core/src/alibaba-client';
import { normalizeGatewayError } from '../packages/core/src/errors';
import { ProductAdapter } from '../packages/core/src/product-adapter';
import { productBatchTargetFingerprint } from '../packages/core/src/product-batch-maintenance';
import { NativeFetchTransport, NetworkManager, type NetworkTransport } from '../packages/core/src/network';
import { atomicWriteJson } from './openapi-auth/storage';
import { installNodeXmlDomGlobals } from './node-xml-dom';

interface Baseline {
  productId: string;
  categoryId: number;
  rootIds: string[];
  fingerprint: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseBaseline(value: unknown): Baseline {
  if (
    !record(value) ||
    typeof value.productId !== 'string' ||
    !/^[1-9][0-9]*$/u.test(value.productId) ||
    !Number.isSafeInteger(Number(value.productId)) ||
    typeof value.categoryId !== 'number' ||
    !Number.isSafeInteger(value.categoryId) ||
    value.categoryId <= 0 ||
    !Array.isArray(value.rootIds) ||
    value.rootIds.length !== 2 ||
    !value.rootIds.every((id: unknown) => id === 'productGroup' || id === 'productKeywords') ||
    new Set(value.rootIds).size !== 2 ||
    typeof value.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.fingerprint)
  )
    throw new Error('BASELINE_INVALID');
  return {
    productId: value.productId,
    categoryId: value.categoryId,
    rootIds: value.rootIds.map(String),
    fingerprint: value.fingerprint
  };
}

export function parseOptions(args: readonly string[]): { credential: string; baseline: string } {
  const credentials = args.filter((arg) => arg.startsWith('--credential='));
  const baselines = args.filter((arg) => arg.startsWith('--baseline='));
  if (
    credentials.length !== 1 ||
    baselines.length !== 1 ||
    args.filter((arg) => arg === '--confirm-readonly').length !== 1 ||
    args.some(
      (arg) =>
        !arg.startsWith('--credential=') && !arg.startsWith('--baseline=') && arg !== '--confirm-readonly'
    )
  )
    throw new Error('READ_ONLY_ARGUMENTS_REQUIRED');
  const credential = credentials[0]?.slice('--credential='.length).trim();
  const baseline = baselines[0]?.slice('--baseline='.length).trim();
  if (!credential || !baseline) throw new Error('READ_ONLY_ARGUMENTS_REQUIRED');
  return { credential, baseline };
}

/** Independent allowlist: even accidental adapter changes cannot dispatch a write or Token request. */
export function readonlyTransport(
  protocol: 'top' | 'iop',
  target: string,
  delegate: NetworkTransport
): NetworkTransport {
  const used = new Set<string>();
  return {
    async send(input, init) {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (init.method !== 'POST' || !(init.body instanceof URLSearchParams) || url.search)
        throw new Error('READ_ONLY_GUARD');
      const body = init.body;
      const method =
        protocol === 'top'
          ? body.get('method')
          : url.pathname === '/rest/alibaba/icbu/product/list'
            ? 'alibaba.icbu.product.list'
            : url.pathname === '/rest/icbu/product/schema/render'
              ? 'alibaba.icbu.product.schema.render'
              : null;
      const allowedUrl =
        protocol === 'top'
          ? url.href === 'https://eco.taobao.com/router/rest'
          : url.origin === 'https://openapi-api.alibaba.com';
      if (
        !allowedUrl ||
        !method ||
        !['alibaba.icbu.product.list', 'alibaba.icbu.product.schema.render'].includes(method) ||
        used.has(method)
      )
        throw new Error('READ_ONLY_GUARD');
      if (method === 'alibaba.icbu.product.list') {
        if (body.get('id') !== target || body.get('page_size') !== '1')
          throw new Error('READ_ONLY_TARGET_MISMATCH');
      } else {
        const parameters: unknown = JSON.parse(
          body.get(protocol === 'top' ? 'param_product_top_publish_request' : 'render_request') ?? 'null'
        );
        if (!record(parameters) || String(parameters.product_id) !== target)
          throw new Error('READ_ONLY_TARGET_MISMATCH');
      }
      used.add(method);
      return delegate.send(input, init);
    }
  };
}

export async function main(args: readonly string[]): Promise<void> {
  const options = parseOptions(args);
  const baseline = parseBaseline(JSON.parse(await readFile(resolve(options.baseline), 'utf8')) as unknown);
  const provider = createNodeAlibabaCredentialProvider({
    ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: options.credential
  });
  const credentials = provider.requireCredentials();
  const protocol = credentials.protocol === 'iop' ? 'iop' : 'top';
  const requests: { requestId: string; statusCode: number; outcome: string }[] = [];
  const report: Record<string, unknown> = {
    checkedAtUtc: new Date().toISOString(),
    protocol,
    productId: baseline.productId,
    platformWrites: 0,
    oldReceiptRebound: false,
    originalBaselineMatched: false,
    restorationVerified: false,
    result: 'read-failed'
  };
  const adapter = new ProductAdapter(
    new AlibabaClient(
      credentials,
      new NetworkManager({
        transport: readonlyTransport(protocol, baseline.productId, new NativeFetchTransport()),
        policies: { alibaba: { allowedOrigins: [new URL(credentials.endpoint).origin] } },
        logger(entry) {
          requests.push({ requestId: entry.requestId, statusCode: entry.statusCode, outcome: entry.outcome });
        }
      }),
      { maxAttempts: 1 }
    )
  );
  installNodeXmlDomGlobals();
  try {
    const page = await adapter.list({
      productId: baseline.productId,
      page: 1,
      pageSize: 1,
      language: 'en_US'
    });
    const product = page.items.find((item) => item.id === baseline.productId);
    if (!product) {
      report.result = 'target-not-returned';
      // Missing from one public list cannot prove deletion, ownership, or restoration.
      process.exitCode = 2;
    } else {
      report.platformStatus = product.platformStatus;
      report.status = product.status;
      report.categoryMatched = product.categoryId === baseline.categoryId;
      await delay(350);
      const schema = await adapter.renderSchema({
        productId: baseline.productId,
        categoryId: baseline.categoryId,
        language: 'en_US'
      });
      const matched =
        (await productBatchTargetFingerprint(schema.xml, baseline.rootIds)) === baseline.fingerprint;
      report.originalBaselineMatched = matched;
      report.restorationVerified = matched && product.categoryId === baseline.categoryId;
      report.result = report.restorationVerified ? 'baseline-matched' : 'baseline-not-matched';
      if (!report.restorationVerified) process.exitCode = 2;
    }
  } catch (error) {
    const gatewayError = normalizeGatewayError(error);
    report.errorCode = /^[A-Za-z0-9_.:;-]{1,180}$/u.test(gatewayError.code)
      ? gatewayError.code
      : 'ERROR_REDACTED';
    if (gatewayError.traceId && /^[A-Za-z0-9_-]{1,160}$/u.test(gatewayError.traceId))
      report.traceId = gatewayError.traceId;
    process.exitCode = 1;
  } finally {
    report.requests = requests;
    const path = resolve('artifacts/product-batch-maintenance-reconciliation', `${randomUUID()}.json`);
    await atomicWriteJson(path, report);
    console.log(JSON.stringify({ path, ...report }));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch {
    console.error('READ_ONLY_RECONCILIATION_SETUP_FAILED');
    process.exitCode = 1;
  }
}
