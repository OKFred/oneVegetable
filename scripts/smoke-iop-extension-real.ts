/** Explicit, one-shot renewal of an isolated IOP candidate; never touches the TOP workbench. */
import { cp, mkdtemp, open, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium, expect, type BrowserContext } from '@playwright/test';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { IOP_API_ORIGIN, isRecord } from '../packages/core/src/alibaba-iop';
import { NetworkManager } from '../packages/core/src/network';
import { atomicWriteJson } from './openapi-auth/storage';
import { signIopParameters } from './openapi-auth/iop-token';
import { summarizeIopProductRead } from './openapi-auth/iop-product-read';

const argument = (name: string): string | undefined =>
  process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
const input = argument('--credential');
if (!input || !process.argv.includes('--confirm-renewal'))
  throw new Error(
    'Provide --credential=<ignored local IOP bundle> --confirm-renewal. Renewal may rotate tokens.'
  );
const raw: unknown = JSON.parse(await readFile(resolve(input), 'utf8'));
const candidate: unknown = isRecord(raw) && 'authorization' in raw ? raw.authorization : raw;
if (
  !isRecord(candidate) ||
  (candidate.protocol !== 'iop' && !process.argv.includes('--confirmed-legacy-iop-marker'))
)
  throw new Error('Explicit IOP marker required. Never infer IOP from a TOP bundle.');
const bundle = parseAlibabaOpenApiCredentialBundle({ ...candidate, protocol: 'iop' });
if (!bundle.oauth.refreshToken) throw new Error('No refresh token; authorize again.');
const requestId = crypto.randomUUID();
const directory = resolve(
  'artifacts/static-iop-validation',
  new Date().toISOString().slice(0, 10),
  requestId
);
const guard = resolve(
  'artifacts/static-iop-validation',
  `input-${createHash('sha256')
    .update(bundle.application.appKey + bundle.oauth.refreshToken)
    .digest('hex')}.json`
);
await atomicWriteJson(resolve(directory, 'receipt.json'), {
  requestId,
  phase: 'prepared',
  configuredCredentialsReplaced: false
});
// Exclusive local guard: a second script must not refresh the same input token again.
const lock = await open(guard, 'wx');
await lock.writeFile(JSON.stringify({ requestId, directory, status: 'reserved' }));
await lock.close();
const passphrase = randomBytes(24).toString('base64url');
let context: BrowserContext | null = null;
let calls = 0;
try {
  const temporary = await mkdtemp(resolve(tmpdir(), 'onevegetable-real-iop-'));
  const extension = resolve(temporary, 'extension');
  await cp(resolve('apps/extension/.output/chrome-mv3'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')) as {
    host_permissions: string[];
  };
  // Isolated smoke copy pregrants the same exact host normally granted by a native user gesture.
  manifest.host_permissions.push(`${IOP_API_ORIGIN}/*`);
  await atomicWriteJson(resolve(extension, 'manifest.json'), manifest);
  context = await chromium.launchPersistentContext(resolve(directory, 'profile'), {
    headless: false,
    locale: 'zh-CN',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  context.on('request', (request) => {
    if (request.url() === `${IOP_API_ORIGIN}/rest/auth/token/refresh`) calls++;
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/authorization.html`);
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.locator('#passphrase').fill(passphrase);
  await page.locator('#file').setInputFiles({
    name: 'credentialInfo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle))
  });
  await expect(page.locator('#status')).toHaveText('已安全保存');
  const baseline = await worker.evaluate(() =>
    (
      globalThis as unknown as { chrome: { storage: { local: { get(key: string): Promise<unknown> } } } }
    ).chrome.storage.local.get('one-vegetable-iop-authorization-v1')
  );
  await atomicWriteJson(resolve(directory, 'encrypted-baseline.json'), baseline);
  await atomicWriteJson(guard, { requestId, directory, status: 'sending' });
  await page.locator('#refresh').click();
  await expect.poll(() => calls, { timeout: 40_000 }).toBe(1);
  await expect(page.locator('#status')).not.toHaveText('正在处理，请勿关闭', { timeout: 45_000 });
  const error = await page.locator('#error').textContent();
  if (error) throw new Error('RENEWAL_NOT_CONFIRMED');
  await expect(page.locator('#export')).toBeEnabled();
  const downloading = page.waitForEvent('download');
  await page.locator('#export').click();
  const file = await downloading;
  const download = await file.path();
  if (!download) throw new Error('EXPORT_NOT_SAVED');
  const next = parseAlibabaOpenApiCredentialBundle(JSON.parse(await readFile(download, 'utf8')) as unknown);
  if (next.protocol !== 'iop' || next.application.appKey !== bundle.application.appKey || calls !== 1)
    throw new Error('UNEXPECTED_RENEWAL_RESULT');
  await atomicWriteJson(resolve(directory, 'credentialInfo.json'), next);
  await atomicWriteJson(guard, { requestId, directory, status: 'completed' });
  const path = '/alibaba/icbu/product/list';
  const parameters = {
    app_key: next.application.appKey,
    access_token: next.oauth.accessToken,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
    simplify: 'true',
    current_page: '1',
    page_size: '1'
  };
  const response = await new NetworkManager({
    policies: {
      alibaba: {
        allowedOrigins: [IOP_API_ORIGIN],
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        timeoutMilliseconds: 30_000,
        maxRequestBytes: 16_384,
        maxResponseBytes: 262_144
      }
    }
  }).request({
    service: 'alibaba',
    url: `${IOP_API_ORIGIN}/rest${path}`,
    method: 'POST',
    requestId: crypto.randomUUID(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({
      ...parameters,
      sign: signIopParameters(path, parameters, next.application.appSecret)
    }),
    maxAttempts: 1
  });
  const result = response.ok ? summarizeIopProductRead(response.data) : null;
  const receipt = {
    requestId,
    status: 'renewal-and-export-passed',
    refreshCalls: calls,
    readStatus: result ? 'passed' : 'not-confirmed',
    readItemCount: result?.itemCount ?? null,
    expiresAtUtc: next.oauth.expiresAtUtc,
    refreshExpiresAtUtc: next.oauth.refreshExpiresAtUtc,
    configuredCredentialsReplaced: false,
    nativePermissionConsentTested: false
  };
  await atomicWriteJson(resolve(directory, 'receipt.json'), receipt);
  console.log(
    JSON.stringify({
      ...receipt,
      outputDirectory: directory,
      warning: 'credentialInfo.json contains plaintext secrets; never commit or share it'
    })
  );
  if (!result) process.exitCode = 1;
} catch {
  await atomicWriteJson(resolve(directory, 'receipt.json'), {
    requestId,
    status: 'not-confirmed-do-not-retry',
    refreshCalls: calls,
    configuredCredentialsReplaced: false
  });
  console.error(
    `IOP smoke not confirmed. Inspect the redacted receipt in ${directory}. Do not repeat the same refresh.`
  );
  process.exitCode = 1;
} finally {
  await context?.close();
}
