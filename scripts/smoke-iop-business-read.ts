/** Explicit read-only acceptance; no import into the active workbench and no token renewal. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AlibabaClient } from '../packages/core/src/alibaba-client';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { IOP_BUSINESS_ENDPOINT } from '../packages/core/src/alibaba-iop';
import { normalizeGatewayError } from '../packages/core/src/errors';
import { ProductAdapter } from '../packages/core/src/product-adapter';
import { PhotoAdapter } from '../packages/core/src/photo-adapter';
import { TradeAdapter } from '../packages/core/src/trade-adapter';
import { NativeFetchTransport, NetworkManager, type NetworkTransport } from '../packages/core/src/network';
import type { OperationId } from '../packages/core/src/types';
import { atomicWriteJson } from './openapi-auth/storage';

const file = process.argv.find((value) => value.startsWith('--credential='))?.slice('--credential='.length);
if (!file || !process.argv.includes('--confirm-read-only'))
  throw new Error(
    'Provide --credential=<ignored IOP bundle> --confirm-read-only. No active configuration is changed.'
  );
const bundle = parseAlibabaOpenApiCredentialBundle(
  JSON.parse(await readFile(resolve(file), 'utf8')) as unknown
);
assert.equal(bundle.protocol, 'iop', 'Explicit IOP marker required; never infer protocol.');
if (bundle.oauth.expiresAtUtc !== null)
  assert(
    Date.parse(bundle.oauth.expiresAtUtc) > Date.now() + 600000,
    'Reauthorize before acceptance; this script never renews tokens.'
  );
const receipt = crypto.randomUUID();
const records: {
  operation: string;
  requestId: string;
  status: 'passed' | 'no-data' | 'failed' | 'skipped-prerequisite';
  count?: number;
  errorCode?: string;
  subCode?: string;
  responseShape?: unknown;
}[] = [];
const credentials = {
  protocol: 'iop' as const,
  appKey: bundle.application.appKey,
  appSecret: bundle.application.appSecret,
  accessToken: bundle.oauth.accessToken,
  endpoint: IOP_BUSINESS_ENDPOINT,
  signMethod: 'hmac-sha256' as const
};
const native = new NativeFetchTransport();
let responseShape: unknown;
function shape(value: unknown, depth = 0): unknown {
  if (depth > 5) return typeof value;
  if (Array.isArray(value))
    return {
      type: 'array',
      count: value.length,
      item: value[0] === undefined ? null : shape(value[0], depth + 1)
    };
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item, depth + 1)]));
  return value === null ? 'null' : typeof value;
}
let pending: Promise<unknown> = Promise.resolve();
const transport: NetworkTransport = {
  send(input, init) {
    const response = pending.then(async () => {
      const result = await native.send(input, init);
      responseShape = shape((await result.clone().json()) as unknown);
      return result;
    });
    pending = response
      .then(
        () => undefined,
        () => undefined
      )
      .then(() => new Promise<void>((done) => setTimeout(done, 350)));
    return response;
  }
};
const network = new NetworkManager({
  transport,
  policies: { alibaba: { allowedOrigins: ['https://openapi-api.alibaba.com'] } }
});
async function call<T>(
  operation: OperationId,
  execute: (client: AlibabaClient) => Promise<T>,
  summary: (value: T) => number
): Promise<T | null> {
  const requestId = crypto.randomUUID();
  try {
    const value = await execute(new AlibabaClient(credentials, network, { maxAttempts: 1, requestId }));
    const count = summary(value);
    records.push({ operation, requestId, status: count === 0 ? 'no-data' : 'passed', count });
    return value;
  } catch (cause) {
    const error = normalizeGatewayError(cause);
    records.push({
      operation,
      requestId,
      status: 'failed',
      errorCode: error.code,
      ...(error.code === 'ALIBABA_IOP_RESPONSE_INVALID' ? { responseShape } : {}),
      ...(error.subCode ? { subCode: error.subCode } : {})
    });
    process.exitCode = 1;
    return null;
  } finally {
    await new Promise((done) => setTimeout(done, 350));
  }
}
const products = await call(
  'listProducts',
  (client) => new ProductAdapter(client).list({ page: 1, pageSize: 1, language: 'en_US' }),
  (value) => value.items.length
);
await call(
  'listProductGroups',
  (client) => new ProductAdapter(client).listGroups(),
  (value) => value.length
);
const groups = await call(
  'listPhotoGroups',
  (client) => new PhotoAdapter(client).listGroups(),
  (value) => value.length
);
const product = products?.items[0];
if (product?.categoryId && product.categoryId > 0) {
  const categoryId = product.categoryId;
  await call(
    'renderProductSchema',
    (client) =>
      new ProductAdapter(client).renderSchema({
        productId: product.id,
        categoryId,
        language: 'en_US'
      }),
    (value) => (value.xml.includes('<itemSchema') ? 1 : 0)
  );
  await call(
    'getProductSchema',
    (client) =>
      new ProductAdapter(client).getSchema({
        categoryId,
        language: 'en_US',
        market: 'wholesale'
      }),
    (value) => (value.xml.trim() ? 1 : 0)
  );
  await call(
    'getProductScore',
    (client) => new ProductAdapter(client).getScore(product.id),
    () => 1
  );
  await call(
    'callCapability',
    (client) => client.call('alibaba.icbu.category.get.new', { cat_id: categoryId }),
    () => 1
  );
  await call(
    'callCapability',
    (client) =>
      client.call('alibaba.icbu.product.type.available.get', {
        cat_id: categoryId,
        language: 'en_US'
      }),
    () => 1
  );
} else
  records.push({
    operation: 'renderProductSchema',
    requestId: crypto.randomUUID(),
    status: 'skipped-prerequisite'
  });
const group = groups?.[0];
if (group)
  await call(
    'listPhotos',
    (client) => new PhotoAdapter(client).list({ groupId: group.id, page: 1, pageSize: 1 }),
    (value) => value.items.length
  );
else
  records.push({ operation: 'listPhotos', requestId: crypto.randomUUID(), status: 'skipped-prerequisite' });
const orders = await call(
  'listTradeOrders',
  (client) => new TradeAdapter(client).list({ page: 1, pageSize: 1 }),
  (value) => value.items.length
);
const order = orders?.items[0];
if (order)
  await call(
    'getTradeOrderLogistics',
    (client) => new TradeAdapter(client).getLogistics(order.id),
    () => 1
  );
else
  records.push({
    operation: 'getTradeOrderLogistics',
    requestId: crypto.randomUUID(),
    status: 'skipped-prerequisite'
  });
const report = {
  capturedAtUtc: new Date().toISOString(),
  protocol: 'iop',
  configurationChanged: false,
  tokenRenewed: false,
  mutations: 0,
  records
};
await atomicWriteJson(resolve('artifacts/iop-business-read-validation', `${receipt}.json`), report);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
