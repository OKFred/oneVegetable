/** One fresh, bounded IOP delta experiment. No TOP/configuration changes or automatic retries. */
import { open, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { AlibabaClient } from '../packages/core/src/alibaba-client';
import {
  createIopBusinessRequest,
  normalizeIopBusinessResponse
} from '../packages/core/src/alibaba-iop-business';
import { IOP_BUSINESS_ENDPOINT, isRecord } from '../packages/core/src/alibaba-iop';
import {
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../packages/core/src/capability-registry';
import { NativeFetchTransport, NetworkManager } from '../packages/core/src/network';
import { normalizeGatewayError } from '../packages/core/src/errors';
import { atomicWriteJson } from './openapi-auth/storage';
import { inventoryCells, type Assessment, type InventoryCell } from './lib/free-api-real-smoke';
import { verifyIopInventoryCycle } from './lib/iop-inventory-acceptance';

const keys = ['--credential=', '--receipt=', '--product-id=', '--sku-id=', '--warehouse='];
const args = process.argv.slice(2);
if (
  args.length !== keys.length + 1 ||
  !args.includes('--confirm-real-write') ||
  keys.some((key) => args.filter((arg) => arg.startsWith(key)).length !== 1)
)
  throw new Error(
    'Provide credential, NEW ignored receipt, product-id, sku-id, warehouse and --confirm-real-write'
  );
const option = (key: string) => args.find((arg) => arg.startsWith(key))?.slice(key.length) ?? '';
const productId = Number(option('--product-id=')),
  skuId = Number(option('--sku-id=')),
  warehouse = option('--warehouse=');
if (![productId, skuId].every((id) => Number.isSafeInteger(id) && id > 0) || !warehouse.trim())
  throw new Error('INVALID_TARGET');
const path = resolve(option('--receipt='));
if (!path.startsWith(resolve('artifacts') + sep)) throw new Error('IGNORED_RECEIPT_REQUIRED');
const bundle = parseAlibabaOpenApiCredentialBundle(
  JSON.parse(await readFile(resolve(option('--credential=')), 'utf8')) as unknown
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
const method = 'alibaba.icbu.product.inventory.update';
const runId = crypto.randomUUID();
const report = {
  runId,
  protocol: 'iop',
  productId,
  skuId,
  warehouse,
  capturedAtUtc: new Date().toISOString(),
  status: 'prepared',
  writes: 0,
  configurationChanged: false,
  historicalReceiptsResolved: false,
  events: [] as { phase: string; recordedAtUtc: string; result: Assessment; inventory?: InventoryCell[] }[]
};
// Exclusive creation prevents re-running this receipt; it is retained even after a crash.
await mkdir(dirname(path), { recursive: true });
const claim = await open(path + '.claim', 'wx', 0o600);
try {
  await claim.writeFile(runId);
  await claim.sync();
} finally {
  await claim.close();
}
const persist = () => atomicWriteJson(path, report);
await persist();
const native = new NativeFetchTransport();
let lastRequest = 0,
  requestCount = 0;
const network = new NetworkManager({
  transport: {
    async send(input, init) {
      const request = new Request(input, init),
        url = new URL(request.url);
      if (
        url.origin !== 'https://openapi-api.alibaba.com' ||
        request.method !== 'POST' ||
        url.search ||
        !['/rest/icbu/product/inventory/get', '/rest/icbu/product/inventory/update'].includes(url.pathname) ||
        ++requestCount > 40
      )
        throw new Error('BOUNDED_IOP_INVENTORY_ONLY');
      if (url.pathname.endsWith('/update') && ++report.writes > 2) throw new Error('NO_MUTATION_RETRY');
      await delay(Math.max(0, 350 - (Date.now() - lastRequest)));
      lastRequest = Date.now();
      return native.send(request);
    }
  },
  policies: {
    alibaba: { allowedOrigins: ['https://openapi-api.alibaba.com'], redirect: 'error', cache: 'no-store' }
  }
});
const client = new AlibabaClient(credentials, network, { maxAttempts: 1 });
const record = async (phase: string, result: Assessment, inventory?: InventoryCell[] | null) => {
  const event = {
    phase,
    recordedAtUtc: new Date().toISOString(),
    result,
    ...(inventory ? { inventory } : {})
  };
  report.events.push(event);
  await persist();
  const file = await open(path + '.' + phase + '.json', 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(event));
    await file.sync();
  } finally {
    await file.close();
  }
  process.stdout.write(
    JSON.stringify({
      phase,
      status: result.status,
      reason: result.reason,
      quantity: inventory?.find((cell) => cell.skuId === skuId && cell.code === warehouse)?.quantity ?? null
    }) + '\n'
  );
};
try {
  const result = await verifyIopInventoryCycle({
    skuId,
    inventoryCode: warehouse,
    record,
    wait: () => delay(10_000),
    read: async () => {
      const response = await client.call('alibaba.icbu.product.inventory.get', {
        product_id: productId,
        language: 'en_US'
      });
      const root = isRecord(response.data) ? response.data.alibaba_icbu_product_inventory_get_response : null;
      return inventoryCells(root);
    },
    write: async (operate, cell): Promise<Assessment> => {
      const parameters = {
        request_param: {
          product_id: productId,
          inventory_list: [{ operate, inventory_code: cell.code, sku_id: cell.skuId, inventory: 1 }]
        }
      };
      if ((await validateCapabilityRequest(method, parameters)).length) throw new Error('INVALID_REQUEST');
      const signed = await createIopBusinessRequest(credentials, method, parameters);
      const requestId = crypto.randomUUID();
      // Persist the exact target/delta and request ID before dispatch, independently of the aggregate report.
      const file = await open(path + '.' + operate + '.intent.json', 'wx', 0o600);
      try {
        await file.writeFile(
          JSON.stringify({ requestId, method, productId, skuId, warehouse, operate, delta: 1 })
        );
        await file.sync();
      } finally {
        await file.close();
      }
      try {
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
        const root = isRecord(normalized) ? normalized.alibaba_icbu_product_inventory_update_response : null;
        if ((await validateCapabilityResponse(method, root)).length)
          throw new Error('WRITE_RESPONSE_CONTRACT_DRIFT');
        return { status: 'passed', reason: 'BUSINESS_ACKNOWLEDGED', requestId };
      } catch (cause) {
        const error = normalizeGatewayError(cause);
        return {
          status:
            error.code === 'ALIBABA_IOP_BUSINESS_REJECTED' || error.code === 'ALIBABA_IOP_API_REJECTED'
              ? 'provider-error'
              : 'result-unknown',
          reason: error.code,
          requestId,
          ...(error.subCode ? { providerCode: error.subCode } : {}),
          ...(error.traceId ? { traceId: error.traceId } : {})
        };
      }
    }
  });
  report.status = result.status;
  await record('final', result);
} catch (cause) {
  const error = normalizeGatewayError(cause);
  report.status = report.writes ? 'result-unknown' : 'failed';
  await record('failure', {
    status: report.writes ? 'result-unknown' : 'skipped-prerequisite',
    reason: error.code
  });
} finally {
  await persist();
  process.stdout.write(
    JSON.stringify({ receipt: path, status: report.status, writes: report.writes }) + '\n'
  );
  if (report.status !== 'passed') process.exitCode = 1;
}
