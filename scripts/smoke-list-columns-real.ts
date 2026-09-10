import { chromium, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { atomicWriteJson } from './openapi-auth/storage';

if (process.env.ONE_VEGETABLE_LIST_COLUMNS_REAL_SMOKE !== '1')
  throw new Error('Explicit read-only opt-in required');
const auth: unknown = JSON.parse(
  await readFile('artifacts/gallery-transfer-2.6/local/local-auth.json', 'utf8')
);
if (!record(auth) || typeof auth.username !== 'string' || typeof auth.password !== 'string')
  throw new Error('Local authentication unavailable');
const output = resolve('artifacts/list-columns-real');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const allowed = new Set([
  'getDashboard',
  'listProducts',
  'listProductCategories',
  'listProductGroups',
  'listPhotos',
  'listPhotoGroups',
  'listTradeOrders',
  'getProductScore',
  'getTradeOrderAggregate'
]);
const requests: {
  operation: string;
  requestId: string;
  status: number;
  ok: boolean;
  errorCode?: string;
  availability?: Record<string, string>;
}[] = [];
const blocked: string[] = [];
const fields: Record<string, string[]> = {};
const captures: Promise<void>[] = [];
let stage = 'login';
let passed = false;
try {
  await page.route('**/operations/call', async (route) => {
    const body: unknown = route.request().postDataJSON();
    if (!record(body) || typeof body.operation !== 'string' || !allowed.has(body.operation)) {
      blocked.push(record(body) && typeof body.operation === 'string' ? body.operation : 'invalid');
      await route.abort();
      return;
    }
    await route.continue();
  });
  page.on('response', (response) => {
    if (!response.url().endsWith('/operations/call')) return;
    captures.push(
      (async () => {
        const request: unknown = response.request().postDataJSON();
        const body: unknown = await response.json();
        if (
          !record(request) ||
          typeof request.operation !== 'string' ||
          typeof request.requestId !== 'string'
        )
          return;
        requests.push({
          operation: request.operation,
          requestId: request.requestId,
          status: response.status(),
          ok: record(body) && body.ok === true,
          ...(record(body) && record(body.error) && typeof body.error.code === 'string'
            ? { errorCode: body.error.code }
            : {}),
          ...(record(body) && record(body.data) && record(body.data.availability)
            ? {
                availability: Object.fromEntries(
                  Object.entries(body.data.availability).filter(
                    (entry): entry is [string, string] => typeof entry[1] === 'string'
                  )
                )
              }
            : {})
        });
        if (record(body) && record(body.data) && Array.isArray(body.data.items) && record(body.data.items[0]))
          fields[request.operation] = Object.keys(body.data.items[0]);
      })().catch(() => undefined)
    );
  });
  const login = await page.request.post('http://localhost:8886/api/v1/auth/login', {
    data: { requestId: crypto.randomUUID(), username: auth.username, password: auth.password },
    headers: { Origin: 'http://localhost:4286' }
  });
  if (!login.ok()) throw new Error(`Login failed: ${login.status()}`);
  stage = 'products';
  await page.goto('http://localhost:4286/#/products');
  const onboarding = page.getByRole('dialog', { name: '四步连接 Alibaba 开放平台' });
  if (await onboarding.isVisible()) {
    await onboarding.getByRole('checkbox').check();
    await onboarding.getByRole('button', { name: '稍后，仅浏览', exact: true }).click();
  }
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '显示列', exact: true }).click();
  await page.getByRole('checkbox', { name: '型号', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: '型号', exact: true })).toBeVisible();
  const link = page.locator('table tbody a[target="_blank"]').first();
  if (await link.count()) await expect(link).toHaveAttribute('href', /^https:\/\/[^/]*alibaba\.com\//);
  await expect
    .poll(() => requests.some((request) => request.operation === 'getProductScore' && request.ok), {
      timeout: 30_000
    })
    .toBe(true);
  const scoreStop = page.getByRole('button', { name: '停止', exact: true });
  if (await scoreStop.isVisible()) await scoreStop.click();
  await page.screenshot({
    path: resolve(output, 'products.png'),
    mask: [page.locator('[data-feedback-redact]')]
  });
  stage = 'photos';
  await page.getByRole('link', { name: '图库', exact: true }).click();
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.getByRole('button', { name: '显示列', exact: true }).click();
  await page.getByRole('checkbox', { name: '分组路径', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: '分组路径', exact: true })).toBeVisible();
  stage = 'orders';
  await page.getByRole('link', { name: '订单', exact: true }).click();
  await page.getByRole('button', { name: '显示列', exact: true }).click();
  await page.getByRole('checkbox', { name: '创建时间', exact: true }).check();
  await page.getByRole('checkbox', { name: '已付金额', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: '已付金额', exact: true })).toBeVisible();
  {
    await expect
      .poll(() => requests.some((request) => request.operation === 'getTradeOrderAggregate'), {
        timeout: 30_000
      })
      .toBe(true);
    const stop = page.getByRole('button', { name: '停止', exact: true });
    if (await stop.isVisible()) await stop.click();
    await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0, {
      timeout: 120_000
    });
  }
  await Promise.all(captures);
  expect(fields.listProducts).toContain('ownerName');
  expect(fields.listPhotos).toContain('originalName');
  expect(blocked).toEqual([]);
  expect(requests.every((request) => request.ok)).toBe(true);
  passed = true;
} finally {
  await Promise.all(captures);
  await atomicWriteJson(resolve(output, 'report.json'), {
    capturedAt: new Date().toISOString(),
    passed,
    stage,
    requests,
    fields,
    blocked,
    mutations: 0
  });
  await browser.close();
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
