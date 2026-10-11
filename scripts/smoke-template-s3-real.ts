/** Opt-in: one unique real S3 backup, isolated SQLite imports, no Alibaba calls or remote deletion. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium, expect, type Page } from '@playwright/test';
import fixture from '../mock/data/template-library.json' with { type: 'json' };
import {
  S3StorageConfigurationCipher,
  SqlS3StorageConfigurationRepository
} from '../apps/api/src/storage/s3-configuration';
import { BffControlClient } from '../packages/core/src/control-client';
import { GatewayException } from '../packages/core/src/errors';
import { NativeFetchTransport } from '../packages/core/src/network';
import { completeOnboarding, ONBOARDING_STORAGE_KEY } from '../packages/core/src/privacy';
import { BffProductDescriptionTemplateClient } from '../packages/core/src/product-description-template-client';
import {
  importTemplateBundle,
  listAllTemplates,
  parseTemplateBundle
} from '../packages/core/src/template-library';
import {
  assertTemplateBackupContext,
  prepareTemplateBackup,
  verifyTemplateBackup
} from '../packages/ui/src/lib/template-s3';
import { localNodeNetworkOptions } from './lib/local-node-network';
import { atomicWriteJson } from './openapi-auth/storage';
import { validS3Output, type S3MessageMap, type S3Operation } from '../apps/extension/lib/s3-protocol';
import type { SqlExecutor } from '../apps/api/src/db/sql-executor';
import type { NetworkTransport } from '../packages/core/src/network';
import { s3PermissionOrigins, type S3StorageConfiguration } from '../packages/core/src/s3-storage';

if (process.env.ONE_VEGETABLE_TEMPLATE_S3_SMOKE !== '1') {
  throw new Error('Set ONE_VEGETABLE_TEMPLATE_S3_SMOKE=1 to create one unique S3 template backup.');
}
if (existsSync('.env')) loadEnvFile('.env');
const directory = resolve('artifacts/template-s3-validation', randomUUID());
await mkdir(directory, { recursive: true });
const checks: string[] = [];
const calls: { path: string; requestId: string; status: number }[] = [];
let stage = 'read saved S3 configuration';
let objectKey: string | null = null;
let putAttempted = false;
let configuration: S3StorageConfiguration | undefined;
let child: ReturnType<typeof spawn> | undefined;
let backupSha256: string | null = null;

try {
  configuration = await loadConfiguration();
  const port = await reservePort();
  const base = `http://127.0.0.1:${port}`;
  const origin = 'http://localhost:5173';
  const bootstrapToken = randomBytes(32).toString('base64url');
  const environment: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('ONE_VEGETABLE_ALIBABA_'))
  );
  Object.assign(environment, {
    NODE_OPTIONS: localNodeNetworkOptions(process.env.NODE_OPTIONS),
    ONE_VEGETABLE_PORT: String(port),
    ONE_VEGETABLE_ENVIRONMENT: 'local-node',
    ONE_VEGETABLE_GATEWAY_MODE: 'real',
    ONE_VEGETABLE_MUTATION_FLAGS: '',
    ONE_VEGETABLE_ALLOW_LOCAL_S3_HTTP: '1',
    ONE_VEGETABLE_CORS_ORIGINS: origin,
    ONE_VEGETABLE_SQLITE_PATH: resolve(directory, 'isolated.sqlite'),
    ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
    BOOTSTRAP_ADMIN_TOKEN: bootstrapToken
  });
  child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/node.ts'], {
    cwd: process.cwd(),
    env: environment,
    windowsHide: true,
    stdio: 'ignore'
  });
  const native = new NativeFetchTransport();
  const cookies = new Map<string, string>();
  // In-memory session only. The shared clients still use NetworkManager and real fetch.
  const transport: NetworkTransport = {
    async send(input, init) {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.origin, base, 'Unexpected BFF destination');
      assert(!url.pathname.includes('/operations/'), 'Alibaba operations must not be called');
      const headers = new Headers(init.headers);
      headers.set('Origin', origin);
      if (cookies.size)
        headers.set('Cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
      const response = await native.send(input, { ...init, headers });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0] ?? '';
        const separator = pair.indexOf('=');
        if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
      calls.push({
        path: url.pathname,
        requestId: headers.get('X-Request-ID') ?? '',
        status: response.status
      });
      return response;
    }
  };
  const control = new BffControlClient({ baseUrl: base, transport });
  const templates = new BffProductDescriptionTemplateClient({
    baseUrl: base,
    transport,
    csrfToken: () => control.csrfToken()
  });
  stage = 'isolated Node readiness';
  for (let attempt = 0; ; attempt++) {
    try {
      await control.bootstrapStatus();
      break;
    } catch {
      if (attempt >= 59 || child.exitCode !== null) throw new Error('Isolated startup failed');
      await wait(500);
    }
  }
  await control.bootstrap({
    bootstrapToken,
    username: 'template-s3-smoke',
    password: randomBytes(24).toString('base64url')
  });
  assert(control.csrfToken(), 'Missing CSRF token');
  await control.updateS3StorageConfiguration(configuration, null, 'Isolated template backup acceptance');
  const summary = await control.s3StorageConfiguration();
  assert(summary.configured, 'S3 configuration not active');
  checks.push('isolated administrator session, CSRF and encrypted S3 configuration');

  stage = 'read-only storage connectivity';
  const prefix = `onevegetable/template-library-smoke/${randomUUID()}`;
  const before = await control.listS3Objects({ prefix, maximum: 10 });
  assert.equal(before.items.length, 0, 'Unique prefix already exists');
  checks.push('real S3 listing confirms an unused independent prefix');

  stage = 'portable source templates';
  const source = parseTemplateBundle(new TextEncoder().encode(JSON.stringify(fixture)));
  const created = [];
  for (const item of source.templates) created.push(await templates.create(item));
  assert.equal((await listAllTemplates(templates)).length, source.templates.length);
  const plan = await prepareTemplateBackup(control, created, prefix);
  objectKey = plan.key;
  backupSha256 = createHash('sha256').update(plan.bytes).digest('hex');
  const portable = parseTemplateBundle(plan.bytes);
  assert.deepEqual(Object.keys(portable.templates[0] ?? {}).sort(), [
    'category',
    'html',
    'language',
    'name',
    'remark'
  ]);
  checks.push('real SQLite templates serialize to a validated identity-free portable bundle');

  stage = 'one real S3 PUT';
  await assertTemplateBackupContext(control, plan, () => true);
  putAttempted = true;
  // Never repeat this PUT, including after timeout. The report retains its exact key.
  await control.putS3Object({ key: plan.key, bytes: plan.bytes, contentType: 'application/json' });
  stage = 'exact readback verification';
  await verifyTemplateBackup(control, plan, () => true);
  const page = await control.listS3Objects({ prefix, maximum: 10 });
  assert.equal(page.items.length, 1, 'Backup listing count mismatch');
  assert.equal(page.items[0]?.key, plan.key);
  const readback = await control.getS3Object(plan.key);
  assert.equal(createHash('sha256').update(readback.bytes).digest('hex'), backupSha256);
  const restored = parseTemplateBundle(readback.bytes);
  checks.push('one real S3 PUT, listing and byte-for-byte GET verification');

  stage = 'safe duplicate import';
  const skip = await importTemplateBundle(templates, restored, 'skip');
  assert.equal(skip.filter((item) => item.status === 'skipped').length, source.templates.length);
  assert.equal((await listAllTemplates(templates)).length, source.templates.length);
  const copy = await importTemplateBundle(templates, restored, 'copy');
  assert.equal(copy.filter((item) => item.status === 'created').length, source.templates.length);
  const all = await listAllTemplates(templates);
  assert.equal(all.length, source.templates.length * 2);
  for (const item of source.templates) {
    const duplicate = all.find((value) => value.name === `${item.name} (2)`);
    assert(
      duplicate?.html === item.html && duplicate.language === item.language,
      'Imported content mismatch'
    );
  }
  checks.push('S3 package imports through real Node HTTP/SQLite; skip and copy never overwrite originals');
  const item = all[0];
  assert(item, 'Missing imported template');
  const archived = await templates.archive(item.id, item.revision);
  const active = await templates.restore(item.id, archived.revision);
  assert.equal(active.status, 'active');
  assert.equal(active.revision, item.revision + 2);
  checks.push('imported template archive/restore preserves revision and content');

  if (process.env.ONE_VEGETABLE_TEMPLATE_S3_UI === '1') {
    stage = 'real S3 import dialog';
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ locale: 'zh-CN' });
      await context.addCookies([
        { name: 'ov_csrf', value: control.csrfToken() ?? '', domain: 'localhost', path: '/' }
      ]);
      await context.addInitScript(
        ({ key, value }) => {
          localStorage.setItem(key, JSON.stringify(value));
        },
        {
          key: ONBOARDING_STORAGE_KEY,
          value: completeOnboarding()
        }
      );
      const view = await context.newPage();
      view.setDefaultTimeout(15_000);
      await view.route('**/api/v1/**', async (route) => {
        const original = route.request();
        const url = new URL(original.url());
        if (url.pathname.includes('/operations/')) {
          await route.abort();
          return;
        }
        const response = await transport.send(new URL(url.pathname, base), {
          method: original.method(),
          headers: original.headers(),
          ...(original.postData() ? { body: original.postData() } : {})
        });
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer())
        });
      });
      await view.goto(`${origin}/#/templates`);
      await expect(view.getByRole('heading', { name: '模板', exact: true })).toBeVisible();
      await view.getByRole('combobox', { name: '模板语言', exact: true }).selectOption('en_US');
      await expect(view.getByText('Company introduction', { exact: true })).toBeVisible();
      await view.getByRole('button', { name: '导入', exact: true }).click();
      const dialog = view.getByRole('dialog', { name: '导入', exact: true }).first();
      await dialog.locator('select').first().selectOption('s3');
      await dialog.locator('input').fill(prefix);
      await dialog.getByRole('button', { name: '查询模板包', exact: true }).click();
      await expect(dialog.locator('option').filter({ hasText: plan.key })).toHaveCount(1);
      await dialog.locator('select').nth(1).selectOption(plan.key);
      await dialog.getByRole('button', { name: '预览模板包', exact: true }).click();
      await expect(dialog).toContainText('2 个模板');
      await dialog.getByRole('combobox', { name: /同语言、同名冲突/u }).selectOption('copy');
      await dialog.getByRole('button', { name: '导入', exact: true }).click();
      assert.equal((await listAllTemplates(templates)).length, 4, 'UI import wrote before confirmation');
      await view
        .getByRole('dialog', { name: '导入', exact: true })
        .last()
        .getByRole('button', { name: '确认', exact: true })
        .click();
      await expect(view.getByText('Company introduction (3)', { exact: true })).toBeVisible();
      await expect(view.getByText('Logistics introduction (3)', { exact: true })).toBeVisible();
      assert.equal((await listAllTemplates(templates)).length, 6);
      await view.screenshot({ path: resolve(directory, 'web-s3-import.png') });
      checks.push(
        'real Web dialog lists/reads S3 package, previews, confirms and imports through live Node API'
      );
    } finally {
      await browser.close();
    }
  }

  if (process.env.ONE_VEGETABLE_TEMPLATE_S3_EXTENSION === '1') {
    stage = 'formal independent extension S3 exchange';
    await verifyExtension(configuration, objectKey, prefix);
  }

  await atomicWriteJson(resolve(directory, 'report.json'), report('passed'));
  console.log(`Template S3 acceptance passed: ${checks.length} checks. Report: ${directory}`);
} catch (error: unknown) {
  const code =
    error instanceof GatewayException && /^[A-Z0-9_:-]{1,100}$/u.test(error.gatewayError.code)
      ? error.gatewayError.code
      : 'ACCEPTANCE_FAILED';
  await atomicWriteJson(resolve(directory, 'report.json'), { ...report('failed'), errorCode: code });
  console.error(
    `Template S3 acceptance stopped at ${stage}; code ${code}. No automatic write retry. Report: ${directory}`
  );
  process.exitCode = 1;
} finally {
  if (child?.exitCode === null) {
    const stopped = once(child, 'exit');
    child.kill();
    await stopped;
  }
}

function report(status: 'passed' | 'failed') {
  return {
    capturedAtUtc: new Date().toISOString(),
    status,
    stage,
    checks,
    calls,
    destination: configuration
      ? {
          endpoint: configuration.endpoint,
          bucket: configuration.bucket,
          rootPrefix: configuration.rootPrefix
        }
      : null,
    objectKey,
    putAttempted,
    backupSha256,
    remoteDeletionCount: 0,
    alibabaRequestCount: 0,
    existingWorkbenchDatabaseModified: false,
    warning:
      'The unique remote test backup is retained. A failed or unknown PUT must be verified, never blindly repeated.'
  };
}

async function loadConfiguration(): Promise<S3StorageConfiguration> {
  const sourcePath = resolve(
    process.env.ONE_VEGETABLE_TEMPLATE_S3_DATABASE ?? 'apps/api/.data/one-vegetable.sqlite'
  );
  assert(existsSync(sourcePath), 'Saved S3 source database not found');
  const database = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const executor: SqlExecutor = {
      query: (sql, parameters = []) => Promise.resolve(database.prepare(sql).all(...parameters)),
      execute: () => Promise.reject(new Error('Source database is read-only'))
    };
    const record = await new SqlS3StorageConfigurationRepository(executor).find();
    assert(record, 'No saved S3 configuration');
    const key =
      process.env.ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY ??
      (await readFile('.data/local-credential-encryption-key', 'utf8')).trim();
    return await (await S3StorageConfigurationCipher.create(key)).decrypt(record);
  } finally {
    database.close();
  }
}

async function reservePort(): Promise<number> {
  const reserved = createServer();
  reserved.listen(0, '127.0.0.1');
  await once(reserved, 'listening');
  const address = reserved.address();
  assert(address && typeof address === 'object');
  await new Promise<void>((done, reject) => {
    reserved.close((error) => {
      if (error) reject(error);
      else done();
    });
  });
  return address.port;
}

async function verifyExtension(
  configuration: S3StorageConfiguration,
  sourceKey: string,
  prefix: string
): Promise<void> {
  const extension = resolve('apps/extension/.output/chrome-mv3');
  assert(existsSync(resolve(extension, 'manifest.json')), 'Build the formal extension first');
  const profile = await mkdtemp(resolve(directory, 'extension-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    locale: 'zh-CN',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  let view: Page | undefined;
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await worker.evaluate(
      async (values) => {
        const chrome = (
          globalThis as unknown as {
            chrome: { storage: { local: { set(value: Record<string, unknown>): Promise<void> } } };
          }
        ).chrome;
        await chrome.storage.local.set(values);
      },
      { [ONBOARDING_STORAGE_KEY]: completeOnboarding() }
    );
    view = await context.newPage();
    const base = `chrome-extension://${new URL(worker.url()).host}/options.html`;
    view.setDefaultTimeout(15_000);
    stage = 'formal extension S3 settings';
    await view.goto(`${base}#/settings`);
    await view.locator('button[aria-controls="settings-storage"]').click();
    await view.getByLabel('Endpoint', { exact: true }).fill(configuration.endpoint);
    await view.getByLabel('Region', { exact: true }).fill(configuration.region);
    await view.getByLabel('Bucket', { exact: true }).fill(configuration.bucket);
    await view.getByLabel('Access Key ID', { exact: true }).fill(configuration.accessKeyId);
    await view.getByLabel('Secret Access Key', { exact: true }).fill(configuration.secretAccessKey);
    await view.getByLabel('素材根目录', { exact: true }).fill(configuration.rootPrefix);
    await view.getByLabel('使用 Path-style 地址', { exact: false }).setChecked(configuration.pathStyle);
    if (configuration.allowInsecureLocal)
      await view.getByRole('checkbox', { name: /仅在可信局域网/u }).check();
    if (configuration.sessionToken)
      await view.getByLabel('Session Token（可选）', { exact: true }).fill(configuration.sessionToken);
    console.log(
      'Formal extension: approve the exact S3 host permission in the isolated Chromium window if prompted.'
    );
    stage = 'formal extension optional S3 permission and encrypted save';
    await view.getByRole('button', { name: '加密保存', exact: true }).click();
    await expect(view.getByText('S3 配置已加密保存。', { exact: true })).toBeVisible({ timeout: 180_000 });
    await expect(view.getByLabel('Secret Access Key', { exact: true })).toHaveValue('');
    await extensionS3(view, 'test', {});
    stage = 'formal extension real S3 template import';
    await view.goto(`${base}#/templates`);
    await view.getByRole('combobox', { name: '模板语言', exact: true }).selectOption('en_US');
    await view.getByRole('button', { name: '导入', exact: true }).click();
    let dialog = view.getByRole('dialog', { name: '导入', exact: true }).first();
    await dialog.locator('select').first().selectOption('s3');
    await dialog.locator('input').fill(prefix);
    await dialog.getByRole('button', { name: '查询模板包', exact: true }).click();
    await expect(dialog.locator('option').filter({ hasText: sourceKey })).toHaveCount(1);
    await dialog.locator('select').nth(1).selectOption(sourceKey);
    await dialog.getByRole('button', { name: '预览模板包', exact: true }).click();
    await expect(dialog).toContainText('2 个模板');
    await dialog.getByRole('combobox', { name: /同语言、同名冲突/u }).selectOption('copy');
    await dialog.getByRole('button', { name: '导入', exact: true }).click();
    await view
      .getByRole('dialog', { name: '导入', exact: true })
      .last()
      .getByRole('button', { name: '确认', exact: true })
      .click();
    await expect(view.getByText('Company introduction', { exact: true })).toBeVisible();
    await expect(view.getByText('Logistics introduction', { exact: true })).toBeVisible();
    stage = 'formal extension confirmed S3 backup';
    await view.getByRole('checkbox', { name: '选择Company introduction', exact: true }).check();
    await view.getByRole('button', { name: '导出', exact: true }).click();
    dialog = view.getByRole('dialog', { name: '导出', exact: true }).first();
    await dialog.locator('select').first().selectOption('s3');
    const outputPrefix = `${prefix}/extension`;
    await dialog.locator('input').fill(outputPrefix);
    await dialog.getByRole('button', { name: '导出', exact: true }).click();
    await view
      .getByRole('dialog', { name: '导出', exact: true })
      .last()
      .getByRole('button', { name: '确认', exact: true })
      .click();
    await expect(view.getByText(/^S3 回读已确认：/u)).toBeVisible({ timeout: 30_000 });
    const exported = await extensionS3(view, 'list', { prefix: outputPrefix, maximum: 10 });
    assert.equal(exported.items.length, 1, 'Extension backup count mismatch');
    const key = exported.items[0]?.key;
    assert(key, 'Extension backup key missing');
    const readback = await extensionS3(view, 'get', { key });
    const bundle = parseTemplateBundle(new Uint8Array(Buffer.from(readback.contentBase64, 'base64')));
    assert.equal(bundle.templates.length, 1);
    assert.equal(bundle.templates[0]?.name, 'Company introduction');
    stage = 'formal extension service worker restart and readback';
    const cdp = await context.newCDPSession(view);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await view.reload();
    await expect(view.getByText('Company introduction', { exact: true })).toBeVisible();
    const again = await extensionS3(view, 'get', { key });
    assert.equal(
      again.contentBase64,
      readback.contentBase64,
      'Extension readback changed after worker restart'
    );
    await view.screenshot({ path: resolve(directory, 'extension-s3-templates.png') });
    checks.push(
      'formal extension native host permission, real S3 import into IndexedDB, confirmed backup and worker restart readback'
    );
    await atomicWriteJson(resolve(directory, 'extension-report.json'), {
      capturedAtUtc: new Date().toISOString(),
      status: 'passed',
      sourceKey,
      objectKey: key,
      sha256: createHash('sha256').update(Buffer.from(readback.contentBase64, 'base64')).digest('hex'),
      permissionMode: 'production-optional-grant',
      bffRequired: false,
      alibabaMutationCount: 0,
      remoteDeletionCount: 0
    });
  } catch (error: unknown) {
    let optionalHostPermissionGranted: boolean | null = null;
    if (view) {
      try {
        optionalHostPermissionGranted = await view.evaluate(async (origins) => {
          const chrome = (
            globalThis as unknown as {
              chrome: { permissions: { contains(input: { origins: string[] }): Promise<boolean> } };
            }
          ).chrome;
          return chrome.permissions.contains({ origins });
        }, s3PermissionOrigins(configuration));
      } catch {
        // Closed test pages cannot report permission state; do not include raw browser errors.
      }
    }
    await atomicWriteJson(resolve(directory, 'extension-report.json'), {
      capturedAtUtc: new Date().toISOString(),
      status: 'failed',
      stage,
      optionalHostPermissionGranted,
      sourceKey,
      alibabaMutationCount: 0,
      remoteDeletionCount: 0
    });
    throw error;
  } finally {
    await context.close();
  }
}

async function extensionS3<T extends S3Operation>(
  view: Page,
  operation: T,
  payload: S3MessageMap[T]['input']
): Promise<S3MessageMap[T]['output']> {
  const requestId = randomUUID();
  const response: unknown = await view.evaluate(
    async (message) => {
      const chrome = (
        globalThis as unknown as { chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } } }
      ).chrome;
      return chrome.runtime.sendMessage(message);
    },
    { kind: 's3-storage-request', requestId, operation, payload }
  );
  assert(
    response &&
      typeof response === 'object' &&
      'requestId' in response &&
      response.requestId === requestId &&
      'ok' in response &&
      response.ok === true &&
      'data' in response &&
      validS3Output(operation, response.data),
    'Extension S3 response failed validation'
  );
  return response.data as S3MessageMap[T]['output'];
}
