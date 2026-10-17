import { cp, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash, createHmac, generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, extname } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Worker, type Page } from '@playwright/test';
import {
  PUBLIC_AUTH_ORIGIN,
  PUBLIC_AUTH_CALLBACK,
  IOP_API_ORIGIN,
  STORE_EXTENSION_ID
} from '../../packages/core/src/alibaba-iop';
import {
  IOP_VAULT_KEY,
  IOP_RECEIPT_KEY,
  TOP_VAULT_KEY,
  TOP_RECEIPT_KEY,
  IOP_APPLICATION_READER_ORIGINS,
  TOP_APPLICATION_READER_ORIGINS
} from '../../apps/extension/lib/iop-authorization-storage';
import tokens from '../../mock/data/alibaba-auth/iop-token-responses.json' with { type: 'json' };
import credentials from '../../mock/data/node-gateway-credentials.json' with { type: 'json' };
import business from '../../mock/data/alibaba-auth/iop-business-responses.json' with { type: 'json' };
import standalone from '../../mock/data/alibaba-auth/standalone-authorization.json' with { type: 'json' };
import jsonImports from '../../mock/data/alibaba-auth/standalone-json-imports.json' with { type: 'json' };
import { iopOperationReason } from '../../packages/core/src/alibaba-iop-business';
import { isProductMutationJob } from '../../packages/core/src/product-mutation-job-client';
import { requireProductOperationContext } from '../../packages/core/src/product-operation-context';
import {
  compareProductMutationFingerprints,
  createProductMutationFingerprints
} from '../../packages/core/src/product-mutation-fingerprint';
import { installNodeXmlDomGlobals } from '../../scripts/node-xml-dom';

let context: BrowserContext;
let worker: Worker;
let extensionId: string;
let creates = 0;
let refreshes = 0;
let topCreates = 0;
let topRefreshes = 0;
let nativeDialogs: string[] = [];
const TOP_TOKEN_FIXTURE_ORIGIN = 'https://top-oauth.example.test';
const UI_SCREENSHOT_DIRECTORY = resolve(
  import.meta.dirname,
  '../../artifacts/authorization-release-ready-ui'
);
test.beforeEach(async () => {
  creates = 0;
  refreshes = 0;
  topCreates = 0;
  topRefreshes = 0;
  nativeDialogs = [];
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
  async function javascriptFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
      entries.map((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory()
          ? javascriptFiles(path)
          : Promise.resolve(entry.name.endsWith('.js') ? [path] : []);
      })
    );
    return files.flat();
  }
  for (const path of await javascriptFiles(extension)) {
    const source = await readFile(path, 'utf8');
    await writeFile(
      path,
      source
        .replaceAll(
          'https://openapi-auth.alibaba.com/oauth/authorize',
          `chrome-extension://${extensionId}/iop-approval.html`
        )
        .replaceAll(
          'https://oauth.alibaba.com/authorize',
          `chrome-extension://${extensionId}/top-approval.html`
        )
        .replaceAll('https://oauth.alibaba.com', TOP_TOKEN_FIXTURE_ORIGIN)
        .replaceAll(IOP_API_ORIGIN, PUBLIC_AUTH_ORIGIN)
    );
  }
  await cp(
    resolve(root, 'mock/data/alibaba-auth/iop-approval.html'),
    resolve(extension, 'iop-approval.html')
  );
  await cp(resolve(root, 'mock/data/alibaba-auth/iop-approval.js'), resolve(extension, 'iop-approval.js'));
  await cp(
    resolve(root, 'mock/data/alibaba-auth/iop-approval.html'),
    resolve(extension, 'top-approval.html')
  );
  // Test-only copy pregrants native host consent. The shipping manifest is never modified.
  manifest.host_permissions.push(
    `${IOP_API_ORIGIN}/*`,
    `${PUBLIC_AUTH_ORIGIN}/*`,
    `${TOP_TOKEN_FIXTURE_ORIGIN}/*`,
    ...IOP_APPLICATION_READER_ORIGINS,
    ...TOP_APPLICATION_READER_ORIGINS
  );
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(resolve(temporary, 'profile'), {
    headless: false,
    locale: 'zh-CN',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  expect(new URL(worker.url()).host).toBe(extensionId);
  const rejectNativeDialog = (page: Page): void => {
    page.on('dialog', (dialog) => {
      nativeDialogs.push(dialog.type());
      void dialog.dismiss();
    });
  };
  context.on('page', rejectNativeDialog);
  for (const page of context.pages()) rejectNativeDialog(page);
  await context.route(/^https?:\/\//u, (route) => route.abort());
  // The real cross-origin URLs and Chrome frame permissions are exercised, but every
  // document, script and request is fulfilled offline. No Alibaba/private API is called.
  await context.route(/^https:\/\/(?:i|openapi|crosstrade)\.alibaba\.com\//u, async (route) => {
    const url = new URL(route.request().url());
    const file =
      url.origin === 'https://i.alibaba.com' && url.pathname === '/explore/open-api'
        ? 'application-center-shell.html'
        : url.origin === 'https://crosstrade.alibaba.com' && url.pathname === '/ecology/index.htm'
          ? 'legacy-application-not-found.html'
          : url.pathname.startsWith('/fixtures/')
            ? url.pathname.slice('/fixtures/'.length)
            : null;
    if (
      !file ||
      ![
        'application-center.html',
        'application-center.js',
        'application-center-shell.html',
        'application-center-shell.js',
        'standalone-authorization.json',
        'legacy-application-not-found.html'
      ].includes(file)
    ) {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: file === 'legacy-application-not-found.html' ? 404 : 200,
      body: await readFile(resolve(root, 'mock/data/alibaba-auth', file)),
      contentType:
        extname(file) === '.js'
          ? 'application/javascript; charset=utf-8'
          : extname(file) === '.json'
            ? 'application/json; charset=utf-8'
            : 'text/html; charset=utf-8'
    });
  });
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
  await context.route(`${TOP_TOKEN_FIXTURE_ORIGIN}/token`, async (route) => {
    const parameters = new URLSearchParams(route.request().postData() ?? '');
    expect(route.request().method()).toBe('POST');
    expect(parameters.get('client_id')).toBe(standalone.top.appKey);
    expect(parameters.get('client_secret')).toBe(standalone.top.appSecret);
    expect(parameters.get('sp')).toBe('icbu');
    if (parameters.get('grant_type') === 'authorization_code') {
      topCreates++;
      expect(parameters.get('code')).toBe('fixture-authorized-code');
      expect(parameters.get('redirect_uri')).toBe(standalone.top.callbackUrl);
    } else {
      expect(parameters.get('grant_type')).toBe('refresh_token');
      expect(parameters.get('refresh_token')).toBe(standalone.topToken.refresh_token);
      topRefreshes++;
    }
    await route.fulfill({
      json: {
        ...standalone.topToken,
        ...(topRefreshes
          ? { access_token: 'fixture-top-rotated-access', refresh_token: 'fixture-top-rotated-refresh' }
          : {})
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
  try {
    expect(nativeDialogs, 'Authorization uses HTML dialogs, never native alert/confirm/prompt').toEqual([]);
  } finally {
    await context.close();
  }
});

async function confirmToolAction(tool: Page): Promise<void> {
  const dialog = tool.getByRole('dialog').filter({ has: tool.getByTestId('authorization-confirm') });
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('authorization-confirm').click();
  await expect(dialog).toHaveCount(0);
}

async function openTool(protocol: 'top' | 'iop' = 'iop', discover = false): Promise<Page> {
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/authorization.html?protocol=${protocol}${discover ? '&discover=1' : ''}`
  );
  await expect(page.locator('#language')).toBeVisible();
  if ((await page.locator('html').getAttribute('lang')) === 'en-US') await page.locator('#language').click();
  return page;
}

async function prepareProtection(tool: Page, passphrase = '123456'): Promise<void> {
  const protection = tool.locator('#protectionSection');
  await expect
    .poll(async () => (await protection.isVisible()) || (await tool.locator('#discover').isEnabled()))
    .toBe(true);
  if (await protection.isVisible()) {
    await tool.locator('#sharedPassphrase').fill(passphrase);
    await tool.locator('#protectionForm button[type="submit"]').click();
    await expect(protection).toBeHidden();
  }
  await expect(tool.locator('#sharedPassphrase')).toHaveValue('');
  await expect(tool.locator('#passphrase')).toBeHidden();
  await expect(tool.getByRole('dialog')).toHaveCount(0);
}

async function authorize(): Promise<Page> {
  const site = await context.newPage();
  await site.goto(PUBLIC_AUTH_ORIGIN);
  await expect(site.locator('#notice')).toHaveText('插件已连接');
  expect(await site.locator('input').count()).toBe(0);
  const toolEvent = context.waitForEvent('page');
  await site.locator('#open').click();
  const tool = await toolEvent;
  await tool.waitForLoadState();
  // tabs.create can render before Playwright applies the context locale; use the real UI switch.
  await expect(tool.locator('#language')).toBeVisible();
  if ((await tool.locator('html').getAttribute('lang')) === 'en-US') await tool.locator('#language').click();
  await expect(tool.locator('#status')).toHaveText('尚未配置');
  await prepareProtection(tool);
  await tool.locator('#manualEntry').click();
  await tool.locator('#appName').fill('Merchant fixture');
  await tool.locator('#appKey').fill(credentials.oauthBundle.application.appKey);
  await tool.locator('#appSecret').fill(credentials.oauthBundle.application.appSecret);
  if (!(await tool.locator('#manualSection').isVisible())) await tool.locator('#manualEntry').click();
  await tool.locator('#registered').check();
  const oauthEvent = context.waitForEvent('page');
  await tool.locator('#start').click();
  const oauth = await oauthEvent;
  await oauth.waitForURL(`chrome-extension://${extensionId}/iop-approval.html**`);
  await expect(tool.locator('#appSecret')).toHaveValue('');
  await oauth.locator('#approve').click();
  await expect(oauth).toHaveURL(PUBLIC_AUTH_CALLBACK);
  await expect(oauth.locator('body')).not.toContainText(tokens.success.access_token);
  await expect(tool.locator('#status')).toHaveText('授权文件已安全保存', { timeout: 20_000 });
  return tool;
}
async function exportBundle(tool: Page): Promise<Record<string, unknown>> {
  const downloading = tool.waitForEvent('download');
  await tool.locator('#export').click();
  await confirmToolAction(tool);
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('credentialInfo.json');
  const path = await download.path();
  if (!path) throw new Error('Missing downloaded fixture');
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

async function sendWorkbench(
  page: Page,
  kind: string,
  operation: string,
  payload: unknown = {},
  extra: Record<string, unknown> = {}
) {
  return page.evaluate(
    async (message) => {
      const runtime = (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage(value: unknown): Promise<unknown> } };
        }
      ).chrome.runtime;
      return runtime.sendMessage({ ...message, requestId: crypto.randomUUID() });
    },
    { ...extra, kind, operation, payload }
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
  await expect(tool.locator('#notice')).toContainText('JSON 下载已发起');
  await expect(tool.locator('#nextStep')).toContainText('下载文件不等于已连接工作台');
  await expect(tool.locator('#useStep')).toHaveAttribute('aria-current', 'step');
  const statusWithNotice = await tool.locator('#status').boundingBox();
  await expect(tool.locator('#notice')).not.toBeVisible({ timeout: 6_000 });
  await expect(tool.locator('#notice')).toBeEmpty();
  expect(await tool.locator('#status').boundingBox()).toEqual(statusWithNotice);
  const stored = await worker.evaluate(() =>
    (
      globalThis as unknown as { chrome: { storage: { local: { get(key: string): Promise<unknown> } } } }
    ).chrome.storage.local.get('one-vegetable-iop-authorization-v1')
  );
  expect(JSON.stringify(stored)).not.toContain(tokens.success.access_token);
  expect(JSON.stringify(stored)).not.toContain(credentials.oauthBundle.application.appSecret);
  await tool.locator('#refresh').click();
  expect(refreshes).toBe(0);
  await confirmToolAction(tool);
  await expect.poll(() => refreshes).toBe(1);
  await expect(tool.locator('#status')).toHaveText('授权文件已安全保存');
  expect((await exportBundle(tool)).oauth).toMatchObject({
    accessToken: 'fixture-rotated-access',
    refreshToken: 'fixture-rotated-refresh'
  });
  await tool.locator('#connectionDetails summary').click();
  await tool.locator('#lock').click();
  await expect(tool.locator('#status')).toHaveText('授权包已锁定');
  await expect(tool.locator('#unlockForm')).toBeVisible();
  await expect(tool.locator('#discover')).toBeHidden();
  await expect(tool.locator('#nextStep')).toContainText('不是 Alibaba 登录密码');
  await expect(tool.locator('#export')).toBeDisabled();
  await expect(tool.locator('#manualSection')).toBeHidden();
  await tool.locator('#unlockPassphrase').fill('123456');
  await tool.locator('#unlock').click();
  await expect(tool.locator('#status')).toHaveText('授权文件已安全保存');
  await tool.locator('#language').click();
  await expect(tool.locator('#export')).toHaveText('Download authorization file');
  await tool.emulateMedia({ colorScheme: 'dark' });
  await expect(tool.locator('#export')).toBeEnabled();
  expect(creates).toBe(1);
  expect(refreshes).toBe(1);
});

test('new users see a guided next action, not technical fields or disabled renewal controls', async () => {
  const tool = await openTool();
  await expect(tool.locator('#status')).toHaveText('尚未配置');
  await expect(tool.locator('#protectionForm')).toBeVisible();
  await expect(tool.locator('#sharedPassphrase')).not.toHaveAttribute('required', '');
  await expect(tool.locator('#discover')).toBeDisabled();
  await expect(tool.locator('#manualEntry')).toBeDisabled();
  await expect(tool.locator('#chooseFile')).toBeDisabled();
  expect(creates + topCreates + refreshes + topRefreshes).toBe(0);
  await prepareProtection(tool);
  await expect(tool.locator('#connectStep')).toHaveAttribute('aria-current', 'step');
  await expect(tool.locator('#discover')).toHaveText('前往 Alibaba 连接');
  await expect(tool.locator('#appKey')).toBeHidden();
  await expect(tool.locator('#appSecret')).toBeHidden();
  await expect(tool.locator('#callback')).toBeHidden();
  await expect(tool.locator('#unlockForm')).toBeHidden();
  await expect(tool.locator('#refresh')).toBeHidden();
  await expect(tool.locator('#export')).toBeHidden();
  await expect(tool.locator('#protocolTop')).toBeHidden();
  await expect(tool.locator('#chooseFile')).toBeVisible();
  await expect(tool.locator('#nextStep')).toContainText('登录或验证');
  await tool.screenshot({ path: resolve(UI_SCREENSHOT_DIRECTORY, 'guided-connect-zh.png'), fullPage: true });
  await tool.locator('#manualEntry').click();
  await expect(tool.locator('#appName')).toBeFocused();
  await expect(tool.locator('#appKey')).toBeVisible();
  await tool.locator('#appName').fill('Unsubmitted local form');
  await tool.locator('#language').click();
  await expect(tool.locator('#appName')).toHaveValue('Unsubmitted local form');
  await expect(tool.locator('#discover')).toHaveText('Connect on Alibaba');
  await expect(tool.locator('#nextStep')).toContainText('sign in or verify');
  expect(creates + topCreates + refreshes + topRefreshes).toBe(0);
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
  if (!(await tool.locator('#manualSection').isVisible())) await tool.locator('#manualEntry').click();
  await tool.locator('#file').setInputFiles({
    name: 'credentials.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(credentials.oauthBundle))
  });
  await expect(tool.locator('#error')).toContainText('旧 TOP');
  await expect(tool.getByRole('dialog')).toHaveCount(0);
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

for (const language of ['en', 'zh'] as const) {
  test(`IOP discovery reads Alice's cross-origin app with visible guided clicks (${language})`, async () => {
    const alibaba = await context.newPage();
    await alibaba.goto(`https://i.alibaba.com/explore/open-api?language=${language}`);
    // Extension Reload can leave its old guide DOM without a live listener.
    await alibaba.evaluate(() => {
      const orphan = document.createElement('div');
      orphan.id = 'one-vegetable-alibaba-developer-guide';
      orphan.dataset.orphanedGuide = '';
      document.documentElement.append(orphan);
    });
    const tool = await openTool('iop', true);
    const protection = tool.locator('#protectionSection');
    await expect(protection).toBeVisible();
    await expect(alibaba.locator('body')).toHaveAttribute('data-center-clicks', '0');
    const password = tool.locator('#sharedPassphrase');
    await expect(password).toHaveAttribute('minlength', '6');
    await password.fill('12345');
    await tool.locator('#protectionForm button[type="submit"]').click();
    await expect(protection).toBeVisible();
    await expect(alibaba.locator('body')).toHaveAttribute('data-center-clicks', '0');
    expect(creates + topCreates).toBe(0);
    const oauthEvent = context.waitForEvent('page');
    await prepareProtection(tool);
    await expect(alibaba.locator('[data-orphaned-guide]')).toHaveCount(0);
    await expect(alibaba.locator('body')).toHaveAttribute('data-center-clicks', '1');
    await expect(alibaba.locator('body')).toHaveAttribute('data-center-pointer', 'true');
    // Captured inside the actual click handler, so a guide injected after navigation
    // cannot satisfy this: the merchant must see it before the first guided click.
    await expect(alibaba.locator('body')).toHaveAttribute('data-center-guide', 'true');
    const application = alibaba.frameLocator('#application-frame');
    await expect(application.locator('body')).toHaveAttribute('data-view-clicks', '1');
    await expect(application.locator('body')).toHaveAttribute('data-view-pointer', 'true');
    await expect(application.locator('body')).toHaveAttribute('data-reset-clicks', '0');
    await expect(tool.locator('#appName')).toHaveValue(standalone.iop.appName);
    await expect(tool.locator('#appKey')).toHaveValue(standalone.iop.appKey);
    await expect(tool.locator('#callback')).toHaveValue(standalone.iop.callbackUrl);
    const oauth = await oauthEvent;
    await oauth.waitForURL(`chrome-extension://${extensionId}/iop-approval.html**`);
    const query = new URL(oauth.url()).searchParams;
    expect(query.get('client_id')).toBe(standalone.iop.appKey);
    expect(query.get('redirect_uri')).toBe(standalone.iop.callbackUrl);
    expect(query.get('state')).toMatch(/^[0-9a-f-]{36}$/u);
    expect(query.has('appSecret')).toBe(false);
    const guideText = await alibaba.locator('#one-vegetable-alibaba-developer-guide').evaluate((host) => {
      return host.shadowRoot?.textContent ?? host.textContent;
    });
    expect(guideText).not.toContain(standalone.iop.appSecret);
    expect(guideText).not.toContain(tokens.success.access_token);
    // Discovery starts OAuth but must never accept Alibaba's agreement automatically.
    expect(creates).toBe(0);
    await expect(oauth.locator('#approve')).toBeVisible();
    await expect(tool.locator('#appSecret')).toHaveValue('');
    await oauth.locator('#approve').click();
    await expect(tool.locator('#status')).toHaveText('授权文件已安全保存', { timeout: 20_000 });
    expect(creates).toBe(1);
    expect(topCreates + refreshes + topRefreshes).toBe(0);
    const exported = await exportBundle(tool);
    expect(exported).toMatchObject({ protocol: 'iop', application: standalone.iop });
    expect(await alibaba.locator('[data-one-vegetable-guided-pointer]').count()).toBe(0);
    await expect(application.locator('[data-one-vegetable-guided-pointer]')).toHaveCount(0);
    expect(context.pages().filter((page) => page.url().includes('crosstrade.alibaba.com'))).toHaveLength(0);
    await expect(tool).not.toHaveURL(/discover=/u);
    // A normal reload cannot rerun discovery or start another OAuth exchange.
    await tool.reload();
    await expect(tool.locator('#status')).toHaveText('授权文件已安全保存');
    await expect(alibaba.locator('body')).toHaveAttribute('data-center-clicks', '1');
    expect(creates).toBe(1);
  });
}

test('the Open Platform guide stays inside mobile and desktop viewports with a fixed header and scrollable body', async () => {
  const alibaba = await context.newPage();
  await alibaba.goto('https://i.alibaba.com/explore/open-api');
  const tool = await openTool('iop', true);
  const oauthEvent = context.waitForEvent('page');
  await prepareProtection(tool);
  const oauth = await oauthEvent;
  await oauth.waitForURL(`chrome-extension://${extensionId}/iop-approval.html**`);
  await expect(oauth.locator('#approve')).toBeVisible();
  // Shared protection is already prepared; no second password prompt or automatic approval.
  await expect(tool.getByRole('dialog')).toHaveCount(0);
  const guide = alibaba.locator('#one-vegetable-alibaba-developer-guide');
  const panel = guide.locator('.panel');
  const header = guide.locator('.header');
  const body = guide.locator('.body');
  await expect(panel).toBeVisible();
  // Add offline explanatory content, not CSS: even a long guide must scroll
  // within the production panel rather than push its heading out of the screen.
  await body.evaluate((element, text) => {
    for (let index = 0; index < 30; index++) {
      const paragraph = document.createElement('p');
      paragraph.className = 'description';
      paragraph.textContent = text;
      element.append(paragraph);
    }
  }, standalone.guideOverflowText);
  for (const viewport of [
    { width: 320, height: 480 },
    { width: 1440, height: 900 }
  ]) {
    await test.step(`${viewport.width}x${viewport.height}`, async () => {
      await alibaba.setViewportSize(viewport);
      await expect(panel).toBeInViewport({ ratio: 1 });
      await expect(header).toBeInViewport({ ratio: 1 });
      const panelBefore = await panel.boundingBox();
      if (!panelBefore) throw new Error('Offline guide panel is not visible');
      const layout = await panel.evaluate((element) => {
        const root = element.getRootNode();
        const host = root instanceof ShadowRoot ? root.host : null;
        const rectangle = (node: Element | null) => {
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        };
        return {
          innerWidth,
          innerHeight,
          clientWidth: document.documentElement.clientWidth,
          clientHeight: document.documentElement.clientHeight,
          visualViewportWidth: visualViewport?.width,
          panel: rectangle(element),
          host: rectangle(host),
          hostRight: host ? getComputedStyle(host).right : null,
          panelWidth: getComputedStyle(element).width
        };
      });
      await test.info().attach(`guide-layout-${viewport.width}x${viewport.height}`, {
        body: JSON.stringify(layout, null, 2),
        contentType: 'application/json'
      });
      await alibaba.screenshot({
        path: resolve(UI_SCREENSHOT_DIRECTORY, `guide-${viewport.width}x${viewport.height}.png`),
        mask: [alibaba.frameLocator('#application-frame').locator('[data-field="secret"]')],
        animations: 'disabled'
      });
      expect(panelBefore.x).toBeGreaterThanOrEqual(15);
      expect(panelBefore.y).toBeGreaterThanOrEqual(15);
      expect(panelBefore.x + panelBefore.width).toBeLessThanOrEqual(viewport.width - 15);
      expect(panelBefore.y + panelBefore.height).toBeLessThanOrEqual(viewport.height - 15);
      const headerBefore = await header.boundingBox();
      expect(headerBefore).not.toBeNull();
      const scroll = await body.evaluate((element) => ({
        overflow: getComputedStyle(element).overflowY,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight
      }));
      expect(['auto', 'scroll']).toContain(scroll.overflow);
      expect(scroll.clientHeight).toBeGreaterThan(0);
      expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
      await body.evaluate((element) => {
        element.scrollTop = 0;
      });
      await alibaba.screenshot({
        path: resolve(UI_SCREENSHOT_DIRECTORY, `guide-${viewport.width}x${viewport.height}.png`),
        mask: [alibaba.frameLocator('#application-frame').locator('[data-field="secret"]')],
        animations: 'disabled'
      });
      const pageScrollBefore = await alibaba.evaluate(() => window.scrollY);
      await body.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await panel.boundingBox()).toEqual(panelBefore);
      expect(await header.boundingBox()).toEqual(headerBefore);
      await expect(header).toBeInViewport({ ratio: 1 });
      await expect(header.getByRole('button')).toBeInViewport({ ratio: 1 });
      expect(await alibaba.evaluate(() => window.scrollY)).toBe(pageScrollBefore);
    });
  }
  expect(creates + topCreates + refreshes + topRefreshes).toBe(0);
});

for (const [mode, expected] of [
  ['security-check', 'Alibaba 要求验证码或密钥安全验证'],
  ['overlay', '已找到应用，但未能点击“查看”密钥'],
  ['missing-callback', '未能在 30 秒内读取完整应用信息']
] as const) {
  test(`IOP discovery stops safely for ${mode}, without starting OAuth or opening legacy TOP`, async () => {
    const alibaba = await context.newPage();
    await alibaba.goto(`https://i.alibaba.com/explore/open-api?mode=${mode}`);
    const tool = await openTool('iop', true);
    await prepareProtection(tool);
    await expect(tool.locator('#error')).toContainText(expected, { timeout: 40_000 });
    const statusWithError = await tool.locator('#status').boundingBox();
    await expect(tool.getByRole('dialog')).toHaveCount(0);
    await expect(tool.locator('#discover')).toBeEnabled();
    await expect(tool.locator('#appSecret')).toHaveValue('');
    const application = alibaba.frameLocator('#application-frame');
    await expect(application.locator('body')).toHaveAttribute('data-reset-clicks', '0');
    if (mode === 'overlay') {
      await expect(application.locator('#blocking-overlay')).toBeVisible();
      await expect(application.locator('body')).toHaveAttribute('data-view-clicks', '0');
      // This fresh vault has no workbench preference; the guide uses its en-US default.
      await expect(alibaba.locator('#one-vegetable-alibaba-developer-guide .title')).toContainText(
        'Click View beside App Secret, then read again.'
      );
    }
    if (mode === 'security-check')
      await expect(application.locator('body')).toHaveAttribute('data-view-clicks', '1');
    expect(creates + topCreates + refreshes + topRefreshes).toBe(0);
    expect(context.pages().filter((page) => page.url().includes('-approval.html'))).toHaveLength(0);
    expect(context.pages().filter((page) => page.url().includes('crosstrade.alibaba.com'))).toHaveLength(0);
    const stored = await worker.evaluate(
      async (keys) => {
        const api = (
          globalThis as unknown as {
            chrome: { storage: { local: { get(keys: string[]): Promise<unknown> } } };
          }
        ).chrome;
        return api.storage.local.get(keys);
      },
      [IOP_VAULT_KEY, TOP_VAULT_KEY]
    );
    expect(stored).toEqual({});
    await expect(tool.locator('#error')).not.toBeVisible({ timeout: 9_000 });
    await expect(tool.locator('#error')).toBeEmpty();
    expect(await tool.locator('#status').boundingBox()).toEqual(statusWithError);
    // A later UI rerender must not replay an already dismissed transient error.
    await tool.locator('#language').click();
    await expect(tool.locator('#error')).not.toBeVisible();
  });
}

for (const legacyPage of ['none', 'not-found'] as const) {
  test(`TOP discovery reports unavailable with ${legacyPage} legacy page, without opening 404 or borrowing IOP`, async () => {
    const alibaba = await context.newPage();
    await alibaba.goto('https://i.alibaba.com/explore/open-api');
    // Make a valid IOP app and secret visible: TOP must not borrow either even
    // when the new console is open and complete.
    await alibaba.locator('#application-center').click();
    const application = alibaba.frameLocator('#application-frame');
    await expect(application.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
    await application.locator('#view-secret').click();
    let legacy: Page | null = null;
    if (legacyPage === 'not-found') {
      legacy = await context.newPage();
      await legacy.goto('https://crosstrade.alibaba.com/ecology/index.htm');
      await expect(legacy).toHaveTitle(/404 Not Found/u);
    }
    const tool = await openTool('top', true);
    await prepareProtection(tool);
    await expect(tool.locator('#error')).toContainText('无法从已打开的旧 TOP 应用页读取完整信息');
    await expect(tool.locator('#discover')).toBeVisible();
    await expect(tool.locator('#discover')).toBeEnabled();
    await expect(tool.locator('#topManualGuide')).toHaveAttribute('open', '');
    await expect(tool.locator('#topManualGuide')).toContainText('自动读取失败不代表不能手动授权');
    await tool.locator('#manualEntry').click();
    await expect(tool.locator('#appName')).toBeFocused();
    await expect(tool.locator('#status')).toHaveText('尚未配置');
    for (const id of ['appName', 'appKey', 'appSecret', 'callback'])
      await expect(tool.locator(`#${id}`)).toHaveValue('');
    await expect(tool.getByRole('dialog')).toHaveCount(0);
    const checked = await tool.evaluate(async () => {
      const api = (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
        }
      ).chrome;
      return api.runtime.sendMessage({
        kind: 'iop-authorization-request',
        requestId: crypto.randomUUID(),
        protocol: 'top',
        action: 'discover-application',
        payload: {}
      });
    });
    expect(checked).toMatchObject({ ok: false, error: { code: 'TOP_APP_NOT_AVAILABLE' } });
    expect(JSON.stringify(checked)).not.toContain(standalone.iop.appSecret);
    await expect(alibaba.locator('body')).toHaveAttribute('data-center-clicks', '1');
    await expect(application.locator('body')).toHaveAttribute('data-view-clicks', '1');
    expect(context.pages().filter((page) => page.url().includes('crosstrade.alibaba.com'))).toHaveLength(
      legacyPage === 'not-found' ? 1 : 0
    );
    if (legacy) expect(legacy.isClosed()).toBe(false);
    expect(context.pages().filter((page) => page.url().includes('-approval.html'))).toHaveLength(0);
    expect(creates + topCreates + refreshes + topRefreshes).toBe(0);
    await expect(tool).not.toHaveURL(/discover=/u);
    await tool.reload();
    await expect(tool.locator('#status')).toHaveText('尚未配置');
    await expect(tool.locator('#error')).not.toBeVisible();
  });
}

test('standalone TOP and IOP use separate OAuth endpoints, encrypted vaults, refresh and clear', async () => {
  const iop = await authorize();
  const top = await openTool('top');
  await prepareProtection(top);
  await expect(top.locator('#title')).toHaveText('连接 Alibaba · 旧版应用');
  await expect(top.locator('#status')).toHaveText('尚未配置');
  await expect(top.locator('#discover')).toBeVisible();
  await expect(top.locator('#center')).toBeHidden();
  await top.locator('#manualEntry').click();
  await expect(top.locator('#appName')).toBeFocused();
  await expect(top.locator('#topManualGuide')).toContainText('无需启动 Node');
  for (const [id, value] of Object.entries({
    appName: standalone.top.appName,
    appKey: standalone.top.appKey,
    appSecret: standalone.top.appSecret,
    callback: standalone.top.callbackUrl
  }))
    await top.locator(`#${id}`).fill(value);
  await top.locator('#registered').check();
  const oauthEvent = context.waitForEvent('page');
  await top.locator('#start').click();
  const oauth = await oauthEvent;
  await oauth.waitForURL(`chrome-extension://${extensionId}/top-approval.html**`);
  const query = new URL(oauth.url()).searchParams;
  expect(query.get('client_id')).toBe(standalone.top.appKey);
  expect(query.get('redirect_uri')).toBe(standalone.top.callbackUrl);
  expect(topCreates).toBe(0);
  await oauth.locator('#approve').click();
  await expect(top.locator('#status')).toHaveText('授权文件已安全保存', { timeout: 20_000 });
  expect(creates).toBe(1);
  expect(topCreates).toBe(1);
  expect(await exportBundle(top)).toMatchObject({
    protocol: 'top',
    application: standalone.top,
    oauth: { accessToken: standalone.topToken.access_token }
  });
  await top.locator('#refresh').click();
  expect(topRefreshes).toBe(0);
  await confirmToolAction(top);
  await expect.poll(() => topRefreshes).toBe(1);
  await expect(top.locator('#status')).toHaveText('授权文件已安全保存');
  expect(refreshes).toBe(0);
  expect((await exportBundle(top)).oauth).toMatchObject({ accessToken: 'fixture-top-rotated-access' });
  const stored = await worker.evaluate(
    async (keys) => {
      const api = (
        globalThis as unknown as { chrome: { storage: { local: { get(keys: string[]): Promise<unknown> } } } }
      ).chrome;
      return api.storage.local.get(keys);
    },
    [IOP_VAULT_KEY, TOP_VAULT_KEY, IOP_RECEIPT_KEY, TOP_RECEIPT_KEY]
  );
  expect(stored).toHaveProperty(IOP_VAULT_KEY);
  expect(stored).toHaveProperty(TOP_VAULT_KEY);
  for (const secret of [
    tokens.success.access_token,
    standalone.topToken.access_token,
    standalone.top.appSecret
  ])
    expect(JSON.stringify(stored)).not.toContain(secret);
  await top.locator('#connectionDetails summary').click();
  await top.locator('#clear').click();
  await confirmToolAction(top);
  await expect(top.locator('#status')).toHaveText('尚未配置');
  expect((await exportBundle(iop)).oauth).toMatchObject({ accessToken: tokens.success.access_token });
  await top.reload();
  await expect(top.locator('#status')).toHaveText('尚未配置');
  expect(creates).toBe(1);
  expect(topCreates).toBe(1);
});

test('HTML confirmation is cancellable and import, export, refresh and clear do nothing before confirmation', async () => {
  const tool = await authorize();
  const downloads: string[] = [];
  tool.on('download', (download) => downloads.push(download.suggestedFilename()));
  await tool.locator('#connectionDetails summary').click();
  for (const action of ['export', 'refresh', 'clear'] as const) {
    await tool.locator(`#${action}`).click();
    const dialog = tool.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
    expect(refreshes).toBe(0);
    expect(downloads).toEqual([]);
    await tool.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(tool.locator(`#${action}`)).toBeFocused();
    await expect(tool.locator('#status')).toHaveText('授权文件已安全保存');
  }
  if (!(await tool.locator('#manualSection').isVisible())) await tool.locator('#manualEntry').click();
  await tool.locator('#file').setInputFiles({
    name: 'existing-iop.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(jsonImports.iop))
  });
  const dialog = tool.getByRole('dialog');
  await expect(dialog).toContainText('确认替换');
  await expect(tool.locator('#error')).toBeEmpty();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(tool.locator('#error')).toBeEmpty();
  await tool.locator('#protocolSettings summary').click();
  await tool.locator('#protocolTop').click();
  await expect(tool.getByRole('dialog')).toContainText('切换授权类型');
  await tool.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(tool.locator('#protocolIop')).toHaveAttribute('aria-pressed', 'true');
  await expect(tool.locator('#appName')).toHaveValue('Merchant fixture');
  expect(refreshes + topRefreshes + topCreates).toBe(0);
  expect(downloads).toEqual([]);
  expect((await exportBundle(tool)).oauth).toMatchObject({ accessToken: tokens.success.access_token });
});

test('a rejected refresh uses a temporary error toast and does not repeat on status rerender', async () => {
  const tool = await authorize();
  await tool.locator('#refresh').scrollIntoViewIfNeeded();
  const statusBefore = await tool.locator('#status').boundingBox();
  await context.route(`${PUBLIC_AUTH_ORIGIN}/rest/auth/token/refresh`, async (route) => {
    refreshes++;
    await route.fulfill({ json: tokens.invalidAppKey });
  });
  await tool.locator('#refresh').click();
  await confirmToolAction(tool);
  await expect(tool.locator('#error')).toContainText('Alibaba 拒绝换取或续期 Token');
  await expect(tool.locator('#status')).toHaveText('授权文件已安全保存');
  expect(await tool.locator('#status').boundingBox()).toEqual(statusBefore);
  await expect(tool.locator('#error')).not.toBeVisible({ timeout: 9_000 });
  await expect(tool.locator('#error')).toBeEmpty();
  await tool.locator('#language').click();
  await expect(tool.locator('#error')).not.toBeVisible();
  await expect(tool.locator('#error')).toBeEmpty();
  expect(creates).toBe(1);
  expect(refreshes).toBe(1);
  expect((await exportBundle(tool)).oauth).toMatchObject({ accessToken: tokens.success.access_token });
});

test('advanced JSON selects complete examples and imports only the confirmed matching protocol without secret notifications', async () => {
  const tool = await openTool();
  const advanced = tool.locator('#advancedJson');
  const editor = advanced.locator('#credentialJson');
  const importButton = advanced.locator('#importJson');
  await expect(importButton).toBeDisabled();
  await prepareProtection(tool);
  const storage = async (): Promise<Record<string, unknown>> =>
    worker.evaluate(
      async (keys) => {
        const api = (
          globalThis as unknown as {
            chrome: { storage: { local: { get(keys: string[]): Promise<Record<string, unknown>> } } };
          }
        ).chrome;
        return api.storage.local.get(keys);
      },
      [IOP_VAULT_KEY, TOP_VAULT_KEY]
    );
  const assertPrivateMessages = async (): Promise<void> => {
    const messages = (await tool.locator('#notice, #error, dialog').allTextContents()).join('\n');
    for (const bundle of [jsonImports.iop, jsonImports.top]) {
      expect(messages).not.toContain(bundle.application.appSecret);
      expect(messages).not.toContain(bundle.oauth.accessToken);
    }
  };
  const openExample = async (protocol: 'iop' | 'top'): Promise<void> => {
    if ((await advanced.getAttribute('open')) !== null) await advanced.locator('summary').click();
    await advanced.locator('summary').click();
    await expect(editor).toBeVisible();
    await expect
      .poll(() =>
        editor.evaluate(
          (element) =>
            element instanceof HTMLTextAreaElement &&
            element.value.length > 0 &&
            element.selectionStart === 0 &&
            element.selectionEnd === element.value.length &&
            document.activeElement === element
        )
      )
      .toBe(true);
    const example: unknown = JSON.parse(await editor.inputValue());
    expect(example).toMatchObject({
      schemaVersion: 1,
      protocol,
      application: {
        appName: expect.any(String),
        appKey: expect.any(String),
        appSecret: expect.any(String),
        callbackUrl: expect.any(String)
      },
      oauth: { accessToken: expect.any(String) },
      callback: { stateMatched: true }
    });
    await expect(advanced.locator('pre')).toContainText('schemaVersion');
  };
  await openExample('iop');
  await tool.emulateMedia({ colorScheme: 'dark' });
  // The all-selected state was asserted above. For a readable fixture screenshot,
  // show the beginning of the example rather than the selection's scrolled end.
  await editor.evaluate((element) => {
    if (element instanceof HTMLTextAreaElement) {
      element.setSelectionRange(0, 0);
      element.scrollTop = 0;
      element.dispatchEvent(new Event('scroll'));
    }
  });
  await advanced.screenshot({
    path: resolve(UI_SCREENSHOT_DIRECTORY, 'advanced-json-dark.png'),
    animations: 'disabled'
  });
  await tool.emulateMedia({ colorScheme: 'light' });
  // Unmodified placeholder examples are never accepted as real credentials.
  if (await importButton.isEnabled()) {
    await importButton.click();
    await expect(tool.getByRole('dialog')).toHaveCount(0);
  }
  expect(await storage()).toEqual({});
  await editor.fill(JSON.stringify(jsonImports.invalidIop));
  await importButton.click();
  if ((await tool.getByRole('dialog').count()) > 0) await confirmToolAction(tool);
  await expect(tool.locator('#error')).toBeVisible();
  expect(await storage()).toEqual({});
  await assertPrivateMessages();
  await editor.fill(JSON.stringify(jsonImports.iop, null, 2));
  await importButton.click();
  await expect(tool.getByRole('dialog')).toBeVisible();
  await assertPrivateMessages();
  expect(await storage()).toEqual({});
  await confirmToolAction(tool);
  await expect(tool.locator('#status')).toHaveText('授权文件已安全保存');
  expect(await editor.inputValue()).not.toContain(jsonImports.iop.oauth.accessToken);
  expect(await editor.inputValue()).not.toContain(jsonImports.iop.application.appSecret);
  await expect(advanced.locator('pre')).not.toContainText(jsonImports.iop.oauth.accessToken);
  await expect(advanced.locator('pre')).not.toContainText(jsonImports.iop.application.appSecret);
  await assertPrivateMessages();
  const iopStored = await storage();
  expect(iopStored).toHaveProperty(IOP_VAULT_KEY);
  expect(iopStored).not.toHaveProperty(TOP_VAULT_KEY);
  expect(await exportBundle(tool)).toMatchObject(jsonImports.iop);

  await tool.locator('#protocolSettings summary').click();
  await tool.locator('#protocolTop').click();
  if ((await tool.getByRole('dialog').count()) > 0) await confirmToolAction(tool);
  await expect(tool.locator('#protocolTop')).toHaveAttribute('aria-pressed', 'true');
  await expect(tool.locator('#status')).toHaveText('尚未配置');
  await openExample('top');
  await expect(tool.locator('#protectionSection')).toBeHidden();
  await editor.fill(JSON.stringify(jsonImports.iop));
  await importButton.click();
  if ((await tool.getByRole('dialog').count()) > 0) await confirmToolAction(tool);
  await expect(tool.locator('#error')).toContainText('TOP');
  await assertPrivateMessages();
  expect(await storage()).toEqual(iopStored);
  await editor.fill(JSON.stringify(jsonImports.top, null, 2));
  await importButton.click();
  await expect(tool.getByRole('dialog')).toBeVisible();
  expect(await storage()).toEqual(iopStored);
  await assertPrivateMessages();
  await confirmToolAction(tool);
  await expect(tool.locator('#status')).toHaveText('授权文件已安全保存');
  await expect(tool.locator('#protectionSection')).toBeHidden();
  await expect(tool.getByRole('dialog')).toHaveCount(0);
  expect(await editor.inputValue()).not.toContain(jsonImports.top.oauth.accessToken);
  expect(await editor.inputValue()).not.toContain(jsonImports.top.application.appSecret);
  await expect(advanced.locator('pre')).not.toContainText(jsonImports.top.oauth.accessToken);
  await expect(advanced.locator('pre')).not.toContainText(jsonImports.top.application.appSecret);
  const stored = await storage();
  expect(stored).toHaveProperty(IOP_VAULT_KEY, iopStored[IOP_VAULT_KEY]);
  expect(stored).toHaveProperty(TOP_VAULT_KEY);
  for (const bundle of [jsonImports.iop, jsonImports.top]) {
    expect(JSON.stringify(stored)).not.toContain(bundle.application.appSecret);
    expect(JSON.stringify(stored)).not.toContain(bundle.oauth.accessToken);
  }
  await assertPrivateMessages();
  expect(await exportBundle(tool)).toMatchObject(jsonImports.top);
  expect(creates + topCreates + refreshes + topRefreshes).toBe(0);
});

test('authorization action buttons align in both languages and themes, with readable HTML dialogs', async () => {
  const tool = await openTool();
  await tool.setViewportSize({ width: 1440, height: 1080 });
  for (const colorScheme of ['light', 'dark'] as const) {
    await tool.emulateMedia({ colorScheme });
    for (const language of ['zh-CN', 'en-US'] as const) {
      if ((await tool.locator('html').getAttribute('lang')) !== language)
        await tool.locator('#language').click();
      const boxes = await Promise.all(
        ['manualEntry', 'chooseFile'].map((id) => tool.locator(`#${id}`).boundingBox())
      );
      expect(boxes.every((box) => box !== null)).toBe(true);
      const heights = boxes.map((box) => box?.height ?? 0);
      const tops = boxes.map((box) => box?.y ?? 0);
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
      await tool.screenshot({
        path: resolve(UI_SCREENSHOT_DIRECTORY, `tool-${language}-${colorScheme}.png`),
        fullPage: true,
        animations: 'disabled'
      });
      await tool.locator('#connectionDetails summary').click();
      await tool.locator('#clear').click();
      const dialog = tool.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const colors = await dialog.evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, color: style.color };
      });
      expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
      expect(colors.color).not.toBe(colors.background);
      await tool.screenshot({
        path: resolve(UI_SCREENSHOT_DIRECTORY, `confirmation-${language}-${colorScheme}.png`),
        animations: 'disabled'
      });
      await tool.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await tool.locator('#connectionDetails summary').click();
    }
  }
  await tool.setViewportSize({ width: 390, height: 844 });
  await expect(tool.locator('#chooseFile')).toBeVisible();
  expect(await tool.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('shared protection preflight has readable optional controls in both languages, themes and mobile', async () => {
  const tool = await openTool();
  const protection = tool.locator('#protectionSection');
  await expect(protection).toBeVisible();
  for (const width of [1440, 390]) {
    await tool.setViewportSize({ width, height: 900 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await tool.emulateMedia({ colorScheme });
      for (const language of ['zh-CN', 'en-US'] as const) {
        if ((await tool.locator('html').getAttribute('lang')) !== language)
          await tool.locator('#language').click();
        await expect(protection).toBeVisible();
        await protection.locator('label').click();
        await expect(tool.locator('#sharedPassphrase')).toBeFocused();
        await expect(tool.locator('#sharedPassphrase')).not.toHaveAttribute('required', '');
        await expect(tool.locator('#discover')).toBeDisabled();
        await expect(tool.getByRole('dialog')).toHaveCount(0);
        const layout = await protection.evaluate((element) => {
          const input = element.querySelector('input');
          const actions = element.querySelector('.actions');
          if (!input || !actions) throw new Error('Missing passphrase controls');
          const buttons = [...actions.querySelectorAll('button')];
          const primary = buttons[0];
          if (!primary) throw new Error('Missing primary action');
          const rect = element.getBoundingClientRect();
          return {
            gap: actions.getBoundingClientRect().top - input.getBoundingClientRect().bottom,
            heights: buttons.map((button) => button.getBoundingClientRect().height),
            tops: buttons.map((button) => button.getBoundingClientRect().top),
            align: getComputedStyle(actions).justifyContent,
            background: getComputedStyle(primary).backgroundColor,
            foreground: getComputedStyle(primary).color,
            fits: rect.left >= 0 && rect.right <= innerWidth && element.scrollWidth <= element.clientWidth,
            described: Boolean(element.querySelector('p.muted')?.textContent.trim()),
            labelled: element.querySelector('label')?.getAttribute('for') === input.id
          };
        });
        // Chromium can report fractional pixels just below the CSS value.
        expect(Math.round(layout.gap)).toBeGreaterThanOrEqual(0);
        expect(Math.round(Math.min(...layout.heights))).toBeGreaterThanOrEqual(44);
        expect(Math.max(...layout.heights) - Math.min(...layout.heights)).toBeLessThanOrEqual(1);
        expect(Math.max(...layout.tops) - Math.min(...layout.tops)).toBeLessThanOrEqual(1);
        expect(layout.align).toBe('normal');
        expect(layout.background).toBe('rgb(21, 93, 233)');
        expect(layout.foreground).toBe('rgb(255, 255, 255)');
        expect(layout.fits).toBe(true);
        expect(layout.described).toBe(true);
        expect(layout.labelled).toBe(true);
        await protection.screenshot({
          path: resolve(UI_SCREENSHOT_DIRECTORY, `passphrase-${language}-${colorScheme}-${width}.png`),
          animations: 'disabled'
        });
      }
    }
  }
  expect(creates + topCreates + refreshes + topRefreshes).toBe(0);
});

test('TOP bundle file import reuses prepared protection and reauthorizes without the legacy console', async () => {
  const tool = await openTool('top');
  await prepareProtection(tool);
  const bundle = {
    ...jsonImports.top,
    application: { ...jsonImports.top.application, ...standalone.top }
  };
  await tool.locator('#file').setInputFiles({
    name: 'credentialInfo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle))
  });
  await confirmToolAction(tool);
  await expect(tool.locator('#status')).toHaveText('授权文件已安全保存');
  await expect(tool.getByRole('dialog')).toHaveCount(0);
  await expect(tool.locator('#protectionSection')).toBeHidden();
  expect(creates + topCreates).toBe(0);
  const oauthEvent = context.waitForEvent('page');
  await tool.locator('#reauthorize').click();
  expect(creates + topCreates).toBe(0);
  await confirmToolAction(tool);
  const oauth = await oauthEvent;
  await oauth.waitForURL(`chrome-extension://${extensionId}/top-approval.html**`);
  const query = new URL(oauth.url()).searchParams;
  expect(query.get('client_id')).toBe(standalone.top.appKey);
  expect(query.get('redirect_uri')).toBe(standalone.top.callbackUrl);
  expect(query.get('sp')).toBe('ICBU');
  await oauth.locator('#approve').click();
  await expect(tool.locator('#status')).toHaveText('授权文件已安全保存', { timeout: 20_000 });
  expect(topCreates).toBe(1);
  expect(creates + refreshes + topRefreshes).toBe(0);
  expect(await exportBundle(tool)).toMatchObject({
    protocol: 'top',
    application: standalone.top,
    oauth: { accessToken: standalone.topToken.access_token }
  });
  expect(context.pages().some((page) => page.url().includes('crosstrade.alibaba.com'))).toBe(false);
});

test('a superseded file read cannot prompt for or replace the latest selected TOP bundle', async () => {
  const tool = await openTool('top');
  await prepareProtection(tool);
  await tool.evaluate(() => {
    // The wrapper below deliberately forwards its File receiver with .call(this).
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = File.prototype.text;
    File.prototype.text = function () {
      return new Promise<string>((resolve, reject) => {
        // Fixture-only delayed reads, released in a controlled order below.
        document.addEventListener(
          `release-file:${this.name}`,
          () => {
            void original.call(this).then((text) => {
              resolve(text);
              queueMicrotask(() => {
                document.documentElement.dataset.completedFileRead = this.name;
              });
            }, reject);
          },
          { once: true }
        );
      });
    };
  });
  const latest = {
    ...jsonImports.top,
    application: { ...jsonImports.top.application, ...standalone.top }
  };
  for (const [name, bundle] of [
    ['earlier.json', jsonImports.top],
    ['latest.json', latest]
  ] as const) {
    await tool.locator('#file').setInputFiles({
      name,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(bundle))
    });
  }
  await tool.evaluate(() => {
    document.dispatchEvent(new Event('release-file:earlier.json'));
  });
  await expect(tool.locator('html')).toHaveAttribute('data-completed-file-read', 'earlier.json');
  await expect(tool.getByRole('dialog')).toHaveCount(0);
  await tool.evaluate(() => {
    document.dispatchEvent(new Event('release-file:latest.json'));
  });
  await confirmToolAction(tool);
  await expect(tool.locator('#status')).toHaveText('授权文件已安全保存');
  await expect(tool.getByRole('dialog')).toHaveCount(0);
  expect(await exportBundle(tool)).toMatchObject(latest);
  expect(creates + topCreates + refreshes + topRefreshes).toBe(0);
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
  for (const operation of ['listVideos', 'uploadPhoto'] as const) {
    const reason = iopOperationReason(operation);
    expect(reason).toBe('ALIBABA_IOP_METHOD_UNSUPPORTED');
    expect(await send('gateway-request', operation)).toMatchObject({
      ok: false,
      error: { code: reason }
    });
  }
  await workbench.reload();
  const restoredSettings = await send('credential-vault-request', 'get-settings');
  expect((restoredSettings as { error?: { code: string } }).error?.code).toBeUndefined();
  expect(restoredSettings).toMatchObject({
    ok: true,
    data: { protocol: 'iop', endpoint: `${PUBLIC_AUTH_ORIGIN}/rest`, appSecret: '', accessToken: '' }
  });
  expect(await send('gateway-request', 'listPhotoGroups')).toMatchObject({ ok: true });
  expect(reads).toBe(2);
  expect(topCalls).toBe(0);
});

for (const [operation, path, wrapper] of [
  ['publishProduct', '/icbu/product/schema/add', 'publish_request'],
  ['saveProductDraft', '/icbu/product/schema/add/draft', 'param_product_top_publish_request'],
  ['updateProduct', '/icbu/product/schema/update', null]
] as const) {
  test(`formal MV3 ${operation} uses verified IOP parameters and confirms fixture readback`, async () => {
    const restoreXml = installNodeXmlDomGlobals();
    try {
      const schemaXml = business.schema.result.data;
      const fingerprints = await createProductMutationFingerprints(schemaXml);
      expect(iopOperationReason(operation)).toBeNull();
      let writes = 0;
      let reads = 0;
      let topCalls = 0;
      await context.route('https://eco.taobao.com/**', async (route) => {
        topCalls++;
        await route.abort();
      });
      await context.route(`${PUBLIC_AUTH_ORIGIN}/rest/**`, async (route) => {
        expect(route.request().method()).toBe('POST');
        const target = new URL(route.request().url()).pathname.slice('/rest'.length);
        const parameters = new URLSearchParams(route.request().postData() ?? '');
        expect(parameters.get('app_key')).toBe(credentials.manual.appKey);
        expect(parameters.get('access_token')).toBe(credentials.manual.accessToken);
        expect(parameters.get('sign_method')).toBe('sha256');
        expect(parameters.has('session')).toBe(false);
        expect(parameters.has('method')).toBe(false);
        const signatureInput = [...parameters.keys()]
          .filter((key) => key !== 'sign')
          .sort()
          .map((key) => key + (parameters.get(key) ?? ''))
          .join('');
        expect(parameters.get('sign')).toBe(
          createHmac('sha256', credentials.manual.appSecret)
            .update(target + signatureInput)
            .digest('hex')
            .toUpperCase()
        );
        if (target === path) {
          writes++;
          const input = wrapper
            ? (JSON.parse(parameters.get(wrapper) ?? '') as Record<string, unknown>)
            : Object.fromEntries(parameters);
          expect(input).toMatchObject({ cat_id: wrapper ? 123 : '123', language: 'en_US', xml: schemaXml });
          expect(input).not.toHaveProperty('version');
          expect(input).not.toHaveProperty('publish_type');
          if (operation === 'updateProduct') {
            expect(input.product_id).toBe('100001');
            expect(parameters.has('param_product_top_publish_request')).toBe(false);
            expect(parameters.has('publish_request')).toBe(false);
          } else {
            expect(Object.keys(input).sort()).toEqual(['cat_id', 'language', 'xml']);
            expect(
              parameters.has(
                wrapper === 'publish_request' ? 'param_product_top_publish_request' : 'publish_request'
              )
            ).toBe(false);
          }
          await route.fulfill({
            json: {
              code: 0,
              result: {
                success: true,
                ...(operation === 'publishProduct' ? { data: 100001 } : { product_id: 100001 }),
                trace_id: 'fixture-schema-write'
              }
            }
          });
        } else if (target === '/alibaba/icbu/product/list' && operation === 'publishProduct') {
          reads++;
          await route.fulfill({ json: business.products });
        } else if (target === '/icbu/product/schema/render/draft' && operation === 'saveProductDraft') {
          reads++;
          expect(Object.fromEntries(parameters)).toMatchObject({
            product_id: '100001',
            cat_id: '123',
            language: 'en_US'
          });
          expect(parameters.has('render_request')).toBe(false);
          await route.fulfill({ json: business.schema });
        } else if (target === '/icbu/product/schema/render' && operation === 'updateProduct') {
          reads++;
          expect(JSON.parse(parameters.get('render_request') ?? '')).toEqual({
            product_id: 100001,
            cat_id: 123,
            language: 'en_US'
          });
          await route.fulfill({ json: business.schema });
        } else {
          await route.abort();
          throw new Error('Unexpected offline Schema request');
        }
      });
      const page = await openWorkbenchSettings();
      expect(
        await sendWorkbench(page, 'credential-vault-request', 'create', {
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
      const contextResponse = await page.evaluate(async () => {
        const api = (
          globalThis as unknown as {
            chrome: { runtime: { sendMessage(value: unknown): Promise<{ ok: boolean; data?: unknown }> } };
          }
        ).chrome;
        return api.runtime.sendMessage({ kind: 'product-operation-context', requestId: crypto.randomUUID() });
      });
      expect(contextResponse.ok).toBe(true);
      const productContext = requireProductOperationContext(contextResponse.data);
      const payload =
        operation === 'updateProduct'
          ? { categoryId: 123, language: 'en_US', productId: '100001', schemaPatchXml: schemaXml }
          : { categoryId: 123, language: 'en_US', schemaXml };
      const extra = {
        productContext,
        ...(operation === 'updateProduct' ? { productMutationFingerprint: fingerprints } : {})
      };
      expect(
        await sendWorkbench(page, 'gateway-request', operation, payload, {
          ...extra,
          productContext: { ...productContext, gateway: 'a'.repeat(64) }
        })
      ).toMatchObject({ ok: false, error: { code: 'PRODUCT_CONTEXT_CHANGED' } });
      expect(writes + reads).toBe(0);
      const response = (await sendWorkbench(page, 'gateway-request', operation, payload, extra)) as {
        ok: boolean;
        data?: { job?: unknown };
      };
      expect(response).toMatchObject({ ok: true, data: { success: true, productId: '100001' } });
      const job = response.data?.job;
      if (!isProductMutationJob(job)) throw new Error('Missing offline Schema receipt');
      expect(job).toMatchObject({ productContext, operation, categoryId: 123, language: 'en_US' });
      expect(JSON.stringify(job)).not.toContain(credentials.manual.accessToken);
      if (operation === 'updateProduct') {
        expect(job.status).toBe('auditing');
        expect(await sendWorkbench(page, 'gateway-request', operation, payload, extra)).toMatchObject({
          ok: false,
          error: { code: 'PRODUCT_MUTATION_ALREADY_IN_PROGRESS' }
        });
        const readback = (await sendWorkbench(page, 'gateway-request', 'renderProductSchema', {
          categoryId: 123,
          language: 'en_US',
          productId: '100001'
        })) as { data?: { xml?: unknown } };
        expect(readback).toMatchObject({ ok: true, data: { xml: schemaXml } });
        expect(
          await sendWorkbench(page, 'product-mutation-job-request', 'complete-update-readback', {
            id: job.id,
            revision: job.revision,
            result: {
              kind: 'comparison',
              comparison: await compareProductMutationFingerprints(
                String(readback.data?.xml),
                job.fieldExpectations
              )
            }
          })
        ).toMatchObject({
          ok: true,
          data: { status: 'verified', reasonCode: 'PRODUCT_MUTATION_READBACK_MATCHED' }
        });
      } else {
        expect(job).toMatchObject({
          status: 'verified',
          reasonCode:
            operation === 'publishProduct'
              ? 'PRODUCT_PUBLISH_READBACK_MATCHED'
              : 'PRODUCT_DRAFT_READBACK_MATCHED'
        });
        expect(await sendWorkbench(page, 'gateway-request', operation, payload, extra)).toMatchObject({
          ok: false,
          error: { code: 'PRODUCT_CREATION_ALREADY_ACCEPTED' }
        });
      }
      expect(writes).toBe(1);
      expect(reads).toBe(1);
      expect(topCalls).toBe(0);
      expect(creates + refreshes).toBe(0);
      await page.reload();
      expect(await sendWorkbench(page, 'product-mutation-job-request', 'get', { id: job.id })).toMatchObject({
        ok: true,
        data: { productContext, status: 'verified' }
      });
      expect(writes).toBe(1);
    } finally {
      restoreXml();
    }
  });
}

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
  await expect(workbench.getByTestId('authorization-profile-editor')).toHaveValue('top');
  await workbench.getByLabel('导入授权包 JSON').setInputFiles({
    name: 'legacy-top.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(credentials.oauthBundle))
  });
  await expect(workbench.getByLabel('App Key')).toHaveValue(credentials.manual.appKey);
  await expect(workbench.getByTestId('authorization-profile-editor')).toHaveValue('top');
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
  await expect(workbench.getByTestId('authorization-profile-editor')).toHaveValue('top');
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
    const iopProfile = workbench.getByTestId('authorization-profile-editor');
    await expect(iopProfile).toBeEnabled();
    await iopProfile.selectOption('iop');
    await expect(iopProfile).toHaveValue('iop');
    await expect(workbench.getByTestId('iop-protocol-notice')).toContainText(
      '已验收的 Schema 发布、存草稿、更新'
    );
    // Acquisition now starts with an explicit TOP/IOP choice instead of a
    // protocol-specific disabled button. The current saved IOP profile stays selected.
    await expect(workbench.getByRole('button', { name: '连接 Alibaba 账号', exact: true })).toBeEnabled();
    const pagesBeforeChoice = context.pages().length;
    await workbench.getByRole('button', { name: '连接 Alibaba 账号', exact: true }).click();
    const choice = workbench.getByRole('dialog', { name: '连接 Alibaba 账号', exact: true });
    await expect(choice).toBeVisible();
    await expect(choice.getByRole('button', { name: /连接新版应用/u })).toBeEnabled();
    await expect(choice.getByRole('button', { name: /连接已有旧版应用/u })).toBeEnabled();
    await choice.getByRole('button', { name: '取消', exact: true }).click();
    await expect(choice).toHaveCount(0);
    expect(context.pages()).toHaveLength(pagesBeforeChoice);
    expect(reads + topCalls + creates + refreshes).toBe(0);
    await expect(iopProfile).toHaveValue('iop');
    expect(await sendWorkbench(workbench, 'credential-vault-request', 'get-settings')).toMatchObject({
      data: { protocol: 'iop', appKey: credentials.manual.appKey }
    });
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
    expect(await sendWorkbench(workbench, 'gateway-request', 'listVideos', {})).toMatchObject({
      ok: false,
      error: { code: 'ALIBABA_IOP_METHOD_UNSUPPORTED' }
    });
    expect(reads).toBe(1);
    expect(topCalls).toBe(0);
    expect(creates + refreshes).toBe(0);
    expect(await sendWorkbench(workbench, 'credential-vault-request', 'get-settings')).toMatchObject({
      data: { protocol: 'iop' }
    });
  });
}
