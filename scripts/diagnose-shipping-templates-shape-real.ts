/**
 * Explicit one-call TOP shipping-template shape diagnostic (doc25394).
 * Parent executes main; imports never read credentials or make network requests.
 * Only public field names/types and ID presence/validity leave process memory.
 */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { NativeFetchTransport, type NetworkTransport } from '../packages/core/src/network';
import type { GatewayCredentials } from '../packages/core/src/types';
import { assertIgnoredFile, safeErrorCode } from './smoke-product-reference-real';
import { productReadScopedRoot, readReadonlyProductBundle } from './smoke-product-read-tools-real';

export const SHIPPING_TEMPLATE_SHAPE_METHOD = 'alibaba.wholesale.shippingline.template.list';
const publicKeys = new Set([
  'alibaba_wholesale_shippingline_template_list_response',
  'list_template_response',
  'items',
  'shippingline_template',
  'id',
  'title',
  'total',
  'request_id',
  'trace_id',
  'error_response',
  'code',
  'sub_code',
  'msg',
  'sub_msg'
]);
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function typeOf(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}
export interface TemplateShapeNode {
  path: string;
  type: string;
  keys?: string[];
  unknownKeyCount?: number;
  idPresent?: boolean;
  idType?: string;
  idValid?: boolean;
}
export function shippingTemplateShape(value: unknown): TemplateShapeNode[] {
  const result = new Map<string, TemplateShapeNode>();
  function walk(item: unknown, path: string, depth: number): void {
    if (depth > 10 || result.size >= 128) return;
    const type = typeOf(item);
    const node: TemplateShapeNode = { path, type };
    if (record(item)) {
      const keys = Object.keys(item);
      node.keys = keys.filter((key) => publicKeys.has(key)).sort();
      node.unknownKeyCount = keys.length - node.keys.length;
      node.idPresent = Object.hasOwn(item, 'id');
      if (node.idPresent) {
        node.idType = typeOf(item.id);
        node.idValid =
          typeof item.id === 'number'
            ? Number.isSafeInteger(item.id) && item.id > 0
            : typeof item.id === 'string' && /^[1-9][0-9]*$/u.test(item.id);
      }
    }
    result.set(path + ':' + type, node);
    if (Array.isArray(item)) for (const child of item.slice(0, 3)) walk(child, path + '/*', depth + 1);
    else if (record(item)) for (const key of node.keys ?? []) walk(item[key], path + '/' + key, depth + 1);
  }
  walk(value, '', 0);
  return [...result.values()];
}
export function parseTemplateShapeOptions(args: readonly string[]) {
  if (args.length !== 3 || args.filter((arg) => arg === '--confirm-readonly').length !== 1)
    throw new Error('READ_ONLY_ARGUMENTS_REQUIRED');
  const values = new Map<string, string>();
  for (const arg of args) {
    if (arg === '--confirm-readonly') continue;
    const match = /^--(top-credential|output)=(.+)$/u.exec(arg);
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
  const credential = values.get('top-credential'),
    output = values.get('output');
  if (!credential || !output) throw new Error('READ_ONLY_ARGUMENTS_REQUIRED');
  return { credential, output };
}
async function boundedShapeJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1024 * 1024) {
        void reader.cancel().catch(() => undefined);
        throw new Error('SHAPE_LIMIT_EXCEEDED');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export async function runTemplateShapeDiagnostic(
  credentials: GatewayCredentials,
  transport: NetworkTransport,
  persist: (report: unknown) => Promise<void> = () => Promise.resolve()
) {
  if ((credentials.protocol ?? 'top') !== 'top' || !credentials.accessToken)
    throw new Error('TOP_AUTHORIZATION_REQUIRED');
  const method = SHIPPING_TEMPLATE_SHAPE_METHOD,
    requestId = randomUUID();
  const report = {
    method,
    protocol: 'top' as const,
    requestId,
    networkRequests: 0,
    httpStatus: null as number | null,
    errorCode: 'READ_NOT_COMPLETED' as string | null,
    shapeError: null as string | null,
    shape: [] as TemplateShapeNode[]
  };
  const allowed = new Set([
    'method',
    'app_key',
    'sign',
    'sign_method',
    'timestamp',
    'v',
    'format',
    'simplify',
    'session',
    'partner_id',
    'page_num',
    'count'
  ]);
  let reserved = false;
  const guard: NetworkTransport = {
    async send(input, init) {
      const request = new Request(input, init),
        url = new URL(request.url);
      if (
        reserved ||
        url.href !== 'https://eco.taobao.com/router/rest' ||
        request.method !== 'POST' ||
        request.headers.get('X-Request-ID') !== requestId ||
        !/^application\/x-www-form-urlencoded(?:;|$)/iu.test(request.headers.get('Content-Type') ?? '')
      )
        throw new Error('READ_ONLY_NETWORK_DENIED');
      const form = new URLSearchParams(await request.clone().text());
      const keys = [...form.keys()];
      if (
        new Set(keys).size !== keys.length ||
        keys.some((key) => !allowed.has(key)) ||
        form.get('method') !== method ||
        form.get('page_num') !== '1' ||
        form.get('count') !== '1' ||
        !form.get('session') ||
        !form.get('app_key') ||
        !form.get('sign') ||
        !['hmac', 'md5', 'hmac-sha256'].includes(form.get('sign_method') ?? '')
      )
        throw new Error('READ_ONLY_NETWORK_DENIED');
      reserved = true;
      report.networkRequests++;
      const response = await transport.send(request.url, { ...init, redirect: 'error' });
      report.httpStatus = response.status;
      try {
        report.shape = shippingTemplateShape(await boundedShapeJson(response.clone()));
      } catch {
        report.shapeError = 'SHAPE_UNAVAILABLE';
      }
      return response;
    }
  };
  try {
    await persist(report);
    const gateway = new AlibabaReadGatewayClient(credentials, { transport: guard, maxAttempts: 1 });
    const envelope = await gateway.request(
      'callCapability',
      {
        method,
        parameters: { page_num: 1, count: 1 }
      },
      { requestId }
    );
    report.errorCode = envelope.contractValid ? null : 'RESPONSE_CONTRACT_INVALID';
  } catch (error: unknown) {
    report.errorCode = safeErrorCode(error);
  }
  await persist(report);
  return report;
}
export async function main(args: readonly string[]): Promise<void> {
  const options = parseTemplateShapeOptions(args);
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
  const bundle = readReadonlyProductBundle(JSON.parse(await readFile(credential, 'utf8')) as unknown, 'top');
  await mkdir(dirname(output), { recursive: true });
  await assertIgnoredFile(outputRoot, output);
  const file = await open(output, 'wx', 0o600);
  try {
    const report = await runTemplateShapeDiagnostic(
      {
        protocol: 'top',
        appKey: bundle.application.appKey,
        appSecret: bundle.application.appSecret,
        accessToken: bundle.oauth.accessToken,
        endpoint: 'https://eco.taobao.com/router/rest',
        signMethod: 'hmac'
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
    process.stderr.write('TEMPLATE_SHAPE_DIAGNOSTIC_FAILED\n');
    process.exitCode = 1;
  });
