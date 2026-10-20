/** Read-only inspection of the exact test resources in a saved IOP receipt. Never dispatches mutations. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createIopBusinessRequest } from '../packages/core/src/alibaba-iop-business';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { IOP_BUSINESS_ENDPOINT, isRecord, signIopRequest } from '../packages/core/src/alibaba-iop';
import { setTimeout } from 'node:timers/promises';
import { NetworkManager } from '../packages/core/src/network';

const option = (key: string) =>
  process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const credential = option('credential');
const receipt = option('receipt');
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
    const response = await network.request({
      service: 'alibaba',
      url: request.url,
      method: 'POST',
      requestId: crypto.randomUUID(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(signed),
      responseType: 'json'
    });
    const data = isRecord(response.data) ? response.data : {};
    const result = isRecord(data.result) ? data.result : {};
    const pagination = isRecord(result.pagination_query_list) ? result.pagination_query_list : {};
    process.stdout.write(
      `${JSON.stringify({
        method,
        variant,
        status: response.status,
        code: data.code,
        structure: shape(data),
        testGroups: Array.isArray(result.groups)
          ? result.groups.filter(
              (group: unknown) => isRecord(group) && [parent, child].includes(String(group.id))
            )
          : undefined,
        pagination: Object.fromEntries(
          Object.entries(pagination).filter(([key]) =>
            ['total', 'current_page', 'page_size', 'has_next_page'].includes(key)
          )
        )
      })}\n`
    );
    await setTimeout(350);
  }
}
