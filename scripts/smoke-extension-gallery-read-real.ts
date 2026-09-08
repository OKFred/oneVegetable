import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';
import { ALIBABA_GATEWAY, parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/index';
import { atomicWriteJson } from './openapi-auth/storage';

// Explicit opt-in; credentials stay in an isolated local profile and never in reports.
if (process.env.ONE_VEGETABLE_EXTENSION_GALLERY_READ_SMOKE !== '1') {
  throw new Error('Set ONE_VEGETABLE_EXTENSION_GALLERY_READ_SMOKE=1 for real read-only validation.');
}
const directory = resolve('artifacts/extension-gallery-validation');
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
const calls: { operation: string; requestId: string; ok: boolean; errorCode?: string }[] = [];
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const page = await context.newPage();
  const base = `chrome-extension://${new URL(worker.url()).host}/options.html`;
  await page.goto(base);
  const onboarding = page.getByRole('dialog', { name: '四步连接 Alibaba 开放平台' });
  await expect(onboarding).toBeVisible();
  await onboarding.getByRole('checkbox').check();
  await onboarding.getByRole('button', { name: '稍后，仅浏览' }).click();
  const result = await page.evaluate(
    async (payload) => {
      const extension = (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage(value: object): Promise<{ ok: boolean }> } };
        }
      ).chrome;
      const result = await extension.runtime.sendMessage({
        requestId: crypto.randomUUID(),
        kind: 'credential-vault-request',
        operation: 'create',
        payload
      });
      return result.ok;
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
  if (!result) throw new Error('Credential setup failed');
  await page.goto(`${base}#/photos`);
  await expect(page.getByRole('heading', { name: '图库', exact: true })).toBeVisible();
  const groups = await call(page, 'listPhotoGroups');
  const photos = await call(page, 'listPhotos', { page: 1, pageSize: 24 });
  if (!Array.isArray(groups) || !isRecord(photos) || !Array.isArray(photos.items)) {
    throw new Error('Unexpected gallery response structure');
  }
  const testRoot: unknown = groups.find(
    (group: unknown) => isRecord(group) && group.name === 'S3-fresh-0908'
  );
  let nestedGroupConfirmed = false;
  if (isRecord(testRoot) && typeof testRoot.id === 'string') {
    const children = await call(page, 'listPhotoGroups', { parentId: testRoot.id });
    nestedGroupConfirmed =
      Array.isArray(children) &&
      children.some(
        (child: unknown) => isRecord(child) && child.parentId === testRoot.id && child.name === 'Auto-child'
      );
    if (!nestedGroupConfirmed) throw new Error('Expected live nested group missing');
  }
  await page.getByRole('button', { name: '导入', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入图库素材' });
  await expect(dialog.getByRole('button', { name: 'S3', exact: true })).toHaveCount(0);
  await expect(dialog.locator('input[type="file"]')).toBeEnabled();
  await dialog.getByRole('button', { name: '关闭导入图库素材' }).click();
  await atomicWriteJson(resolve(directory, 'read-report.json'), {
    capturedAtUtc: new Date().toISOString(),
    status: 'passed',
    rootGroupCount: groups.length,
    pagePhotoCount: photos.items.length,
    nestedGroupConfirmed,
    zipImportEntry: true,
    s3Supported: false,
    mutationsExecuted: 0,
    calls
  });
  process.stdout.write(
    `Extension real reads passed: ${groups.length} groups, ${photos.items.length} photos. No mutations.\n`
  );
} catch {
  await atomicWriteJson(resolve(directory, 'read-report.json'), {
    capturedAtUtc: new Date().toISOString(),
    status: 'failed',
    mutationsExecuted: 0,
    calls
  });
  process.stderr.write('Extension gallery verification failed; see redacted local report.\n');
  process.exitCode = 1;
} finally {
  await context.close();
}

async function call(
  page: Page,
  operation: 'listPhotoGroups' | 'listPhotos',
  payload?: object
): Promise<unknown> {
  const response = await page.evaluate(
    async ({ operation, payload }) => {
      const extension = (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage(value: object): Promise<unknown> } };
        }
      ).chrome;
      return extension.runtime.sendMessage({
        requestId: crypto.randomUUID(),
        kind: 'gateway-request',
        operation,
        ...(payload ? { payload } : {})
      });
    },
    { operation, payload }
  );
  if (!isRecord(response) || typeof response.requestId !== 'string') throw new Error('Invalid envelope');
  const errorCode =
    isRecord(response.error) && typeof response.error.code === 'string' ? response.error.code : undefined;
  calls.push({
    operation,
    requestId: response.requestId,
    ok: response.ok === true,
    ...(errorCode ? { errorCode } : {})
  });
  if (response.ok !== true) throw new Error('Gallery read failed');
  return response.data;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
