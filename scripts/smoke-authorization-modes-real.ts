/** Isolated authenticated BFF acceptance. No production config, Token refresh or provider writes. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BffGatewayClient } from '../packages/core/src/index';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { NativeFetchTransport } from '../packages/core/src/network';
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
import { assertIgnoredFile } from './smoke-product-reference-real';
import {
  AUTHORIZATION_MODES,
  READ_PROBE_IDS,
  profiles,
  runReadPlan,
  type AuthorizationMode,
  type Observation
} from './lib/authorization-mode-regression';
import { ReadWireGuard } from './lib/authorization-mode-wire';

export function parseModeOptions(args: readonly string[]) {
  const get = (key: string) =>
    args.find((value) => value.startsWith('--' + key + '='))?.slice(key.length + 3);
  const top = get('top'),
    iop = get('iop'),
    productId = get('product-id'),
    predictionTitle = get('prediction-title');
  const output = get('output');
  if (
    !top ||
    !iop ||
    !output ||
    !productId ||
    !/^\d+$/u.test(productId) ||
    !predictionTitle?.trim() ||
    !args.includes('--confirm-read-only') ||
    !args.includes('--confirm-same-merchant')
  )
    throw new Error('EXPLICIT_IGNORED_INPUTS_AND_READ_CONFIRMATION_REQUIRED');
  const modes = get('modes')?.split(',') ?? [...AUTHORIZATION_MODES];
  if (
    !modes.length ||
    new Set(modes).size !== modes.length ||
    modes.some((mode) => !AUTHORIZATION_MODES.includes(mode as AuthorizationMode))
  )
    throw new Error('REGRESSION_MODE_INVALID');
  const probes = get('probes')?.split(',');
  if (probes?.some((id) => !(READ_PROBE_IDS as readonly string[]).includes(id)))
    throw new Error('PROBE_ID_INVALID');
  return {
    top,
    iop,
    productId,
    predictionTitle,
    output,
    modes: modes as AuthorizationMode[],
    ...(probes ? { probes } : {})
  };
}
export async function readModeBundles(options: ReturnType<typeof parseModeOptions>) {
  const root = resolve(import.meta.dirname, '..');
  const read = async (path: string) => {
    await assertIgnoredFile(root, resolve(root, path));
    const bundle = parseAlibabaOpenApiCredentialBundle(
      JSON.parse(await readFile(resolve(root, path), 'utf8')) as unknown
    );
    if (bundle.oauth.expiresAtUtc && Date.parse(bundle.oauth.expiresAtUtc) <= Date.now() + 600_000)
      throw new Error('EXPIRED_CANDIDATE_NO_REFRESH_ALLOWED');
    return { ...bundle, oauth: { ...bundle.oauth, refreshToken: null, refreshExpiresAtUtc: null } };
  };
  const top = await read(options.top),
    iop = await read(options.iop);
  assert.equal(top.protocol ?? 'top', 'top');
  assert.equal(iop.protocol, 'iop');
  await assertIgnoredFile(root, resolve(root, options.output));
  assert(resolve(root, options.output).startsWith(resolve(root, 'artifacts') + sep));
  return { top, iop };
}
export async function runBffMode(
  mode: AuthorizationMode,
  bundles: Awaited<ReturnType<typeof readModeBundles>>,
  options: { productId: string; predictionTitle: string; probes?: readonly string[] }
) {
  const guard = new ReadWireGuard(),
    transport = guard.transport(new NativeFetchTransport());
  const db = openNodeDatabase(':memory:');
  applyNodeMigrations(db);
  const cipher = await GatewayCredentialCipher.create(randomBytes(32).toString('base64url'));
  const repository = new SqlGatewayCredentialRepository(db.executor);
  const service = new GatewayCredentialService(repository, cipher);
  const protocolOrder = profiles(mode);
  const importOptions = { actorId: 'mode-regression', expectedRevision: null, remark: null };
  const firstProtocol = protocolOrder[0];
  assert(firstProtocol);
  await service.import({ ...importOptions, bundle: bundles[firstProtocol] });
  const primary = {
    service,
    provider: new StoredAlibabaCredentialProvider(repository, cipher, { transport }),
    summary: () => service.status()
  };
  const dual = new DualAlibabaAuthorization(db.executor, cipher, primary, { transport });
  for (const protocol of protocolOrder.slice(1))
    await (await dual.service(protocol)).import({ ...importOptions, bundle: bundles[protocol] });
  const before = await dual.authorizations();
  const bootstrapToken = randomUUID();
  const auth = new AuthService({ repository: new SqlAuthRepository(db.executor), bootstrapToken });
  const session = await auth.bootstrap({
    requestId: randomUUID(),
    bootstrapToken,
    username: 'mode-regression',
    password: randomBytes(32).toString('base64url')
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
            Cookie: 'ov_session=' + session.sessionToken
          }
        })
    }
  });
  const observations: Observation[] = [];
  try {
    assert.equal(before.defaultProtocol, protocolOrder[0]);
    assert.equal(before.top?.configured ?? false, protocolOrder.includes('top'));
    assert.equal(before.iop?.configured ?? false, protocolOrder.includes('iop'));
    await runReadPlan(mode, client, guard, observations, options);
    assert.deepEqual(
      await dual.authorizations(),
      before,
      'Read acceptance must not change credentials/defaults.'
    );
    return { mode, runtime: 'node-bff', profilesPreserved: true, observations, network: guard.snapshot() };
  } finally {
    db.connection.close();
  }
}
export async function main(args: readonly string[]) {
  const options = parseModeOptions(args),
    bundles = await readModeBundles(options);
  const results = [];
  for (const mode of options.modes) {
    const result = await runBffMode(mode, bundles, options);
    results.push(result);
    await atomicWriteJson(resolve(options.output), {
      schemaVersion: 1,
      runtime: 'node-bff',
      capturedAtUtc: new Date().toISOString(),
      readOnly: true,
      results
    });
    console.log(
      JSON.stringify({
        mode,
        statuses: result.observations.reduce<Record<string, number>>(
          (all, item) => ({ ...all, [item.status]: (all[item.status] ?? 0) + 1 }),
          {}
        ),
        failures: result.observations.filter((item) => ['failed', 'credential-blocked'].includes(item.status))
      })
    );
  }
  if (
    results.some((result) =>
      result.observations.some((item) => ['failed', 'credential-blocked'].includes(item.status))
    )
  )
    process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        failure: 'AUTHORIZATION_MODE_REGRESSION_FAILED',
        kind: error instanceof Error ? error.name : 'unknown',
        location:
          error instanceof Error
            ? error.stack
                ?.split('\n')
                .slice(1, 4)
                .filter((line) => line.includes('smoke-authorization-modes-real.ts'))
            : []
      })
    );
    process.exitCode = 1;
  });
