/** Isolated read-only acceptance: no active configuration changes, token refresh or business writes. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { NativeFetchTransport, type NetworkTransport } from '../packages/core/src/network';
import { normalizeGatewayError } from '../packages/core/src/errors';
import { CredentialBackedAlibabaGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import {
  GatewayCredentialCipher,
  GatewayCredentialService,
  SqlGatewayCredentialRepository,
  StoredAlibabaCredentialProvider
} from '../apps/api/src/gateway/credential-vault';
import { DualAlibabaAuthorization } from '../apps/api/src/gateway/dual-authorization';
import { applyNodeMigrations, openNodeDatabase } from '../apps/api/src/db/node-database';
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
  'Provide --top=<ignored bundle> --iop=<ignored bundle> --confirm-read-only --confirm-same-merchant. No active settings are changed.'
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
      'Expired/near-expiry bundle: reauthorize separately. This tool never refreshes tokens.'
    );
const native = new NativeFetchTransport();
let sent = 0;
const transport: NetworkTransport = {
  async send(input, init) {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const allowed =
      (url.origin === 'https://eco.taobao.com' &&
        [
          'alibaba.icbu.product.list',
          'alibaba.icbu.photobank.list',
          'alibaba.icbu.photobank.group.list'
        ].includes(
          (init.body instanceof URLSearchParams
            ? init.body
            : new URLSearchParams(typeof init.body === 'string' ? init.body : '')
          ).get('method') ?? ''
        )) ||
      (url.origin === 'https://openapi-api.alibaba.com' &&
        [
          '/rest/alibaba/icbu/product/list',
          '/rest/icbu/product/photobank/list',
          '/rest/icbu/product/photobank/group/list'
        ].includes(url.pathname));
    assert(allowed, 'Acceptance transport blocked an unexpected endpoint/method');
    assert(++sent <= 8, 'Acceptance request budget exceeded');
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
  protocol: 'top' | 'iop';
  requestId: string;
  status: string;
  count?: number;
  errorCode?: string;
  subCode?: string;
}[] = [];
try {
  // Strip refresh capability only from the ephemeral copy so no read can rotate a live token.
  for (const [protocol, bundle] of [
    ['top', top],
    ['iop', iop]
  ] as const)
    await (
      await dual.service(protocol)
    ).import({
      bundle: { ...bundle, oauth: { ...bundle.oauth, refreshToken: null, refreshExpiresAtUtc: null } },
      actorId: 'local-read-acceptance',
      expectedRevision: null,
      remark: null
    });
  const pool = await dual.authorizations();
  assert(pool.top?.configurationId && pool.iop?.configurationId);
  await dual.confirm(pool.top.configurationId, pool.iop.configurationId, 'local-read-acceptance');
  const client = new CredentialBackedAlibabaGatewayClient(dual, { transport, maxAttempts: 1 });
  const call = async <T>(
    operation: string,
    protocol: 'top' | 'iop',
    fn: (requestId: string) => Promise<T>,
    count: (value: T) => number
  ): Promise<T | null> => {
    const requestId = crypto.randomUUID();
    try {
      const value = await fn(requestId);
      const size = count(value);
      records.push({ operation, protocol, requestId, status: size ? 'passed' : 'no-data', count: size });
      return value;
    } catch (cause) {
      const error = normalizeGatewayError(cause);
      records.push({
        operation,
        protocol,
        requestId,
        status: 'failed',
        errorCode: error.code,
        ...(error.subCode ? { subCode: error.subCode } : {})
      });
      process.exitCode = 1;
      return null;
    }
  };
  assert.equal(await dual.selectProtocol('listProducts', {}), 'iop');
  await call(
    'listProducts',
    'iop',
    (requestId) => client.request('listProducts', { page: 1, pageSize: 2, language: 'en_US' }, { requestId }),
    (value) => value.items.length
  );
  assert.equal(await dual.selectProtocol('listPhotos', {}), 'top');
  await call(
    'listPhotos:all',
    'top',
    (requestId) => client.request('listPhotos', { page: 1, pageSize: 2 }, { requestId }),
    (value) => value.items.length
  );
  const groups = await call(
    'listPhotoGroups',
    'iop',
    (requestId) => client.request('listPhotoGroups', undefined, { requestId }),
    (value) => value.length
  );
  const group = groups?.[0];
  if (group) {
    const request = { page: 1, pageSize: 2, groupId: group.id };
    // IOP photo scope is unverified; dual profiles must choose TOP before sending.
    assert.equal(await dual.selectProtocol('listPhotos', request), 'top');
    await call(
      'listPhotos:group',
      'top',
      (requestId) => client.request('listPhotos', request, { requestId }),
      (value) => value.items.length
    );
  } else
    records.push({
      operation: 'listPhotos:group',
      protocol: 'iop',
      requestId: crypto.randomUUID(),
      status: 'skipped-prerequisite'
    });
} finally {
  db.connection.close();
  const receipt = resolve(
    `artifacts/dual-alibaba-read-validation/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.json`
  );
  await atomicWriteJson(receipt, {
    capturedAtUtc: new Date().toISOString(),
    sent,
    readOnly: true,
    refreshEnabled: false,
    records
  });
  process.stdout.write(`${JSON.stringify({ receipt, sent, records }, null, 2)}\n`);
}
