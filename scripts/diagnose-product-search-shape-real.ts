/**
 * One exact search/v2 read only. Import is inert; only the parent executes main.
 * Reports the normalized Gateway payload's public keys/types and contract paths,
 * never request parameters, raw responses, values, messages or credentials.
 */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import docs from '../docs/alibaba-product-workbench-docs.json';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { NativeFetchTransport, type NetworkTransport } from '../packages/core/src/network';
import type { GatewayCredentials } from '../packages/core/src/types';
import { assertIgnoredFile, readIopBundle, safeErrorCode } from './smoke-product-reference-real';
import {
  PRODUCT_READ_ACCEPTANCE_METHODS,
  ProductReadNetworkGuard,
  productReadScopedRoot,
  safeSearchContractIssues,
  assessProductReadEnvelope
} from './smoke-product-read-tools-real';

const method = PRODUCT_READ_ACCEPTANCE_METHODS.search;
const publicKeys = new Set(['code', 'request_id', 'trace_id']);
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function collect(nodes: unknown): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes)
    if (record(node) && typeof node.name === 'string') {
      publicKeys.add(node.name);
      collect(node.children);
    }
}
collect(docs.documents.find((doc) => doc.path === method)?.response);
export function searchPayloadShape(value: unknown): { path: string; type: string }[] {
  const result = new Map<string, { path: string; type: string }>();
  function walk(item: unknown, path: string, depth: number): void {
    if (depth > 10 || result.size >= 256) return;
    const type = item === null ? 'null' : Array.isArray(item) ? 'array' : typeof item;
    result.set(path + ':' + type, { path, type });
    if (Array.isArray(item)) for (const child of item.slice(0, 3)) walk(child, path + '/*', depth + 1);
    else if (record(item))
      for (const key of Object.keys(item).sort().slice(0, 100)) {
        if (publicKeys.has(key)) walk(item[key], path + '/' + key, depth + 1);
      }
  }
  walk(value, '', 0);
  return [...result.values()];
}
export function parseSearchDiagnosticOptions(args: readonly string[]) {
  if (args.length !== 4 || args.filter((arg) => arg === '--confirm-readonly').length !== 1)
    throw new Error('READ_ONLY_ARGUMENTS_REQUIRED');
  const values = new Map<string, string>();
  for (const arg of args) {
    if (arg === '--confirm-readonly') continue;
    const match = /^--(iop-credential|model-number|output)=(.+)$/u.exec(arg);
    const key = match?.[1],
      value = match?.[2];
    if (
      !key ||
      !value ||
      values.has(key) ||
      value.trim() !== value ||
      Array.from(value).some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error('READ_ONLY_ARGUMENTS_INVALID');
    values.set(key, value);
  }
  const modelNumber = values.get('model-number') ?? '';
  if (
    !modelNumber ||
    modelNumber.length > 200 ||
    /[*?%]/u.test(modelNumber) ||
    !/[\p{L}\p{N}]/u.test(modelNumber)
  )
    throw new Error('EXACT_MODEL_REQUIRED');
  const credential = values.get('iop-credential'),
    output = values.get('output');
  if (!credential || !output) throw new Error('READ_ONLY_ARGUMENTS_REQUIRED');
  return { credential, output, modelNumber };
}
export async function runSearchShapeDiagnostic(
  modelNumber: string,
  credentials: GatewayCredentials,
  transport: NetworkTransport,
  persist: (report: unknown) => Promise<void> = () => Promise.resolve()
) {
  parseSearchDiagnosticOptions([
    '--confirm-readonly',
    '--iop-credential=in-memory',
    '--output=in-memory',
    '--model-number=' + modelNumber
  ]);
  if (credentials.protocol !== 'iop') throw new Error('EXPLICIT_IOP_BUNDLE_REQUIRED');
  const requestId = randomUUID();
  const report = {
    method,
    protocol: 'iop' as const,
    requestId,
    networkRequests: 0,
    errorCode: 'READ_NOT_COMPLETED' as string | null,
    shape: [] as ReturnType<typeof searchPayloadShape>,
    contractIssues: [] as ReturnType<typeof safeSearchContractIssues>
  };
  const entry = {
    operation: 'search' as const,
    method,
    protocol: 'iop' as const,
    parameters: { model_number: modelNumber, page_index: 1, page_size: 1 }
  };
  const guard = new ProductReadNetworkGuard(transport);
  guard.arm(entry, requestId);
  try {
    await persist(report);
    const gateway = new AlibabaReadGatewayClient(credentials, { transport: guard, maxAttempts: 1 });
    const envelope = await gateway.request(
      'callCapability',
      { method, parameters: entry.parameters },
      { requestId }
    );
    report.shape = searchPayloadShape(envelope.data);
    report.contractIssues = safeSearchContractIssues(envelope, [
      credentials.appKey,
      credentials.appSecret,
      credentials.accessToken,
      modelNumber
    ]);
    report.errorCode = assessProductReadEnvelope(entry, envelope).errorCode;
  } catch (error: unknown) {
    report.errorCode = safeErrorCode(error);
  } finally {
    guard.disarm();
    report.networkRequests = guard.snapshot().sent;
  }
  await persist(report);
  return report;
}
export async function main(args: readonly string[]): Promise<void> {
  const options = parseSearchDiagnosticOptions(args);
  const root = await realpath(resolve(import.meta.dirname, '..'));
  const credential = resolve(root, options.credential),
    output = resolve(root, options.output);
  const outputRoot = productReadScopedRoot(root, output);
  if (
    !output.toLowerCase().startsWith((resolve(outputRoot, 'artifacts') + sep).toLowerCase()) ||
    output.toLowerCase() === credential.toLowerCase()
  )
    throw new Error('NEW_IGNORED_RECEIPT_REQUIRED');
  await assertIgnoredFile(outputRoot, output);
  await assertIgnoredFile(productReadScopedRoot(root, credential), credential);
  const stat = await lstat(credential);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('IGNORED_INPUT_INVALID');
  const bundle = readIopBundle(JSON.parse(await readFile(credential, 'utf8')) as unknown);
  await mkdir(dirname(output), { recursive: true });
  await assertIgnoredFile(outputRoot, output);
  const file = await open(output, 'wx', 0o600);
  try {
    const report = await runSearchShapeDiagnostic(
      options.modelNumber,
      {
        protocol: 'iop',
        appKey: bundle.application.appKey,
        appSecret: bundle.application.appSecret,
        accessToken: bundle.oauth.accessToken,
        endpoint: 'https://openapi-api.alibaba.com/rest',
        signMethod: 'hmac-sha256'
      },
      new NativeFetchTransport(),
      async (report) => {
        await file.truncate(0);
        await file.write(JSON.stringify(report, null, 2) + '\n', 0, 'utf8');
        await file.sync();
      }
    );
    process.stdout.write(JSON.stringify(report) + '\n');
    if (report.errorCode) process.exitCode = 1;
  } finally {
    await file.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main(process.argv.slice(2)).catch(() => {
    process.stderr.write('SEARCH_DIAGNOSTIC_FAILED\n');
    process.exitCode = 1;
  });
