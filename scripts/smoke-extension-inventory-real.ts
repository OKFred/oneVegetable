import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { ALIBABA_GATEWAY, parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/index';
import { validateProductInventorySnapshot } from '../packages/core/src/product-inventory';
import { atomicWriteJson } from './openapi-auth/storage';

if (process.env.ONE_VEGETABLE_INVENTORY_SMOKE !== '1') throw new Error('Explicit read-only opt-in required');
const directory = resolve('artifacts/product-inventory-extension-real', randomUUID());
await mkdir(directory, { recursive: true });
const profile = await mkdtemp(resolve(directory, 'profile-'));
const bundle = parseAlibabaOpenApiCredentialBundle(
  JSON.parse(
    await readFile(
      process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ?? 'artifacts/openapi-auth/credentials.json',
      'utf8'
    )
  ) as unknown
);
const extensionPath = resolve('apps/extension/.output/chrome-mv3');
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  locale: 'zh-CN',
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
});
const reports: Record<string, unknown>[] = [];
let stage = 'setup';
let passed = false;
try {
  await context.route('https://eco.taobao.com/**', async (route) => {
    const method = new URLSearchParams(route.request().postData() ?? '').get('method') ?? '';
    if (
      ![
        'alibaba.icbu.product.list',
        'alibaba.icbu.product.inventory.get',
        'alibaba.icbu.product.sku.inventory.get'
      ].includes(method)
    ) {
      await route.abort();
      return;
    }
    await route.continue();
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#/settings`);
  const guide = page.getByRole('dialog', { name: '四步连接 Alibaba 开放平台' });
  await guide.getByRole('checkbox').check();
  await guide.getByRole('button', { name: '稍后，仅浏览' }).click();
  const saved = await page.evaluate(
    async (payload) => {
      const runtime = (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage(value: object): Promise<{ ok: boolean }> } };
        }
      ).chrome.runtime;
      return (
        await runtime.sendMessage({
          requestId: crypto.randomUUID(),
          kind: 'credential-vault-request',
          operation: 'create',
          payload
        })
      ).ok;
    },
    {
      passphrase: randomBytes(24).toString('base64url'),
      settings: {
        appKey: bundle.application.appKey,
        appSecret: bundle.application.appSecret,
        accessToken: bundle.oauth.accessToken,
        endpoint: ALIBABA_GATEWAY,
        signMethod: 'hmac'
      }
    }
  );
  if (!saved) throw new Error('Credential setup failed');
  async function call(operation: string, payload: object): Promise<unknown> {
    const requestId = randomUUID();
    const value = await page.evaluate(
      async (input) => {
        const runtime = (
          globalThis as unknown as { chrome: { runtime: { sendMessage(value: object): Promise<unknown> } } }
        ).chrome.runtime;
        return runtime.sendMessage({ kind: 'gateway-request', ...input });
      },
      { operation, payload, requestId }
    );
    if (!record(value) || value.ok !== true || value.requestId !== requestId) throw new Error('Read failed');
    reports.push({ operation, requestId, ok: true });
    return value.data;
  }
  stage = 'list';
  const products = await call('listProducts', { page: 1, pageSize: 1, language: 'en_US' });
  const first: unknown = record(products) && Array.isArray(products.items) ? products.items[0] : null;
  if (!record(first) || typeof first.id !== 'string') throw new Error('No product prerequisite');
  const productId = first.id;
  async function inventory(source: 'product' | 'sku') {
    const result = await call('getProductInventory', { productId, source, language: 'en_US' });
    if (!validateProductInventorySnapshot(result) || !record(result)) throw new Error('Invalid contract');
    if (result.status !== 'ready' && result.status !== 'no-data') throw new Error('Invalid result');
    reports.push({
      source,
      status: result.status,
      traceId: result.traceId,
      recordCount: Array.isArray(result.records) ? result.records.length : null
    });
  }
  stage = 'inventory';
  await inventory('product');
  await page.waitForTimeout(350);
  await inventory('sku');
  stage = 'restart';
  const before = await worker.evaluate(() => performance.timeOrigin);
  const internals = await context.newPage();
  await internals.goto('chrome://serviceworker-internals');
  await expect(internals.getByText(worker.url(), { exact: true })).toBeVisible();
  await internals.getByText('Stop', { exact: true }).click();
  await expect(internals.locator('body')).toContainText('STOPPED');
  await page.waitForTimeout(350);
  await inventory('product');
  const restarted = context.serviceWorkers().at(-1) ?? (await context.waitForEvent('serviceworker'));
  expect(await restarted.evaluate(() => performance.timeOrigin)).toBeGreaterThan(before);
  passed = true;
} catch {
  process.exitCode = 1;
} finally {
  await atomicWriteJson(resolve(directory, 'report.json'), {
    passed,
    stage,
    capturedAtUtc: new Date().toISOString(),
    mutations: 0,
    reports
  });
  await context.close();
  process.stdout.write(`${JSON.stringify({ passed, stage, report: resolve(directory, 'report.json') })}\n`);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
