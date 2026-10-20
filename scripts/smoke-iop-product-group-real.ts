/** One durable, explicitly confirmed IOP group creation. Never updates a product or deletes a group. */
import { access, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { AlibabaClient } from '../packages/core/src/alibaba-client';
import {
  createIopBusinessRequest,
  normalizeIopBusinessResponse
} from '../packages/core/src/alibaba-iop-business';
import { IOP_BUSINESS_ENDPOINT, isRecord } from '../packages/core/src/alibaba-iop';
import { NativeFetchTransport, NetworkManager } from '../packages/core/src/network';
import { normalizeGatewayError } from '../packages/core/src/errors';
import { atomicWriteJson } from './openapi-auth/storage';

const args = process.argv.slice(2);
const file = args.find((arg) => arg.startsWith('--credential='))?.slice('--credential='.length);
const output = args.find((arg) => arg.startsWith('--receipt='))?.slice('--receipt='.length);
if (!file || !output || args.length !== 3 || !args.includes('--confirm-real-write'))
  throw new Error('Provide --credential=<IOP JSON> --receipt=<new artifacts path> --confirm-real-write');
const receiptPath = resolve(output);
if (!receiptPath.startsWith(resolve('artifacts') + sep)) throw new Error('IGNORED_RECEIPT_REQUIRED');
let exists = true;
try {
  await access(receiptPath);
} catch (cause) {
  if (!isRecord(cause) || cause.code !== 'ENOENT') throw cause;
  exists = false;
}
if (exists) throw new Error('EXISTING_RECEIPT_REQUIRES_READ_ONLY_RECONCILIATION');
const bundle = parseAlibabaOpenApiCredentialBundle(
  JSON.parse(await readFile(resolve(file), 'utf8')) as unknown
);
if (
  bundle.protocol !== 'iop' ||
  (bundle.oauth.expiresAtUtc !== null && Date.parse(bundle.oauth.expiresAtUtc) <= Date.now() + 600_000)
)
  throw new Error('VALID_EXPLICIT_IOP_REQUIRED');
const credentials = {
  protocol: 'iop' as const,
  endpoint: IOP_BUSINESS_ENDPOINT,
  appKey: bundle.application.appKey,
  appSecret: bundle.application.appSecret,
  accessToken: bundle.oauth.accessToken,
  signMethod: 'hmac-sha256' as const
};
const requestId = crypto.randomUUID(),
  name = 'ov-iop-product-' + requestId.slice(0, 8);
const method = 'alibaba.icbu.product.group.add';
const receipt = {
  capturedAtUtc: new Date().toISOString(),
  requestId,
  protocol: 'iop',
  name,
  status: 'prepared',
  groupId: null as number | null,
  parentId: -1,
  readbackConfirmed: false,
  writes: 0,
  configurationChanged: false,
  productsModified: 0,
  errorCode: null as string | null,
  providerCode: null as string | null,
  traceId: null as string | null
};
const save = () => atomicWriteJson(receiptPath, receipt);
const native = new NativeFetchTransport();
let queue: Promise<unknown> = Promise.resolve(),
  lastRequest = 0,
  requests = 0;
const network = new NetworkManager({
  transport: {
    send(input, init) {
      const request = new Request(input, init),
        url = new URL(request.url);
      if (
        url.origin !== 'https://openapi-api.alibaba.com' ||
        request.method !== 'POST' ||
        url.search ||
        !['/rest/icbu/product/group/add', '/rest/alibaba/icbu/product/group/get'].includes(url.pathname) ||
        ++requests > 8
      )
        throw new Error('BOUNDED_GROUP_ACCEPTANCE_REQUIRED');
      if (url.pathname.endsWith('/add') && ++receipt.writes > 1) throw new Error('NO_AUTOMATIC_RETRY');
      const response = queue.then(async () => {
        await delay(Math.max(0, 350 - (Date.now() - lastRequest)));
        lastRequest = Date.now();
        return native.send(request);
      });
      queue = response.then(
        () => undefined,
        () => undefined
      );
      return response;
    }
  },
  policies: { alibaba: { allowedOrigins: ['https://openapi-api.alibaba.com'] } }
});
const client = new AlibabaClient(credentials, network, { maxAttempts: 1, requestId });
await save();
try {
  await client.call('alibaba.icbu.product.group.get', { group_id: -1 });
  const signed = await createIopBusinessRequest(credentials, method, {
    group_name: name,
    parent_id: -1,
    extra_context: {}
  });
  receipt.status = 'sending';
  await save();
  const response = await network.request({
    service: 'alibaba',
    url: signed.url,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(signed.parameters),
    responseType: 'json',
    requestId
  });
  if (!response.ok) throw new Error('UNCONFIRMED_WRITE_RESPONSE');
  const normalized = normalizeIopBusinessResponse(response.data, method, credentials);
  const root = isRecord(normalized) ? normalized.alibaba_icbu_product_group_add_response : null;
  const group = isRecord(root) ? root.product_group : null;
  if (!isRecord(group) || group.group_name !== name || Number(group.parent_id) !== -1)
    throw new Error('GROUP_RESPONSE_NOT_CORRELATED');
  receipt.groupId = Number(group.group_id);
  receipt.status = 'accepted';
  await save();
  for (let attempt = 0; attempt < 5; attempt++) {
    await delay(2000);
    const response = await client.call('alibaba.icbu.product.group.get', { group_id: receipt.groupId });
    const root = isRecord(response.data) ? response.data.alibaba_icbu_product_group_get_response : null;
    const group = isRecord(root) ? root.product_group : null;
    if (
      isRecord(group) &&
      Number(group.group_id) === receipt.groupId &&
      group.group_name === name &&
      Number(group.parent_id) === -1
    ) {
      receipt.readbackConfirmed = true;
      receipt.status = 'completed';
      break;
    }
  }
  if (!receipt.readbackConfirmed) receipt.status = 'awaiting-readback';
} catch (cause) {
  const error = normalizeGatewayError(cause);
  receipt.errorCode = error.code;
  receipt.providerCode = error.subCode ?? null;
  receipt.traceId = error.traceId ?? null;
  receipt.status =
    receipt.status === 'sending' ? 'unknown' : receipt.status === 'accepted' ? 'awaiting-readback' : 'failed';
} finally {
  await save();
  process.stdout.write(JSON.stringify({ ...receipt, receiptPath }) + '\n');
  if (receipt.status !== 'completed') process.exitCode = 1;
}
