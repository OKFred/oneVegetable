import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { MockGatewayClient } from '../packages/core/src/mock-client';
import fixture from '../mock/data/extension-upgrade.json' with { type: 'json' };
import s3Fixture from '../mock/data/extension-s3.json' with { type: 'json' };
import taskFixture from '../mock/data/gallery-transfer-task.json' with { type: 'json' };

declare const chrome: {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  storage: { local: { get(key: string): Promise<Record<string, unknown>> } };
};
const root = resolve(import.meta.dirname, '..');
const latest = resolve(root, 'apps/extension/.output/chrome-mv3');
const output = resolve(root, 'artifacts/release-2.6-upgrade', randomUUID());
const checks: string[] = [];
await mkdir(output, { recursive: true });
const baselinePaths = process.argv.slice(2).filter((value) => value !== '--');
if (!baselinePaths.length) {
  baselinePaths.push(
    'artifacts/one-vegetable-v2.5.0-chrome-mv3.zip',
    'artifacts/release-2.6-upgrade/baselines/one-vegetable-v2.6.0-chrome-mv3.zip'
  );
}
const report: {
  completed: boolean;
  baselines: { version: string; sha256: string }[];
  checks: string[];
  stage: string;
  errorType?: string;
} = {
  completed: false,
  stage: 'initialization',
  baselines: [],
  checks
};
try {
  for (const path of baselinePaths) await verifyUpgrade(resolve(root, path));
  report.completed = true;
  report.stage = 'completed';
  process.stdout.write(`Extension upgrades passed: ${checks.length} checks. Report: ${output}\n`);
} catch (error) {
  report.errorType = error instanceof Error ? error.name : 'UnknownError';
  process.exitCode = 1;
  process.stderr.write(`Extension upgrade failed. Redacted checkpoints: ${output}\n`);
} finally {
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

function assert(value: unknown, checkpoint: string): asserts value {
  if (!value) throw new Error(checkpoint);
  checks.push(checkpoint);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
async function request(page: Page, kind: string, operation: string, payload?: unknown): Promise<unknown> {
  const response = record(
    await page.evaluate(
      (message) => chrome.runtime.sendMessage({ requestId: crypto.randomUUID(), ...message }),
      { kind, operation, payload }
    )
  );
  if (response.ok !== true) throw new Error('RUNTIME_REQUEST_FAILED');
  return response.data;
}
async function launch(profile: string, extensionPath: string): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  // Both page and service-worker HTTP requests are blocked. No real credentials are loaded.
  await context.route(/^https?:/u, (route) => route.abort('blockedbyclient'));
  // tsx preserves function names using this helper when serializing test callbacks.
  await context.addInitScript({ content: 'globalThis.__name = (value) => value;' });
  return context;
}
async function options(context: BrowserContext): Promise<{ page: Page; origin: string }> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  const page = await context.newPage();
  await page.goto(`${origin}/options.html#/settings`);
  return { page, origin };
}
async function verifyUpgrade(path: string): Promise<void> {
  const bytes = await readFile(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const checksum = (await readFile(`${path}.sha256`, 'utf8')).trim().split(/\s/u)[0];
  assert(sha256 === checksum, 'baseline ZIP checksum');
  const entries = unzipSync(bytes);
  const manifestBytes = entries['manifest.json'];
  if (!manifestBytes) throw new Error('MANIFEST_MISSING');
  const manifest = record(JSON.parse(new TextDecoder().decode(manifestBytes)));
  const version = String(manifest.version);
  report.baselines.push({ version, sha256 });
  const candidate = record(JSON.parse(await readFile(resolve(latest, 'manifest.json'), 'utf8')));
  for (const key of ['permissions', 'host_permissions', 'optional_host_permissions']) {
    assert(JSON.stringify(manifest[key]) === JSON.stringify(candidate[key]), `${version}: unchanged ${key}`);
  }
  const sandbox = await mkdtemp(resolve(tmpdir(), 'one-vegetable-upgrade-'));
  const extensionPath = resolve(sandbox, 'extension');
  for (const [name, content] of Object.entries(entries)) {
    const target = resolve(extensionPath, name);
    if (!target.startsWith(`${extensionPath}${sep}`)) throw new Error('INVALID_ARCHIVE_PATH');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  let context = await launch(resolve(sandbox, 'profile'), extensionPath);
  try {
    const previous = await options(context);
    const guide = previous.page.getByRole('dialog', { name: '四步连接 Alibaba 开放平台' });
    await guide.getByRole('checkbox').check();
    await guide.getByRole('button', { name: '稍后，仅浏览' }).click();
    await request(previous.page, 'credential-vault-request', 'create', {
      settings: fixture.settings,
      passphrase: fixture.passphrase
    });
    const s3 = { ...s3Fixture.configuration, endpoint: 'https://eco.taobao.com' };
    await request(previous.page, 's3-storage-request', 'save', {
      configuration: s3,
      revision: null,
      remark: null
    });
    const encrypted = await previous.page.evaluate(() => chrome.storage.local.get('gatewaySettings'));
    const draft = { ...fixture.draft, updatedAtUtc: Date.now() };
    await previous.page.evaluate(
      ({ preferences, draft, columns, hasTasks }) => {
        localStorage.setItem('one-vegetable:preferences:v2', JSON.stringify(preferences));
        localStorage.setItem('one-vegetable-product-editor-drafts-v3', JSON.stringify([draft]));
        if (hasTasks) localStorage.setItem('one-vegetable:columns:v1:products', JSON.stringify(columns));
      },
      { ...fixture, draft, hasTasks: version === '2.6.0' }
    );
    if (version === '2.6.0') {
      const contextResponse = record(
        await previous.page.evaluate(() =>
          chrome.runtime.sendMessage({ kind: 'gallery-transfer-context', requestId: crypto.randomUUID() })
        )
      );
      if (contextResponse.ok !== true) throw new Error('TASK_CONTEXT_UNAVAILABLE');
      const taskContext = record(contextResponse.data);
      await previous.page.evaluate(
        async (task) => {
          await new Promise<void>((resolve, reject) => {
            const open = indexedDB.open('one-vegetable-gallery-transfers-v1', 1);
            open.onupgradeneeded = () => {
              open.result.createObjectStore('tasks', { keyPath: 'id' });
              open.result.createObjectStore('quarantine', { keyPath: 'id' });
            };
            open.onerror = () => {
              reject(new Error('TASK_OPEN'));
            };
            open.onsuccess = () => {
              const db = open.result;
              const tx = db.transaction('tasks', 'readwrite');
              tx.objectStore('tasks').put(task);
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
              tx.onerror = () => {
                db.close();
                reject(new Error('TASK_WRITE'));
              };
            };
          });
        },
        {
          ...taskFixture,
          context: taskContext,
          createTimeUtc: Date.now(),
          updateTimeUtc: Date.now(),
          status: 'running',
          items: taskFixture.items.map((item) => ({ ...item, status: 'running' }))
        }
      );
    }
    checks.push(`${version}: seeded by old runtime`);
    await context.close();
    // Only remove the validated generated extension directory, never the profile or workspace.
    if (dirname(extensionPath) !== sandbox) throw new Error('UNSAFE_TEST_PATH');
    await rm(extensionPath, { recursive: true, force: true });
    await cp(latest, extensionPath, { recursive: true });
    context = await launch(resolve(sandbox, 'profile'), extensionPath);
    const next = await options(context);
    assert(next.origin === previous.origin, `${version}: same extension identity`);
    const status = record(await request(next.page, 'credential-vault-request', 'status'));
    assert(status.state === 'locked', `${version}: restart requires unlock without losing credentials`);
    const unlocked = record(
      await request(next.page, 'credential-vault-request', 'unlock', { passphrase: fixture.passphrase })
    );
    const settings = record(await request(next.page, 'credential-vault-request', 'get-settings'));
    assert(
      settings.appKey === fixture.settings.appKey &&
        settings.appSecret === '' &&
        settings.accessToken === '' &&
        unlocked.hasAppSecret === true &&
        unlocked.hasAccessToken === true,
      `${version}: original credentials decrypt`
    );
    assert(
      JSON.stringify(await next.page.evaluate(() => chrome.storage.local.get('gatewaySettings'))) ===
        JSON.stringify(encrypted),
      `${version}: ciphertext unchanged`
    );
    const summary = record(await request(next.page, 's3-storage-request', 'summary', {}));
    assert(
      summary.configured === true && summary.endpoint === s3.endpoint,
      `${version}: S3 device key and configuration survive`
    );
    await expect(next.page.locator('html')).toHaveClass(/dark/u);
    const stored = await next.page.evaluate(() => ({
      draft: localStorage.getItem('one-vegetable-product-editor-drafts-v3'),
      preferences: localStorage.getItem('one-vegetable:preferences:v2'),
      columns: localStorage.getItem('one-vegetable:columns:v1:products')
    }));
    assert(stored.draft === JSON.stringify([draft]), `${version}: draft XML and editor state retained`);
    assert(
      stored.preferences === JSON.stringify(fixture.preferences),
      `${version}: interface, API language and theme retained`
    );
    const client = new MockGatewayClient(0);
    report.stage = 'prepare offline product responses';
    const reads = {
      listProducts: await client.request('listProducts', { page: 1, pageSize: 20 }),
      listProductGroups: await client.request('listProductGroups', undefined),
      listProductCategories: await client.request('listProductCategories', {}),
      getProductScore: await client.request('getProductScore', { productId: 'mock-encrypted-product-1' })
    };
    await next.page.addInitScript((reads) => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (message) => {
        if (
          message &&
          typeof message === 'object' &&
          'kind' in message &&
          message.kind === 'gateway-request' &&
          'operation' in message &&
          typeof message.operation === 'string' &&
          'requestId' in message
        ) {
          const data: unknown = (reads as Record<string, unknown>)[message.operation];
          return Promise.resolve(
            data === undefined
              ? {
                  requestId: message.requestId,
                  ok: false,
                  error: { code: 'UPGRADE_OFFLINE', message: 'Offline upgrade check', retryable: false }
                }
              : { requestId: message.requestId, ok: true, data }
          );
        }
        return original(message);
      };
    }, reads);
    report.stage = 'open upgraded product list';
    await next.page.goto(`${next.origin}/options.html#/products`);
    // Hash navigation does not create a document; reload to install the offline read fixtures.
    await next.page.reload();
    report.stage = 'verify upgraded product score layout';
    await expect(next.page.getByRole('columnheader', { name: '产品分', exact: true })).toHaveCSS(
      'width',
      '128px'
    );
    await next.page.screenshot({ path: resolve(output, `upgrade-${version}.png`) });
    if (version === '2.6.0') {
      assert(stored.columns === JSON.stringify(fixture.columns), `${version}: column preference retained`);
      await expect(next.page.getByRole('columnheader', { name: '图片', exact: true })).toHaveCount(0);
      report.stage = 'open transfer history';
      await next.page.goto(`${next.origin}/options.html#/photos`);
      await next.page.getByRole('button', { name: '传输记录', exact: true }).click();
      const center = next.page.getByRole('dialog', { name: '传输记录', exact: true });
      report.stage = 'select retained transfer task';
      await next.page.screenshot({ path: resolve(output, 'transfer-history.png') });
      await center.getByRole('button', { name: /task-tes/u }).click();
      report.stage = 'verify manual recovery';
      await expect(center.getByText('结果不明', { exact: true })).toBeVisible();
      await expect(center.getByRole('button', { name: '核对结果', exact: true })).toBeVisible();
      checks.push(`${version}: interrupted task kept for manual verification, not automatically resent`);
    }
    checks.push(`${version}: current runtime layout and persisted UI state verified`);
  } catch (error) {
    const visible = context.pages().at(-1);
    await visible?.screenshot({ path: resolve(output, `failure-${version}.png`) }).catch(() => undefined);
    throw error;
  } finally {
    await context.close();
  }
}
