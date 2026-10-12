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
import business from '../../mock/data/alibaba-auth/iop-business-responses.json' with { type: 'json' };
import { iopOperationReason } from '../../packages/core/src/alibaba-iop-business';

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

async function sendWorkbench(page: Page, kind: string, operation: string, payload: unknown = {}) {
  return page.evaluate(
    async (message) => {
      const runtime = (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage(value: unknown): Promise<unknown> } };
        }
      ).chrome.runtime;
      return runtime.sendMessage({ ...message, requestId: crypto.randomUUID() });
    },
    { kind, operation, payload }
  );
}
async function openWorkbenchSettings(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#/settings`);
  const onboarding = page.getByRole('dialog', { name: '四步连接 Alibaba 开放平台' });
  await onboarding.getByRole('checkbox').check();
  await onboarding.getByRole('button', { name: '稍后，仅浏览' }).click();
  await expect(onboarding).not.toBeVisible();
  await page.goto(`chrome-extension://${extensionId}/options.html#/settings`);
  return page;
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

test('workbench persists explicit IOP and rejects unadapted methods without TOP fallback', async () => {
  let reads = 0;
  let topCalls = 0;
  await context.route('https://eco.taobao.com/**', async (route) => {
    topCalls += 1;
    await route.abort();
  });
  await context.route(`${PUBLIC_AUTH_ORIGIN}/rest/icbu/product/photobank/group/list`, async (route) => {
    reads += 1;
    const parameters = new URLSearchParams(route.request().postData() ?? '');
    expect(parameters.get('access_token')).toBe(credentials.manual.accessToken);
    expect(parameters.has('session')).toBe(false);
    expect(parameters.has('method')).toBe(false);
    await route.fulfill({ json: business.photoGroups });
  });
  const workbench = await context.newPage();
  await workbench.goto(`chrome-extension://${extensionId}/options.html#/settings`);
  const send = (kind: string, operation: string, payload?: unknown) =>
    sendWorkbench(workbench, kind, operation, payload);
  expect(
    await send('credential-vault-request', 'create', {
      passphrase: '123456',
      settings: {
        appKey: credentials.manual.appKey,
        appSecret: credentials.manual.appSecret,
        accessToken: credentials.manual.accessToken,
        protocol: 'iop',
        endpoint: `${PUBLIC_AUTH_ORIGIN}/rest`,
        signMethod: 'hmac-sha256'
      }
    })
  ).toMatchObject({ ok: true });
  expect(await send('gateway-request', 'listPhotoGroups')).toMatchObject({
    ok: true,
    data: [{ id: '1001', name: 'Fixture images' }]
  });
  for (const operation of [
    'getProductInventory',
    'publishProduct',
    'saveProductDraft',
    'updateProduct',
    'uploadPhoto'
  ] as const) {
    const reason = iopOperationReason(operation);
    // Only test blocked writes; independently verified writes must never be replayed by this harness.
    if (reason === null) continue;
    expect(await send('gateway-request', operation)).toMatchObject({
      ok: false,
      error: { code: reason }
    });
  }
  await workbench.reload();
  expect(await send('credential-vault-request', 'get-settings')).toMatchObject({
    ok: true,
    data: { protocol: 'iop', endpoint: `${PUBLIC_AUTH_ORIGIN}/rest`, appSecret: '', accessToken: '' }
  });
  expect(await send('gateway-request', 'listPhotoGroups')).toMatchObject({ ok: true });
  expect(reads).toBe(2);
  expect(topCalls).toBe(0);
});

test('legacy TOP import stays TOP, saves only explicitly and keeps TOP session signing', async () => {
  let topCalls = 0;
  let iopCalls = 0;
  await context.route(`${PUBLIC_AUTH_ORIGIN}/rest/**`, async (route) => {
    iopCalls++;
    await route.abort();
  });
  await context.route('https://eco.taobao.com/router/rest', async (route) => {
    topCalls++;
    const parameters = new URLSearchParams(route.request().postData() ?? '');
    expect(parameters.get('session')).toBe(credentials.manual.accessToken);
    expect(parameters.get('sign_method')).toBe('hmac');
    expect(parameters.has('access_token')).toBe(false);
    await route.fulfill({
      json: { alibaba_icbu_photobank_group_list_response: business.photoGroups.result }
    });
  });
  const workbench = await openWorkbenchSettings();
  await expect(workbench.getByLabel('网关协议')).toHaveValue('top');
  await workbench.getByLabel('导入授权包 JSON').setInputFiles({
    name: 'legacy-top.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(credentials.oauthBundle))
  });
  await expect(workbench.getByLabel('App Key')).toHaveValue(credentials.manual.appKey);
  await expect(workbench.getByLabel('网关协议')).toHaveValue('top');
  await expect(workbench.getByTestId('iop-protocol-notice')).toHaveCount(0);
  expect(await sendWorkbench(workbench, 'credential-vault-request', 'status')).toMatchObject({
    data: { state: 'empty' }
  });
  expect(topCalls + iopCalls).toBe(0);
  await workbench.getByLabel('设置保护口令').fill('123456');
  await workbench.getByLabel('确认保护口令').fill('123456');
  await workbench.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(workbench.getByLabel('Access Token')).toHaveValue('');
  await workbench.reload();
  await expect(workbench.getByLabel('网关协议')).toHaveValue('top');
  expect(await sendWorkbench(workbench, 'credential-vault-request', 'get-settings')).toMatchObject({
    data: { protocol: 'top', endpoint: 'https://eco.taobao.com/router/rest', appSecret: '', accessToken: '' }
  });
  expect(await sendWorkbench(workbench, 'gateway-request', 'listPhotoGroups')).toMatchObject({ ok: true });
  expect(topCalls).toBe(1);
  expect(iopCalls).toBe(0);
});

for (const [body, code] of [
  [{ code: 'InvalidAccessToken', message: 'Fixture access rejected' }, 'ALIBABA_IOP_API_REJECTED'],
  [{ fixture: 'invalid envelope' }, 'ALIBABA_IOP_RESPONSE_INVALID']
] as const) {
  test(`MV3 shows ${code} and unsupported IOP reads without TOP fallback`, async () => {
    let reads = 0;
    let topCalls = 0;
    await context.route('https://eco.taobao.com/**', async (route) => {
      topCalls++;
      await route.abort();
    });
    await context.route(`${PUBLIC_AUTH_ORIGIN}/rest/icbu/product/photobank/group/list`, async (route) => {
      reads++;
      await route.fulfill({ json: body });
    });
    const workbench = await openWorkbenchSettings();
    expect(
      await sendWorkbench(workbench, 'credential-vault-request', 'create', {
        passphrase: '123456',
        settings: {
          appKey: credentials.manual.appKey,
          appSecret: credentials.manual.appSecret,
          accessToken: credentials.manual.accessToken,
          protocol: 'iop',
          endpoint: `${PUBLIC_AUTH_ORIGIN}/rest`,
          signMethod: 'hmac-sha256'
        }
      })
    ).toMatchObject({ ok: true });
    await workbench.reload();
    await expect(workbench.getByLabel('网关协议')).toHaveValue('iop');
    await expect(workbench.getByTestId('iop-protocol-notice')).toContainText('通过账号验收的方法');
    await expect(
      workbench.getByRole('button', { name: '获取 TOP 开放平台凭证', exact: true })
    ).toBeDisabled();
    await workbench.goto(`chrome-extension://${extensionId}/options.html#/photos`);
    await expect(workbench.getByText(`错误码：${code}`, { exact: true })).toBeVisible();
    await expect(workbench.getByText('IOP 图片查询需要具体分组', { exact: false }).first()).toBeVisible();
    await workbench.getByTestId('language-toggle').click();
    await expect(
      workbench.getByText('Choose a specific group for IOP photos', { exact: false }).first()
    ).toBeVisible();
    await expect(
      workbench
        .getByText(
          code === 'ALIBABA_IOP_API_REJECTED'
            ? 'Alibaba IOP rejected the request'
            : 'Unexpected IOP response format',
          { exact: false }
        )
        .first()
    ).toBeVisible();
    expect(
      await sendWorkbench(workbench, 'gateway-request', 'getProductInventory', { productId: '100001' })
    ).toMatchObject({ ok: false, error: { code: 'ALIBABA_IOP_METHOD_UNSUPPORTED' } });
    expect(reads).toBe(1);
    expect(topCalls).toBe(0);
    expect(creates + refreshes).toBe(0);
    expect(await sendWorkbench(workbench, 'credential-vault-request', 'get-settings')).toMatchObject({
      data: { protocol: 'iop' }
    });
  });
}
