import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { atomicWriteJson } from './openapi-auth/storage';

declare const chrome: {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  permissions: { contains(input: { origins: string[] }): Promise<boolean> };
};

// Read-only follow-up: reuse the actual native grant; never repeat successful PUTs.
if (process.env.ONE_VEGETABLE_EXTENSION_S3_SMOKE !== '1') throw new Error('Explicit opt-in required.');
const profile = process.env.ONE_VEGETABLE_S3_SMOKE_PROFILE;
if (!profile) throw new Error('An existing permission-granted profile is required.');
const directory = resolve('artifacts/gallery-transfer-2.6/extension-rustfs');
const receipt: unknown = JSON.parse(await readFile(resolve(directory, 'report.json'), 'utf8'));
if (!isRecord(receipt) || typeof receipt.prefix !== 'string') throw new Error('Missing prior receipt.');
const prefix = receipt.prefix;
const bytes = await readFile('apps/extension/public/icon.png');
const digest = createHash('sha256').update(bytes).digest('hex');
const extension = resolve('apps/extension/.output/chrome-mv3');
const context = await chromium.launchPersistentContext(resolve(profile), {
  headless: false,
  locale: 'zh-CN',
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
});
let stage = 'initialize';
const checks: { stage: string; requestId: string; ok: boolean }[] = [];
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#/settings`);
  const granted = await page.evaluate(() =>
    chrome.permissions.contains({ origins: ['http://192.168.1.4:9000/*'] })
  );
  if (!granted) throw new Error('PERMISSION_MISSING');
  const check = async () => {
    const requestId = crypto.randomUUID();
    const response: unknown = await page.evaluate((message) => chrome.runtime.sendMessage(message), {
      kind: 's3-storage-request',
      requestId,
      operation: 'get',
      payload: { key: `${prefix}/assets/extension.png` }
    });
    const ok =
      isRecord(response) &&
      response.ok === true &&
      isRecord(response.data) &&
      typeof response.data.contentBase64 === 'string' &&
      createHash('sha256').update(Buffer.from(response.data.contentBase64, 'base64')).digest('hex') ===
        digest;
    checks.push({ stage, requestId, ok });
    if (!ok) throw new Error('READBACK_FAILED');
  };
  stage = 'before-restart';
  await check();
  console.log('Existing native permission and readback confirmed. Restarting worker without writes.');
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  stage = 'stop-worker';
  await cdp.send('ServiceWorker.stopAllWorkers');
  stage = 'reload';
  await page.reload();
  stage = 'after-restart';
  await check();
  await atomicWriteJson(resolve(directory, 'restart-report.json'), {
    capturedAtUtc: new Date().toISOString(),
    status: 'passed',
    checks,
    mutationRequests: 0,
    permissionMode: 'existing-production-optional-grant',
    sha256: digest
  });
  console.log('Extension restart and existing-object digest verified; no writes.');
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  const reason =
    [
      'PERMISSION_MISSING',
      'READBACK_FAILED',
      'Target closed',
      'Target page, context or browser has been closed',
      'Timeout',
      'ERR_FILE_NOT_FOUND'
    ].find((value) => message.includes(value)) ?? 'UNCLASSIFIED';
  await atomicWriteJson(resolve(directory, 'restart-report.json'), {
    capturedAtUtc: new Date().toISOString(),
    status: 'failed',
    stage,
    reason,
    checks,
    mutationRequests: 0
  });
  console.error(`Read-only extension verification failed: ${stage} / ${reason}`);
  process.exitCode = 1;
} finally {
  await context.close();
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
