import { chromium, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { atomicWriteJson } from './openapi-auth/storage';
import { parseS3StorageConfiguration } from '../packages/core/src/s3-storage';

if (process.env.ONE_VEGETABLE_GALLERY_REAL_SMOKE !== '1')
  throw new Error('Explicit real gallery smoke opt-in required');
const directory = resolve(
  process.env.ONE_VEGETABLE_GALLERY_SMOKE_OUTPUT ?? 'artifacts/gallery-transfer-2.6/local'
);
const auth: unknown = JSON.parse(
  await readFile(resolve('artifacts/gallery-transfer-2.6/local/local-auth.json'), 'utf8')
);
if (
  !record(auth) ||
  typeof auth.username !== 'string' ||
  typeof auth.password !== 'string' ||
  typeof auth.bootstrapToken !== 'string'
)
  throw new Error('Local smoke authentication missing');
const configuration = parseS3StorageConfiguration(
  JSON.parse(
    await readFile(
      process.env.ONE_VEGETABLE_GALLERY_SMOKE_CONFIGURATION ??
        'artifacts/gallery-transfer-2.6/rustfs-config.json',
      'utf8'
    )
  ) as unknown
);
const context = await chromium.launchPersistentContext(resolve(directory, 'profile'), {
  headless: true,
  locale: 'zh-CN',
  viewport: { width: 1440, height: 1000 }
});
const page = context.pages()[0] ?? (await context.newPage());
const requests: { operation: string; requestId: string; ok?: boolean; code?: string }[] = [];
let stage = 'authentication';
page.on('response', (response) => {
  if (!response.url().endsWith('/operations/call')) return;
  void (async () => {
    const request: unknown = response.request().postDataJSON();
    const body: unknown = await response.json();
    if (record(request) && typeof request.operation === 'string' && typeof request.requestId === 'string')
      requests.push({
        operation: request.operation,
        requestId: request.requestId,
        ...(record(body)
          ? {
              ok: body.ok === true,
              ...(record(body.error) && typeof body.error.code === 'string' ? { code: body.error.code } : {})
            }
          : {})
      });
  })().catch(() => undefined);
});
try {
  const bootstrap = await page.request.post('http://localhost:8886/api/v1/auth/bootstrap', {
    data: {
      requestId: crypto.randomUUID(),
      bootstrapToken: auth.bootstrapToken,
      username: auth.username,
      password: auth.password
    },
    headers: { Origin: 'http://localhost:4286' }
  });
  if (!bootstrap.ok()) {
    const login = await page.request.post('http://localhost:8886/api/v1/auth/login', {
      data: { requestId: crypto.randomUUID(), username: auth.username, password: auth.password },
      headers: { Origin: 'http://localhost:4286' }
    });
    if (!login.ok()) throw new Error(`Login failed: ${login.status()}`);
  }
  const csrf = (await context.cookies()).find((cookie) => cookie.name === 'ov_csrf')?.value;
  if (!csrf) throw new Error('Missing CSRF');
  async function post(path: string, body: Record<string, unknown>) {
    const response = await page.request.post(`http://localhost:8886/api/v1/${path}`, {
      data: { requestId: crypto.randomUUID(), ...body },
      headers: { Origin: 'http://localhost:4286', 'X-CSRF-Token': csrf ?? '' }
    });
    const result: unknown = await response.json();
    if (!response.ok() || !record(result) || !result.ok)
      throw new Error(
        `${path}: ${record(result) && record(result.error) ? String(result.error.code) : response.status()}`
      );
    return result.data;
  }
  stage = 'configure-isolated-s3';
  const previous = await post('admin/storage/s3/get', {});
  await post('admin/storage/s3/update', {
    configuration,
    revision: record(previous) ? previous.revision : null,
    remark: 'Isolated 2.6.0 local RustFS validation'
  });
  await post('admin/storage/s3/test', {});
  const system = await post('admin/system/get', {});
  if (!record(system) || system.gatewayMode !== 'real')
    throw new Error('Real gateway is required; refusing Mock');
  const groupName = process.env.ONE_VEGETABLE_GALLERY_SMOKE_GROUP ?? 'ov-260-local-20260910';
  await page.addInitScript(
    ({ groupName }) => {
      localStorage.setItem(
        'one-vegetable:preferences:v2',
        JSON.stringify({ uiLocale: 'zh-CN', alibabaLanguage: 'en_US', theme: 'dark' })
      );
      localStorage.setItem(
        'one-vegetable:gallery-import-rules:v1',
        JSON.stringify({
          schemaVersion: 1,
          conflictPolicy: 'rename',
          rules: [
            {
              id: 'local-smoke',
              name: 'Local smoke',
              enabled: true,
              sourcePrefix: 'source/',
              includeGlob: '**',
              excludeGlobs: [],
              targetGroupPath: groupName
            }
          ]
        })
      );
    },
    { groupName }
  );
  await page.goto('http://localhost:4286/#/photos');
  await expect(page.getByRole('heading', { name: /四步连接 Alibaba 开放平台|图库/ }).first()).toBeVisible({
    timeout: 30_000
  });
  const onboarding = page.getByRole('button', { name: '稍后，仅浏览' });
  if (await onboarding.isVisible()) {
    await page.getByRole('checkbox').check();
    await onboarding.click();
  }
  await expect(page.getByRole('heading', { name: '图库', exact: true })).toBeVisible({ timeout: 60_000 });
  stage = 'preview';
  await page.getByRole('button', { name: '导入', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入图库素材' });
  await dialog.getByRole('button', { name: 'S3', exact: true }).click();
  await dialog.getByRole('button', { name: /扫描/ }).click();
  await expect(dialog.getByRole('button', { name: '导入', exact: true })).toBeEnabled({ timeout: 60_000 });
  await dialog.getByRole('button', { name: '导入', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '确认导入图库', exact: true });
  await expect(confirmation).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: resolve(directory, 'preview.png') });
  // Runs are not repeated automatically: existing durable tasks are inspected first.
  const existing = await tasks(page);
  if (existing.length)
    throw new Error('Existing transfer receipts found; inspect them before creating another real task');
  stage = 'execute';
  await confirmation.getByRole('button', { name: '导入', exact: true }).click();
  await expect
    .poll(async () => (await tasks(page)).map((task) => task.status), {
      timeout: 180_000,
      intervals: [1000, 2000]
    })
    .toContain('completed');
  await page.screenshot({ path: resolve(directory, 'completed.png') });
  const results = await tasks(page);
  if (
    requests.some(
      (request) =>
        !['listPhotos', 'listPhotoGroups', 'uploadPhoto', 'operatePhotoGroup'].includes(request.operation)
    )
  )
    throw new Error('Unexpected business operation; inspect report');
  await atomicWriteJson(resolve(directory, 'web-real-report.json'), {
    status: 'passed',
    stage,
    requests,
    tasks: results,
    productMutations: 0
  });
  console.log('Real RustFS → BFF → Alibaba gallery task completed and verified.');
} catch (error) {
  await atomicWriteJson(resolve(directory, 'web-real-report.json'), {
    status: 'incomplete',
    stage,
    reason: error instanceof Error ? error.message.slice(0, 400) : 'unknown',
    requests,
    tasks: await tasks(page).catch(() => [])
  });
  await page.screenshot({ path: resolve(directory, 'failure.png') }).catch(() => undefined);
  console.log(`Real gallery validation stopped at ${stage}; inspect redacted local report.`);
  process.exitCode = 1;
} finally {
  await context.close();
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
async function tasks(page: Page): Promise<
  {
    id: string;
    status: string;
    items: { kind: string; status: string; requestId: string | null; errorCode: string | null }[];
  }[]
> {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((db) => db.name === 'one-vegetable-gallery-transfers-v1'))
      return [];
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('one-vegetable-gallery-transfers-v1');
      open.onerror = () => {
        reject(new Error('Database unavailable'));
      };
      open.onsuccess = () => {
        const db = open.result;
        const request = db.transaction('tasks').objectStore('tasks').getAll();
        request.onerror = () => {
          db.close();
          reject(new Error('Read failed'));
        };
        request.onsuccess = () => {
          const values: unknown[] = request.result;
          const rows = values.filter(
            (
              value
            ): value is {
              id: string;
              status: string;
              items: { kind: string; status: string; requestId: string | null; errorCode: string | null }[];
            } =>
              typeof value === 'object' &&
              value !== null &&
              'id' in value &&
              typeof value.id === 'string' &&
              'status' in value &&
              typeof value.status === 'string' &&
              'items' in value &&
              Array.isArray(value.items)
          );
          db.close();
          resolve(
            rows.map((row) => ({
              id: row.id,
              status: row.status,
              items: row.items.map((item) => ({
                kind: item.kind,
                status: item.status,
                requestId: item.requestId,
                errorCode: item.errorCode
              }))
            }))
          );
        };
      };
    });
  });
}
