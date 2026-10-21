/** Read-only inspection of the exact test resources in a saved IOP receipt. Never dispatches mutations. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createIopBusinessRequest,
  normalizeIopBusinessResponse
} from '../packages/core/src/alibaba-iop-business';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { IOP_BUSINESS_ENDPOINT, isRecord, signIopRequest } from '../packages/core/src/alibaba-iop';
import { setTimeout } from 'node:timers/promises';
import { NetworkManager } from '../packages/core/src/network';
import { normalizeGatewayError } from '../packages/core/src/errors';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { atomicWriteJson } from './openapi-auth/storage';
import { photoProbeScope, photoProbeTransport } from './lib/iop-photo-probe';

const option = (key: string) =>
  process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const credential = option('credential');
const receipt = option('receipt');
const output = option('output');
const sdkQueryForm = process.argv.includes('--sdk-query-form');
const comparePublicNames = process.argv.includes('--compare-public-parameter-names');
const pageSize = option('photo-page-size') ?? '1';
assert(/^[1-9]\d{0,2}$/u.test(pageSize) && Number(pageSize) <= 100, 'PHOTO_PAGE_SIZE_INVALID');
assert(!(sdkQueryForm && comparePublicNames), 'SELECT_ONE_PHOTO_PROBE_VARIANT');
const outputPath = output ? resolve(output) : null;
if (outputPath) assert(outputPath.startsWith(resolve('artifacts') + sep) && !existsSync(outputPath));
assert(credential && receipt && process.argv.includes('--confirm-read-only'));
const bundle = parseAlibabaOpenApiCredentialBundle(JSON.parse(await readFile(credential, 'utf8')) as unknown);
assert.equal(bundle.protocol, 'iop');
const report: unknown = JSON.parse(await readFile(receipt, 'utf8'));
assert(isRecord(report) && isRecord(report.resources));
const parent = report.resources.groupId;
const child = report.resources.childId;
assert(typeof parent === 'string' && /^\d{1,16}$/u.test(parent));
assert(typeof child === 'string' && /^\d{1,16}$/u.test(child));
const credentials = {
  protocol: 'iop' as const,
  endpoint: IOP_BUSINESS_ENDPOINT,
  signMethod: 'hmac-sha256' as const,
  appKey: bundle.application.appKey,
  appSecret: bundle.application.appSecret,
  accessToken: bundle.oauth.accessToken
};
const network = new NetworkManager({
  policies: { alibaba: { allowedOrigins: [new URL(IOP_BUSINESS_ENDPOINT).origin] } }
});
const observations: unknown[] = [];
let validationFailed = false;
function shape(value: unknown, depth = 0): unknown {
  if (depth > 5) return typeof value;
  if (Array.isArray(value))
    return { count: value.length, item: value.length ? shape(value[0], depth + 1) : null };
  if (isRecord(value))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item, depth + 1)]));
  return value === null ? 'null' : typeof value;
}
for (const [method, parameters] of [
  ['alibaba.icbu.photobank.group.list', { id: parent }],
  [
    'alibaba.icbu.photobank.list',
    { group_id: child, location_type: 'SUB_GROUP', current_page: 1, page_size: Number(pageSize) }
  ]
] as const) {
  const request = await createIopBusinessRequest(credentials, method, parameters);
  for (const variant of method.endsWith('photobank.list') && comparePublicNames
    ? ['documented', 'combined-public-names']
    : [method.endsWith('photobank.list') && sdkQueryForm ? 'sdk-query-form' : 'documented']) {
    const signed = { ...request.parameters };
    if (variant === 'combined-public-names') {
      signed.group_id = child;
      signed.current_page = '1';
      signed.page_size = pageSize;
      signed.location_type = 'SUB_GROUP';
      Reflect.deleteProperty(signed, 'sign');
      signed.sign = await signIopRequest('/icbu/product/photobank/list', signed, credentials.appSecret);
    }
    const transport =
      variant === 'sdk-query-form'
        ? photoProbeTransport({ url: request.url, parameters: signed }, 'sdk-query-form')
        : { url: request.url, body: new URLSearchParams(signed) };
    const requestId = crypto.randomUUID();
    const response = await network.request({
      service: 'alibaba',
      url: transport.url,
      method: 'POST',
      requestId,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: transport.body,
      responseType: 'json',
      maxAttempts: 1
    });
    const data = isRecord(response.data) ? response.data : {};
    const result = isRecord(data.result) ? data.result : {};
    const pagination = isRecord(result.pagination_query_list) ? result.pagination_query_list : {};
    let validation: { accepted: boolean; code?: string; subCode?: string; traceId?: string };
    try {
      assert(response.ok, 'IOP_READ_TRANSPORT_FAILED');
      normalizeIopBusinessResponse(response.data, method, credentials, signed);
      validation = { accepted: true };
    } catch (error) {
      validationFailed = true;
      const normalized = normalizeGatewayError(error);
      validation = {
        accepted: false,
        code: normalized.code,
        ...(normalized.subCode ? { subCode: normalized.subCode } : {}),
        ...(normalized.traceId ? { traceId: normalized.traceId } : {})
      };
    }
    const observation = {
      requestId,
      validation,
      method,
      variant,
      status: response.status,
      structure: shape(data),
      testGroups: Array.isArray(result.groups)
        ? result.groups.flatMap((group: unknown) =>
            isRecord(group) &&
            (typeof group.id === 'string' || typeof group.id === 'number') &&
            [parent, child].includes(String(group.id))
              ? [{ target: String(group.id) === parent ? 'parent' : 'child' }]
              : []
          )
        : undefined,
      pagination: Object.fromEntries(
        Object.entries(pagination)
          .filter(([key]) => ['total', 'current_page', 'page_size', 'has_next_page'].includes(key))
          .map(([key, value]) => [
            key,
            typeof value === 'boolean' || (typeof value === 'number' && Number.isSafeInteger(value))
              ? value
              : 'unconfirmed'
          ])
      ),
      scope: Array.isArray(pagination.list) ? photoProbeScope(pagination.list, child) : undefined
    };
    observations.push(observation);
    process.stdout.write(`${JSON.stringify(observation)}\n`);
    await setTimeout(350);
  }
}
if (outputPath)
  await atomicWriteJson(outputPath, {
    schemaVersion: 1,
    status: validationFailed ? 'needs-attention' : 'passed',
    capturedAtUtc: new Date().toISOString(),
    protocol: 'iop',
    mutations: 0,
    configurationChanged: false,
    observations
  });
// A completed diagnosis is not a passed photo-list acceptance.
if (validationFailed) process.exitCode = 2;
