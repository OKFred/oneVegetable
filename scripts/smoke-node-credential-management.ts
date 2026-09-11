/** Opt-in, isolated Node acceptance. Never prints credentials or modifies Alibaba business data. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium, request } from '@playwright/test';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import {
  validateGatewayCredentialSummary,
  validateGatewayCredentialTestResult
} from '../packages/core/src/gateway-credential-validation';
import { localNodeNetworkOptions } from './lib/local-node-network';
import { ONBOARDING_STORAGE_KEY, completeOnboarding } from '../packages/core/src/privacy';

if (process.env.ONE_VEGETABLE_REAL_CREDENTIAL_SMOKE !== '1')
  throw new Error('Set ONE_VEGETABLE_REAL_CREDENTIAL_SMOKE=1 to opt in to one read-only Alibaba request.');
const bundle = parseAlibabaOpenApiCredentialBundle(
  JSON.parse(
    await readFile(resolve(process.env.OPEN_API_OUTPUT ?? 'artifacts/openapi-auth/credentials.json'), 'utf8')
  ) as unknown
);
if (bundle.oauth.expiresAtUtc !== null && Date.parse(bundle.oauth.expiresAtUtc) <= Date.now() + 600_000) {
  throw new Error(
    'Refresh the source authorization bundle first. Isolated acceptance must not rotate a live token into a temporary database.'
  );
}
const directory = resolve('artifacts/node-credential-management', randomUUID());
await mkdir(directory, { recursive: true });
const reserved = createServer();
reserved.listen(0, '127.0.0.1');
await once(reserved, 'listening');
const address = reserved.address();
assert(address && typeof address === 'object');
const port = address.port;
await new Promise<void>((done) => {
  reserved.close(() => {
    done();
  });
});
const base = `http://localhost:${port}`;
const web = process.env.CREDENTIAL_SMOKE_WEB_URL ?? 'http://localhost:5173';
const bootstrapToken = randomBytes(32).toString('base64url');
const password = randomBytes(24).toString('base64url');
const childEnvironment: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('ONE_VEGETABLE_ALIBABA_'))
);
Object.assign(childEnvironment, {
  NODE_OPTIONS: localNodeNetworkOptions(process.env.NODE_OPTIONS),
  ONE_VEGETABLE_PORT: String(port),
  ONE_VEGETABLE_ENVIRONMENT: 'local-node',
  ONE_VEGETABLE_GATEWAY_MODE: 'real',
  ONE_VEGETABLE_MUTATION_FLAGS: '',
  ONE_VEGETABLE_CORS_ORIGINS: new URL(web).origin,
  ONE_VEGETABLE_SQLITE_PATH: resolve(directory, 'isolated.sqlite'),
  ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
  BOOTSTRAP_ADMIN_TOKEN: bootstrapToken
});
let child = launch();
function launch() {
  return spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/node.ts'], {
    cwd: process.cwd(),
    env: childEnvironment,
    windowsHide: true,
    stdio: 'ignore'
  });
}
async function stop(): Promise<void> {
  const stopped = once(child, 'exit');
  child.kill();
  await stopped;
}
const http = await request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: new URL(web).origin } });
const checks: string[] = [];
let csrf = '';
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let uiStage = 'API checks';
const uiRequests: { path: string; status: number }[] = [];
async function ready(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await http.get('/api/v1/readyz', { timeout: 1000 })).ok()) return;
    } catch {
      /* bounded startup wait */
    }
    if (child.exitCode !== null) throw new Error('Isolated Node startup failed');
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error('Isolated Node readiness timeout');
}
async function call(path: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  const requestId = randomUUID();
  const response = await http.post(`/api/v1${path}`, {
    data: { requestId, ...payload },
    headers: { 'X-CSRF-Token': csrf }
  });
  const value: unknown = await response.json();
  assert(
    value && typeof value === 'object' && 'requestId' in value && value.requestId === requestId,
    'Response correlation failed'
  );
  assert(
    response.ok() && 'ok' in value && value.ok === true && 'data' in value,
    `Management request failed: ${path} HTTP ${response.status()}`
  );
  return value.data;
}
async function status() {
  const data = await call('/admin/gateway-credentials/get');
  assert(validateGatewayCredentialSummary(data), 'Invalid status contract');
  return data;
}
try {
  await ready();
  await call('/auth/bootstrap', { bootstrapToken, username: 'credential-smoke', password });
  csrf = (await http.storageState()).cookies.find((c) => c.name === 'ov_csrf')?.value ?? '';
  assert(csrf);
  assert.equal((await status()).configured, false);
  checks.push('empty real Node boots and allows administrator login');
  const imported = await call('/admin/gateway-credentials/import', { bundle, revision: null });
  assert(validateGatewayCredentialSummary(imported));
  assert.equal(imported.source, 'sqlite-vault');
  assert.equal(imported.configured, true);
  assert(!JSON.stringify(imported).includes(bundle.application.appSecret), 'Secret in summary');
  checks.push('V1 JSON import encrypted and immediately active');
  const connection = await call('/admin/gateway-credentials/test');
  assert(validateGatewayCredentialTestResult(connection), 'Invalid test contract');
  // Persist only allowlisted diagnostics, never raw provider data or the submitted bundle.
  await writeFile(resolve(directory, 'connection.json'), JSON.stringify(connection, null, 2));
  assert(
    ['passed', 'no-data'].includes(connection.status),
    `Read-only connection result: ${connection.status}/${connection.errorCode ?? 'none'}`
  );
  checks.push('one real listProducts request passed; no product DTO exposed');
  const firstId = imported.configurationId;
  await call('/admin/gateway-credentials/save', {
    credentials: {
      appName: bundle.application.appName,
      appKey: bundle.application.appKey,
      appSecret: bundle.application.appSecret,
      accessToken: bundle.oauth.accessToken,
      refreshToken: null,
      accessTokenExpiresTimeUtc: null,
      refreshTokenExpiresTimeUtc: null
    },
    revision: imported.revision
  });
  const manual = await status();
  assert.equal(manual.inputSource, 'manual');
  assert.equal(manual.canRefresh, false);
  assert.notEqual(manual.configurationId, firstId);
  checks.push('manual whole-set replacement and unknown expiry');
  await stop();
  child = launch();
  await ready();
  assert.equal((await status()).configurationId, manual.configurationId);
  checks.push('restart retains encrypted credentials and session');
  await call('/admin/gateway-credentials/clear', { revision: manual.revision });
  // Deliberately provide the original bundle to the restarted child: tombstone must still win.
  childEnvironment.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE = resolve(
    process.env.OPEN_API_OUTPUT ?? 'artifacts/openapi-auth/credentials.json'
  );
  await stop();
  child = launch();
  await ready();
  assert.equal((await status()).configured, false);
  const blocked = await call('/admin/gateway-credentials/test');
  assert(validateGatewayCredentialTestResult(blocked));
  assert.equal(blocked.status, 'credentials-invalid');
  checks.push('cleared state survives restart without legacy fallback or network');
  await call('/admin/gateway-credentials/import', { bundle, revision: null });
  checks.push('reimport after clear succeeds without restarting');
  if (process.env.CREDENTIAL_SMOKE_UI !== '0') {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: await http.storageState(), locale: 'zh-CN' });
    // The isolated browser represents an existing workbench user; onboarding is tested separately.
    await context.addInitScript(
      ({ key, state }) => {
        localStorage.setItem(key, JSON.stringify(state));
      },
      { key: ONBOARDING_STORAGE_KEY, state: completeOnboarding() }
    );
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    let tests = 0;
    await page.route('**/api/v1/**', async (route) => {
      const original = route.request();
      const path = new URL(original.url()).pathname;
      if (path.endsWith('/gateway-credentials/test')) tests += 1;
      const response = await http.fetch(`${base}${path}`, {
        method: original.method(),
        ...(original.postData() ? { data: original.postData() } : {}),
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }
      });
      uiRequests.push({ path, status: response.status() });
      await route.fulfill({ response });
    });
    uiStage = 'open settings';
    await page.goto(`${web}/#/settings`);
    uiStage = 'credential panel';
    const panel = page.getByTestId('gateway-credential-panel');
    await panel.waitFor();
    await panel.getByText('SQLite 加密配置', { exact: true }).waitFor();
    uiStage = 'advanced form';
    await panel.locator('summary').click();
    await panel.getByRole('button', { name: '手动填写', exact: true }).click();
    const form = page.locator('[role="dialog"]').filter({ has: page.locator('form') });
    await form.waitFor();
    assert.equal(await form.locator('input[type="password"]').count(), 4);
    await form.getByRole('button', { name: '取消', exact: true }).click();
    uiStage = 'clear confirmation';
    await panel.getByRole('button', { name: '清除配置', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal((await status()).configured, true);
    assert.equal(tests, 0);
    await panel.screenshot({ path: resolve(directory, 'node-settings.png') });
    checks.push('real Web settings, advanced fields, cancel confirmation and no automatic test');
    await context.close();
  }
  await writeFile(
    resolve(directory, 'report.json'),
    JSON.stringify(
      {
        capturedAtUtc: new Date().toISOString(),
        checks,
        requestId: connection.requestId,
        businessMutationCount: 0,
        credentialFileModified: false
      },
      null,
      2
    )
  );
  console.log(`Node credential acceptance passed: ${checks.length} checks; report: ${directory}`);
} catch (error: unknown) {
  await writeFile(
    resolve(directory, 'report.json'),
    JSON.stringify(
      { capturedAtUtc: new Date().toISOString(), checks, completed: false, uiStage, uiRequests },
      null,
      2
    )
  );
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : `Credential acceptance failed at ${uiStage}; no sensitive diagnostics were saved.`
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  await http.dispose();
  if (child.exitCode === null) await stop();
}
