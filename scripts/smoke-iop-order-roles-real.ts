/** Isolated Node BFF: at most six IOP reads, no TOP, tokens, payments, or mutations. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { IOP_BUSINESS_ENDPOINT } from '../packages/core/src/alibaba-iop';
import { normalizeGatewayError } from '../packages/core/src/errors';
import { NativeFetchTransport, type NetworkTransport } from '../packages/core/src/network';
import { atomicWriteJson } from './openapi-auth/storage';

async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 2 && args.includes('--confirm-readonly'));
  const file = args.find((arg) => arg.startsWith('--credential='))?.slice('--credential='.length);
  assert(file);
  const bundle = parseAlibabaOpenApiCredentialBundle(
    JSON.parse(await readFile(resolve(file), 'utf8')) as unknown
  );
  assert.equal(bundle.protocol, 'iop');
  assert(bundle.oauth.expiresAtUtc === null || Date.parse(bundle.oauth.expiresAtUtc) > Date.now() + 600_000);
  const readPaths = new Set([
    '/rest/alibaba/order/list',
    '/rest/alibaba/order/get',
    '/rest/order/logistics/query'
  ]);
  const native = new NativeFetchTransport();
  const network: { path: string; requestId: string; status: number; role: 'seller' | 'buyer' }[] = [];
  let activeRole: 'seller' | 'buyer' = 'seller';
  let activeOrder: string | null = null;
  let count = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const transport: NetworkTransport = {
    send(input, init) {
      const request = new Request(input, init);
      const url = new URL(request.url);
      assert.equal(url.origin, new URL(IOP_BUSINESS_ENDPOINT).origin);
      assert(readPaths.has(url.pathname) && !url.search && request.method === 'POST');
      assert(++count <= 6, 'READ_ONLY_REQUEST_LIMIT');
      const role = activeRole;
      const expectedOrder = activeOrder;
      const job = queue.then(async () => {
        const parameters = new URLSearchParams(await request.clone().text());
        assert(!parameters.has('session') && !parameters.has('method'));
        if (url.pathname.endsWith('/order/list')) assert.equal(parameters.get('role'), role);
        else
          assert(
            expectedOrder &&
              parameters.get(url.pathname.endsWith('/order/get') ? 'e_trade_id' : 'trade_id') ===
                expectedOrder
          );
        await setTimeout(350);
        const response = await native.send(request, {});
        network.push({
          path: url.pathname,
          requestId: request.headers.get('X-Request-ID') ?? '',
          status: response.status,
          role
        });
        return response;
      });
      queue = job.catch(() => undefined);
      return job;
    }
  };
  const gateway = new AlibabaReadGatewayClient(
    {
      protocol: 'iop',
      endpoint: IOP_BUSINESS_ENDPOINT,
      signMethod: 'hmac-sha256',
      appKey: bundle.application.appKey,
      appSecret: bundle.application.appSecret,
      accessToken: bundle.oauth.accessToken
    },
    { transport, maxAttempts: 1 }
  );
  const observations: Record<string, unknown>[] = [];
  let failed = false;
  for (const role of ['seller', 'buyer'] as const) {
    activeRole = role;
    activeOrder = null;
    const requestId = randomUUID();
    try {
      const page = await gateway.request('listTradeOrders', { role, page: 1, pageSize: 1 }, { requestId });
      assert(page.items.every((row) => row.role === role));
      const order = page.items[0];
      if (!order) {
        assert.equal(page.total, 0, 'EMPTY_PAGE_IS_NOT_PROOF_OF_NO_ORDERS');
        observations.push({
          role,
          requestId,
          status: 'no-data',
          count: 0,
          total: 0,
          detail: 'skipped-prerequisite'
        });
        continue;
      }
      activeOrder = order.id;
      const detailRequestId = randomUUID();
      const aggregate = await gateway.request(
        'getTradeOrderAggregate',
        { order, language: 'zh_CN' },
        { requestId: detailRequestId }
      );
      assert(
        aggregate.publicDetail?.orderId === order.id &&
          aggregate.order.role === role &&
          !aggregate.publicDetailError &&
          aggregate.fund === null &&
          aggregate.logistics
      );
      observations.push({
        role,
        requestId,
        detailRequestId,
        status: 'passed',
        count: page.items.length,
        orderFingerprint: createHash('sha256')
          .update(role + ':' + order.id)
          .digest('hex')
          .slice(0, 16),
        orderCorrelated: true,
        totalAmountPresent: aggregate.publicDetail.totalAmount !== null,
        productCount: aggregate.publicDetail.products?.length ?? null,
        logisticsAvailable: true,
        paidAmountUnavailable: true
      });
    } catch (cause) {
      failed = true;
      const error = normalizeGatewayError(cause);
      const forbidden = [
        bundle.application.appKey,
        bundle.application.appSecret,
        bundle.oauth.accessToken
      ].filter(Boolean);
      const safe = (value: string | undefined) =>
        value &&
        /^[A-Za-z0-9_.:-]{1,100}$/u.test(value) &&
        !forbidden.some((secret) => value.includes(secret))
          ? value
          : null;
      observations.push({
        role,
        requestId,
        status: 'failed',
        code: safe(error.code),
        subCode: safe(error.subCode)
      });
    }
  }
  const report = {
    capturedAtUtc: new Date().toISOString(),
    protocol: 'iop',
    runtime: 'node-bff',
    status: failed ? 'failed' : 'passed',
    isolatedCredentials: true,
    configurationChanged: false,
    topRequests: 0,
    tokenRequests: 0,
    mutations: 0,
    network,
    observations
  };
  const output = resolve('artifacts/iop-order-role-validation', randomUUID() + '.json');
  await atomicWriteJson(output, report);
  process.stdout.write(JSON.stringify({ ...report, reportPath: output }) + '\n');
  if (failed) process.exitCode = 1;
}
main().catch(() => {
  process.stderr.write('IOP_ORDER_ROLES_PRECONDITION_FAILED\n');
  process.exitCode = 1;
});
