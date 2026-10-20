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

const option = (key: string) =>
  process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const credential = option('credential');
const receipt = option('receipt');
const output = option('output');
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
    { group_id: child, location_type: 'SUB_GROUP', current_page: 1, page_size: 1 }
  ]
] as const) {
  const request = await createIopBusinessRequest(credentials, method, parameters);
  for (const variant of method.endsWith('photobank.list') &&
  process.argv.includes('--compare-public-parameter-names')
    ? ['documented', 'combined-public-names']
    : ['documented']) {
    const signed = { ...request.parameters };
    if (variant === 'combined-public-names') {
      signed.group_id = child;
      signed.current_page = '1';
      signed.page_size = '1';
      signed.location_type = 'SUB_GROUP';
      Reflect.deleteProperty(signed, 'sign');
      signed.sign = await signIopRequest('/icbu/product/photobank/list', signed, credentials.appSecret);
    }
    const requestId = crypto.randomUUID();
    const response = await network.request({
      service: 'alibaba',
      url: request.url,
      method: 'POST',
      requestId,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(signed),
      responseType: 'json'
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
      scope: Array.isArray(pagination.list)
        ? {
            returned: pagination.list.length,
            targetGroup: pagination.list.filter(
              (item: unknown) => isRecord(item) && String(item.group_id) === child
            ).length,
            otherGroup: pagination.list.filter(
              (item: unknown) =>
                isRecord(item) &&
                (typeof item.group_id === 'string' || typeof item.group_id === 'number') &&
                String(item.group_id) !== child
            ).length,
            missingGroup: pagination.list.filter(
              (item: unknown) => !isRecord(item) || item.group_id === undefined
            ).length
          }
        : undefined
    };
    observations.push(observation);
    process.stdout.write(`${JSON.stringify(observation)}\n`);
    await setTimeout(350);
  }
}
if (outputPath)
  await atomicWriteJson(outputPath, {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    protocol: 'iop',
    mutations: 0,
    configurationChanged: false,
    observations
  });
