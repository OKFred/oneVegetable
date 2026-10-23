/** Read-only remote acceptance through the actual BFF context and operation endpoints. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BffGatewayClient, type OperationId } from '../packages/core/src/index';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { NativeFetchTransport, type NetworkTransport } from '../packages/core/src/network';
import { normalizeGatewayError } from '../packages/core/src/errors';
import type { GalleryTransferContext } from '../packages/core/src/gallery-transfer-task';
import { CredentialBackedAlibabaGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { DualAlibabaAuthorization } from '../apps/api/src/gateway/dual-authorization';
import {
  GatewayCredentialCipher,
  GatewayCredentialService,
  SqlGatewayCredentialRepository,
  StoredAlibabaCredentialProvider
} from '../apps/api/src/gateway/credential-vault';
import { applyNodeMigrations, openNodeDatabase } from '../apps/api/src/db/node-database';
import { createApiApp } from '../apps/api/src/app';
import { AuthService } from '../apps/api/src/auth/service';
import { SqlAuthRepository } from '../apps/api/src/auth/repository';
import { atomicWriteJson } from './openapi-auth/storage';

const argument = (key: string) =>
  process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const topPath = argument('top');
const iopPath = argument('iop');
assert(
  topPath &&
    iopPath &&
    process.argv.includes('--confirm-read-only') &&
    process.argv.includes('--confirm-same-merchant'),
  'Provide two ignored credential files and explicit read-only/same-merchant confirmation.'
);
const top = parseAlibabaOpenApiCredentialBundle(
  JSON.parse(await readFile(resolve(topPath), 'utf8')) as unknown
);
const iop = parseAlibabaOpenApiCredentialBundle(
  JSON.parse(await readFile(resolve(iopPath), 'utf8')) as unknown
);
assert.equal(top.protocol ?? 'top', 'top');
assert.equal(iop.protocol, 'iop');
for (const bundle of [top, iop])
  if (bundle.oauth.expiresAtUtc)
    assert(
      Date.parse(bundle.oauth.expiresAtUtc) > Date.now() + 600_000,
      'Expired candidate: no refresh is permitted during this acceptance.'
    );

const allowedTopReads = new Set([
  'alibaba.scbp.showcase.status',
  'alibaba.scbp.showcase.list',
  'alibaba.icbu.product.sku.inventory.get',
  'alibaba.icbu.photobank.list',
  'alibaba.seller.order.list',
  'alibaba.seller.order.fund.get',
  'alibaba.seller.order.logistics.get',
  'alibaba.icbu.video.query'
]);
const allowedIopPaths = new Set([
  '/rest/alibaba/icbu/product/list',
  '/rest/icbu/product/photobank/group/list',
  '/rest/alibaba/order/list'
]);
let sent = 0;
const requests: { protocol: 'top' | 'iop'; method: string }[] = [];
const native = new NativeFetchTransport();
const transport: NetworkTransport = {
  async send(input, init) {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const parameters =
      init.body instanceof URLSearchParams
        ? init.body
        : new URLSearchParams(typeof init.body === 'string' ? init.body : '');
    const method = parameters.get('method') ?? '';
    const protocol = url.origin === 'https://eco.taobao.com' ? 'top' : 'iop';
    assert(
      (protocol === 'top' && allowedTopReads.has(method)) ||
        (url.origin === 'https://openapi-api.alibaba.com' && allowedIopPaths.has(url.pathname)),
      'Read-only transport rejected an unexpected endpoint or method.'
    );
    assert(++sent <= 20, 'Acceptance request limit exceeded.');
    requests.push({ protocol, method: protocol === 'top' ? method : url.pathname });
    await new Promise<void>((done) => setTimeout(done, 350));
    return native.send(input, init);
  }
};
const db = openNodeDatabase(':memory:');
applyNodeMigrations(db);
const cipher = await GatewayCredentialCipher.create(
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
);
const repository = new SqlGatewayCredentialRepository(db.executor);
const service = new GatewayCredentialService(repository, cipher);
const primary = {
  service,
  provider: new StoredAlibabaCredentialProvider(repository, cipher, { transport }),
  summary: () => service.status()
};
const dual = new DualAlibabaAuthorization(db.executor, cipher, primary, { transport });
const records: {
  operation: string;
  protocol: string;
  requestId: string;
  status: string;
  count?: number;
  code?: string;
  traceId?: string;
}[] = [];
try {
  for (const [protocol, bundle] of [
    ['top', top],
    ['iop', iop]
  ] as const)
    await (
      await dual.service(protocol)
    ).import({
      bundle: { ...bundle, oauth: { ...bundle.oauth, refreshToken: null, refreshExpiresAtUtc: null } },
      actorId: 'read-only-acceptance',
      expectedRevision: null,
      remark: null
    });
  const bootstrapToken = crypto.randomUUID();
  const auth = new AuthService({ repository: new SqlAuthRepository(db.executor), bootstrapToken });
  const session = await auth.bootstrap({
    requestId: crypto.randomUUID(),
    bootstrapToken,
    username: 'acceptance',
    password: crypto.randomUUID()
  });
  const gateway = new CredentialBackedAlibabaGatewayClient(dual, { transport, maxAttempts: 1 });
  const app = createApiApp({
    runtime: 'node',
    database: 'sqlite',
    environment: 'test',
    gatewayMode: 'real',
    gateway,
    authService: auth
  });
  const client = new BffGatewayClient({
    baseUrl: 'http://localhost',
    transport: {
      send: async (input, init) =>
        app.request(input instanceof Request ? input.url : String(input), {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init.headers)),
            Cookie: `ov_session=${session.sessionToken}`
          }
        })
    }
  });
  async function probe<T>(
    operation: OperationId,
    payload: Readonly<Record<string, unknown>>,
    protocol: 'top' | 'iop',
    run: (context: GalleryTransferContext, requestId: string) => Promise<T>,
    count: (value: T) => number
  ): Promise<T | null> {
    const requestId = crypto.randomUUID();
    try {
      const context = await client.galleryTransferContext(operation, payload);
      assert.equal(
        await gateway.operationProtocol(operation, payload, { galleryContext: context }),
        protocol
      );
      const result = await run(context, requestId);
      const size = count(result);
      records.push({ operation, protocol, requestId, status: size ? 'passed' : 'no-data', count: size });
      return result;
    } catch (cause) {
      const error = normalizeGatewayError(cause);
      records.push({
        operation,
        protocol,
        requestId,
        status: 'failed',
        code: error.code,
        ...(error.traceId ? { traceId: error.traceId } : {})
      });
      process.exitCode = 1;
      return null;
    }
  }
  const products = await probe(
    'listProducts',
    {},
    'iop',
    (context, requestId) =>
      client.request(
        'listProducts',
        { page: 1, pageSize: 2, language: 'en_US' },
        { galleryContext: context, requestId }
      ),
    (page) => page.items.length
  );
  await probe(
    'getProductShowcase',
    {},
    'top',
    (context, requestId) =>
      client.request('getProductShowcase', undefined, { galleryContext: context, requestId }),
    (snapshot) => snapshot.entries.length
  );
  await probe(
    'callCapability',
    { method: 'alibaba.scbp.showcase.status', parameters: {} },
    'top',
    (context, requestId) =>
      client.request(
        'callCapability',
        { method: 'alibaba.scbp.showcase.status', parameters: {} },
        { galleryContext: context, requestId }
      ),
    (result) => {
      assert(result.contractValid, 'Generic read response did not satisfy its contract.');
      return 1;
    }
  );
  const product = products?.items[0];
  if (product)
    await probe(
      'getProductInventory',
      { source: 'sku' },
      'top',
      (context, requestId) =>
        client.request(
          'getProductInventory',
          { productId: product.id, source: 'sku', language: 'en_US' },
          { galleryContext: context, requestId }
        ),
      (snapshot) => {
        assert(
          ['ready', 'no-data'].includes(snapshot.status),
          'Inventory read did not have an explicit success result.'
        );
        return snapshot.records.length;
      }
    );
  const groups = await probe(
    'listPhotoGroups',
    {},
    'iop',
    (context, requestId) =>
      client.request('listPhotoGroups', undefined, { galleryContext: context, requestId }),
    (items) => items.length
  );
  const group = groups?.[0];
  if (group)
    await probe(
      'listPhotos',
      { groupId: group.id },
      'top',
      (context, requestId) =>
        client.request(
          'listPhotos',
          { groupId: group.id, page: 1, pageSize: 2 },
          { galleryContext: context, requestId }
        ),
      (page) => page.items.length
    );
  await probe(
    'listVideos',
    {},
    'top',
    (context, requestId) =>
      client.request('listVideos', { page: 1, pageSize: 20 }, { galleryContext: context, requestId }),
    (page) => page.items.length
  );
  const orders = await probe(
    'listTradeOrders',
    {},
    'iop',
    (context, requestId) =>
      client.request(
        'listTradeOrders',
        { page: 1, pageSize: 1, role: 'seller' },
        { galleryContext: context, requestId }
      ),
    (page) => page.items.length
  );
  const order = orders?.items[0];
  if (order)
    await probe(
      'getTradeOrderAggregate',
      {},
      'top',
      (context, requestId) =>
        client.request(
          'getTradeOrderAggregate',
          { order, language: 'en_US' },
          { galleryContext: context, requestId }
        ),
      (result) => {
        assert(result.logistics !== null || result.fund !== null, 'No usable aggregate detail was returned.');
        return Number(result.logistics !== null) + Number(result.fund !== null);
      }
    );
  else
    records.push({
      operation: 'getTradeOrderAggregate',
      protocol: 'top',
      requestId: crypto.randomUUID(),
      status: 'skipped-prerequisite'
    });
} finally {
  db.connection.close();
  const receipt = resolve(
    `artifacts/dual-context-validation/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.json`
  );
  await atomicWriteJson(receipt, {
    capturedAtUtc: new Date().toISOString(),
    readOnly: true,
    activeConfigurationChanged: false,
    refreshEnabled: false,
    sent,
    requests,
    records
  });
  process.stdout.write(`${JSON.stringify({ receipt, sent, records }, null, 2)}\n`);
}
