import { cp, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, extname } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Worker, type Page } from '@playwright/test';
import {
  PUBLIC_AUTH_ORIGIN,
  PUBLIC_AUTH_CALLBACK,
  IOP_API_ORIGIN,
  STORE_EXTENSION_ID
} from '../../packages/core/src/alibaba-iop';
import { IOP_VAULT_KEY, IOP_RECEIPT_KEY } from '../../apps/extension/lib/iop-authorization';
import tokens from '../../mock/data/alibaba-auth/iop-token-responses.json' with { type: 'json' };
import credentials from '../../mock/data/node-gateway-credentials.json' with { type: 'json' };

let context: BrowserContext;
let worker: Worker;
let extensionId: string;
let creates = 0;
let refreshes = 0;
test.beforeEach(async () => {
  creates = 0;
  refreshes = 0;
  const root = resolve(import.meta.dirname, '../..');
  const temporary = await mkdtemp(resolve(tmpdir(), 'onevegetable-iop-e2e-'));
  const extension = resolve(temporary, 'extension');
  await cp(resolve(root, 'apps/extension/.output/chrome-mv3'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')) as {
    key?: string;
    host_permissions: string[];
    permissions: string[];
    externally_connectable: { matches: string[] };
  };
  expect(manifest.permissions).toEqual(['storage', 'scripting']);
  expect(manifest.host_permissions).toEqual(['https://eco.taobao.com/*']);
  expect(manifest.externally_connectable.matches).toEqual([`${PUBLIC_AUTH_ORIGIN}/*`]);
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = publicKey.export({ type: 'spki', format: 'der' });
  manifest.key = key.toString('base64');
  extensionId = createHash('sha256')
    .update(key)
    .digest('hex')
    .slice(0, 32)
    .split('')
    .map((character) => String.fromCharCode(97 + parseInt(character, 16)))
    .join('');
  // Chrome tabs.create can initiate navigation before Playwright attaches. Substitute
  // only in this disposable build: no fixture request may ever reach Alibaba.
  const chunks = resolve(extension, 'chunks');
  for (const file of await readdir(chunks)) {
    if (!file.endsWith('.js')) continue;
    const path = resolve(chunks, file);
    const source = await readFile(path, 'utf8');
    await writeFile(
      path,
      source
        .replaceAll(
          'https://openapi-auth.alibaba.com/oauth/authorize',
          `chrome-extension://${extensionId}/iop-approval.html`
        )
        .replaceAll(IOP_API_ORIGIN, PUBLIC_AUTH_ORIGIN)
    );
  }
  await cp(
    resolve(root, 'mock/data/alibaba-auth/iop-approval.html'),
    resolve(extension, 'iop-approval.html')
  );
  await cp(resolve(root, 'mock/data/alibaba-auth/iop-approval.js'), resolve(extension, 'iop-approval.js'));
  // Test-only copy pregrants native host consent. The shipping manifest is never modified.
  manifest.host_permissions.push(`${IOP_API_ORIGIN}/*`, `${PUBLIC_AUTH_ORIGIN}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(resolve(temporary, 'profile'), {
    headless: false,
    locale: 'zh-CN',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  expect(new URL(worker.url()).host).toBe(extensionId);
  await context.route(/^https?:\/\//u, (route) => route.abort());
  const headersSource = await readFile(resolve(root, 'apps/auth-pages/dist/_headers'), 'utf8');
  const headers = Object.fromEntries(
    headersSource
      .split('\n')
      .filter((line) => line.startsWith('  ') && line.includes(':'))
      .map((line) => {
        const separator = line.indexOf(':');
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      })
  );
  await context.route(`${PUBLIC_AUTH_ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const file =
      path === '/'
        ? 'index.html'
        : path === '/callback'
          ? 'callback.html'
          : path.startsWith('/assets/') && !path.includes('..')
            ? path.slice(1)
            : '404.html';
    await route.fulfill({
      body: await readFile(resolve(root, 'apps/auth-pages/dist', file)),
      contentType:
        extname(file) === '.js'
          ? 'application/javascript'
          : extname(file) === '.css'
            ? 'text/css'
            : 'text/html',
      headers
    });
  });
  await context.route(`${PUBLIC_AUTH_ORIGIN}/rest/auth/token/*`, async (route) => {
    if (route.request().url().endsWith('/create')) creates++;
    else refreshes++;
    await route.fulfill({
      json: {
        ...tokens.success,
        access_token: refreshes ? 'fixture-rotated-access' : tokens.success.access_token,
        refresh_token: refreshes ? 'fixture-rotated-refresh' : tokens.success.refresh_token
      }
    });
  });
  // The public production script targets the fixed Store ID. This offline harness maps only
  // that ID to its unpacked copy, still using real Chrome external messaging/origin enforcement.
  await context.addInitScript(
    ({ origin, id, storeId }) => {
      if (location.origin !== origin) return;
      const runtime = (
        window as unknown as { chrome?: { runtime?: { sendMessage: (...args: unknown[]) => void } } }
      ).chrome?.runtime;
      if (!runtime) return;
      const send = runtime.sendMessage;
      runtime.sendMessage = (...args: unknown[]) => {
        if (args[0] === storeId) args[0] = id;
        Reflect.apply(send, runtime, args);
      };
    },
    { origin: PUBLIC_AUTH_ORIGIN, id: extensionId, storeId: STORE_EXTENSION_ID }
  );
});
test.afterEach(async () => {
  await context.close();
});

async function authorize(): Promise<Page> {
  const site = await context.newPage();
  await site.goto(PUBLIC_AUTH_ORIGIN);
  await expect(site.locator('#notice')).toHaveText('插件已连接');
  expect(await site.locator('input').count()).toBe(0);
  const toolEvent = context.waitForEvent('page');
  await site.locator('#open').click();
  const tool = await toolEvent;
  await tool.waitForLoadState();
  await expect(tool.locator('#status')).toHaveText('尚未配置');
  await tool.locator('#appName').fill('Merchant fixture');
  await tool.locator('#appKey').fill(credentials.oauthBundle.application.appKey);
  await tool.locator('#appSecret').fill(credentials.oauthBundle.application.appSecret);
  await tool.locator('#passphrase').fill('123456');
  await tool.locator('#registered').check();
  const oauthEvent = context.waitForEvent('page');
  await tool.locator('#start').click();
  const oauth = await oauthEvent;
  await oauth.waitForURL(`chrome-extension://${extensionId}/iop-approval.html**`);
  await expect(tool.locator('#appSecret')).toHaveValue('');
  await oauth.locator('#approve').click();
  await expect(oauth).toHaveURL(PUBLIC_AUTH_CALLBACK);
  await expect(oauth.locator('body')).not.toContainText(tokens.success.access_token);
  await expect(tool.locator('#status')).toHaveText('已安全保存', { timeout: 20_000 });
  return tool;
}
async function exportBundle(tool: Page): Promise<Record<string, unknown>> {
  tool.once('dialog', (dialog) => dialog.accept());
  const downloading = tool.waitForEvent('download');
  await tool.locator('#export').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('credentialInfo.json');
  const path = await download.path();
  if (!path) throw new Error('Missing downloaded fixture');
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}
test('static page, real MV3 callback, encrypted export and single refresh work end-to-end', async () => {
  const tool = await authorize();
  expect(creates).toBe(1);
  const first = await exportBundle(tool);
  expect(first.protocol).toBe('iop');
  expect(first.oauth).toMatchObject({ accessToken: tokens.success.access_token });
  const stored = await worker.evaluate(() =>
    (
      globalThis as unknown as { chrome: { storage: { local: { get(key: string): Promise<unknown> } } } }
    ).chrome.storage.local.get('one-vegetable-iop-authorization-v1')
  );
  expect(JSON.stringify(stored)).not.toContain(tokens.success.access_token);
  expect(JSON.stringify(stored)).not.toContain(credentials.oauthBundle.application.appSecret);
  tool.once('dialog', (dialog) => dialog.accept());
  await tool.locator('#refresh').click();
  await expect.poll(() => refreshes).toBe(1);
  await expect(tool.locator('#status')).toHaveText('已安全保存');
  expect((await exportBundle(tool)).oauth).toMatchObject({
    accessToken: 'fixture-rotated-access',
    refreshToken: 'fixture-rotated-refresh'
  });
  await tool.locator('#lock').click();
  await expect(tool.locator('#status')).toHaveText('授权包已锁定');
  await expect(tool.locator('#export')).toBeDisabled();
  await tool.locator('#passphrase').fill('123456');
  await tool.locator('#unlock').click();
  await expect(tool.locator('#status')).toHaveText('已安全保存');
  await tool.locator('#language').click();
  await expect(tool.locator('#export')).toHaveText('Export credentialInfo.json');
  await tool.emulateMedia({ colorScheme: 'dark' });
  await expect(tool.locator('#export')).toBeEnabled();
  expect(creates).toBe(1);
  expect(refreshes).toBe(1);
});
test('public pages cannot export; mismatched callback does not call the platform', async () => {
  const tool = await authorize();
  const publicPage = await context.newPage();
  await publicPage.goto(`${PUBLIC_AUTH_CALLBACK}?state=unrelated&code=fixture-wrong-code`);
  await expect(publicPage).toHaveURL(PUBLIC_AUTH_CALLBACK);
  const result = await publicPage.evaluate(
    async (id) =>
      new Promise<unknown>((resolveResult) => {
        const runtime = (
          window as unknown as {
            chrome: {
              runtime: {
                sendMessage(id: string, value: unknown, callback: (response: unknown) => void): void;
              };
            };
          }
        ).chrome.runtime;
        runtime.sendMessage(
          id,
          { kind: 'one-vegetable-public-auth', action: 'export', requestId: crypto.randomUUID() },
          resolveResult
        );
      }),
    extensionId
  );
  expect(result).toMatchObject({ ok: false });
  expect(JSON.stringify(result)).not.toContain(tokens.success.access_token);
  expect(creates).toBe(1);
  // TOP imports stay rejected instead of silently changing this independent vault.
  tool.once('dialog', (dialog) => dialog.accept());
  await tool.locator('#passphrase').fill('123456');
  await tool.locator('#file').setInputFiles({
    name: 'credentials.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(credentials.oauthBundle))
  });
  await expect(tool.locator('#error')).toContainText('旧 TOP');
  const vault = await worker.evaluate(
    async ({ key, receipt }) => {
      const chrome = (
        globalThis as unknown as { chrome: { storage: { local: { get(keys: string[]): Promise<unknown> } } } }
      ).chrome;
      return chrome.storage.local.get([key, receipt]);
    },
    { key: IOP_VAULT_KEY, receipt: IOP_RECEIPT_KEY }
  );
  expect(JSON.stringify(vault)).not.toContain(tokens.success.access_token);
});
