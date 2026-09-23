import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import credentialFixture from '../../mock/data/node-gateway-credentials.json' with { type: 'json' };
import { createCredentialVault } from '../../packages/core/src/credential-vault';
import { completeOnboarding, ONBOARDING_STORAGE_KEY } from '../../packages/core/src/privacy';
import { SETTINGS_STORAGE_KEY } from '../../packages/core/src/settings-storage';
import {
  EXTENSION_REVIEW_PROMPT_INTERVAL_MILLISECONDS,
  EXTENSION_REVIEW_PROMPT_STORAGE_KEY
} from '../../packages/core/src/extension-review-prompt';

const passphrase = 'startup-e2e-local-passphrase';
const unlockTitle = '解锁开放平台凭据';
const legacyKey = 'one-vegetable-product-schema-draft';
let context: BrowserContext;
let extensionOrigin: string;

interface TestChrome {
  storage: {
    local: {
      set(value: Record<string, unknown>): Promise<void>;
      get(key: null): Promise<Record<string, unknown>>;
    };
    session: { get(key: null): Promise<Record<string, unknown>> };
  };
  runtime: { sendMessage(value: unknown): Promise<unknown> };
}

test.setTimeout(90_000);
test.beforeEach(async () => {
  // Use only the formal build supplied by the main process, never a dev/HMR bundle.
  const extensionPath = resolve(import.meta.dirname, '../../apps/extension/.output/chrome-mv3');
  const profile = await mkdtemp(resolve(tmpdir(), 'one-vegetable-startup-e2e-'));
  context = await chromium.launchPersistentContext(profile, {
    headless: false,
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  // No real platform requests are allowed, even if a query is invalidated on unlock.
  await context.route(/^https?:\/\//u, (route) => route.abort());
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
});
test.afterEach(async () => {
  await context.close();
});

async function boot(
  options: { onboarding?: boolean; legacy?: boolean; reviewDue?: boolean } = {}
): Promise<Page> {
  const created = await createCredentialVault(
    {
      appKey: credentialFixture.manual.appKey,
      appSecret: credentialFixture.manual.appSecret,
      accessToken: credentialFixture.manual.accessToken,
      endpoint: 'https://eco.taobao.com/router/rest',
      signMethod: 'hmac'
    },
    passphrase
  );
  const now = Date.now();
  const stored: Record<string, unknown> = {
    [SETTINGS_STORAGE_KEY]: created.record,
    ...(options.onboarding === false ? {} : { [ONBOARDING_STORAGE_KEY]: completeOnboarding() }),
    ...(options.reviewDue
      ? {
          [EXTENSION_REVIEW_PROMPT_STORAGE_KEY]: {
            schemaVersion: 1,
            firstSeenTimeUtc: now - EXTENSION_REVIEW_PROMPT_INTERVAL_MILLISECONDS * 2,
            lastPromptTimeUtc: null,
            reviewLinkOpenedTimeUtc: null
          }
        }
      : {})
  };
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(async (values) => {
    const chrome = (globalThis as unknown as { chrome: TestChrome }).chrome;
    await chrome.storage.local.set(values);
  }, stored);
  if (options.legacy) {
    await context.addInitScript((key) => {
      if (!sessionStorage.getItem('startup-e2e-legacy-seeded')) {
        localStorage.setItem(key, 'legacy-editor-sentinel');
        sessionStorage.setItem('startup-e2e-legacy-seeded', 'true');
      }
    }, legacyKey);
  }
  const page = await context.newPage();
  await page.goto(`${extensionOrigin}/options.html#/settings`);
  return page;
}

async function unlock(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: unlockTitle, exact: true });
  await dialog.getByLabel('凭据保险库口令', { exact: true }).fill(passphrase);
  await dialog.getByRole('button', { name: '解锁', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('onboarding precedes unlock; Later, X, Escape and backdrop never trap the locked workbench', async () => {
  const page = await boot({ onboarding: false });
  const guide = page.getByRole('dialog', { name: '四步连接 Alibaba 开放平台' });
  await expect(guide).toBeVisible();
  const dialog = page.getByRole('dialog', { name: unlockTitle, exact: true });
  await expect(dialog).toBeHidden();
  await guide.getByRole('checkbox').check();
  await guide.getByRole('button', { name: '稍后，仅浏览' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('不是 Alibaba 网站密码');
  await dialog.getByRole('button', { name: '稍后解锁', exact: true }).click();
  await page.getByRole('link', { name: '版本更新', exact: true }).click();
  await expect(page).toHaveURL(/#\/releases$/u);
  await expect(dialog).toBeHidden();
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await expect(page.getByText('已锁定', { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();

  for (const dismiss of ['close', 'escape', 'backdrop'] as const) {
    await page.reload();
    await expect(dialog).toBeVisible();
    if (dismiss === 'close')
      await dialog.getByRole('button', { name: `关闭${unlockTitle}`, exact: true }).click();
    else if (dismiss === 'escape') await page.keyboard.press('Escape');
    else await page.mouse.click(6, 6);
    await expect(dialog).toBeHidden();
    await expect(page.getByText('已锁定', { exact: true })).toBeVisible();
  }
});

test('wrong password stays local; unlock proceeds directly to review and survives reload/worker restart', async () => {
  const page = await boot({ legacy: true, reviewDue: true });
  const dialog = page.getByRole('dialog', { name: unlockTitle, exact: true });
  const cleanup = page.getByRole('dialog', { name: '清理旧版本地编辑草稿？' });
  const review = page.getByRole('dialog', { name: '用得不错？赏个评价。' });
  await expect(dialog).toBeVisible();
  await expect(cleanup).toBeHidden();
  await expect(review).toBeHidden();
  await dialog.getByLabel('凭据保险库口令', { exact: true }).fill('incorrect-local-passphrase');
  await dialog.getByRole('button', { name: '解锁', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('解锁失败');
  await expect(dialog.getByLabel('凭据保险库口令', { exact: true })).toHaveValue('');
  await expect(cleanup).toBeHidden();
  await unlock(page);
  await expect(cleanup).toBeHidden();
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: '以后再说', exact: true }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), legacyKey)).toBe('legacy-editor-sentinel');
  expect(
    await page.evaluate(() => localStorage.getItem('one-vegetable:legacy-editor-drafts:notice:v1'))
  ).toBeNull();
  await page.reload();
  await expect(page.getByLabel('App Key', { exact: true })).toHaveValue(credentialFixture.manual.appKey);
  await expect(dialog).toBeHidden();
  await expect(cleanup).toBeHidden();
  await expect(review).toBeHidden();

  const cdp = await context.newCDPSession(page);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const target = targetInfos.find(
    (value) => value.type === 'service_worker' && value.url.startsWith(extensionOrigin)
  );
  expect(target).toBeDefined();
  if (!target) throw new Error('Formal extension worker is missing');
  await cdp.send('Target.closeTarget', { targetId: target.targetId });
  const status = await page.evaluate(async () => {
    const chrome = (globalThis as unknown as { chrome: TestChrome }).chrome;
    return chrome.runtime.sendMessage({
      kind: 'credential-vault-request',
      requestId: crypto.randomUUID(),
      operation: 'status'
    });
  });
  expect(status).toMatchObject({ ok: true, data: { state: 'unlocked' } });
  await page.reload();
  await expect(page.getByLabel('App Key', { exact: true })).toHaveValue(credentialFixture.manual.appKey);
  await expect(dialog).toBeHidden();
  const persisted = await page.evaluate(async () => {
    const chrome = (globalThis as unknown as { chrome: TestChrome }).chrome;
    return { local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) };
  });
  for (const secret of [
    passphrase,
    credentialFixture.manual.appSecret,
    credentialFixture.manual.accessToken
  ]) {
    expect(JSON.stringify(persisted)).not.toContain(secret);
  }
});

test('a second workbench unlocking closes the first startup prompt on focus without another password', async () => {
  const first = await boot();
  await expect(first.getByRole('dialog', { name: unlockTitle, exact: true })).toBeVisible();
  // Playwright otherwise emulates permanent focus for every page. Disable that
  // test override so activating another tab produces real blur/focus events.
  const firstCdp = await context.newCDPSession(first);
  await firstCdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await first.evaluate(() => {
    document.documentElement.dataset.e2eFocusCount = '0';
    window.addEventListener('focus', () => {
      const root = document.documentElement;
      root.dataset.e2eFocusCount = String(Number(root.dataset.e2eFocusCount) + 1);
    });
  });
  const second = await context.newPage();
  await second.goto(`${extensionOrigin}/options.html#/settings`);
  const secondCdp = await context.newCDPSession(second);
  await secondCdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await unlock(second);
  await first.bringToFront();
  try {
    await expect(first.getByRole('dialog', { name: unlockTitle, exact: true })).toBeHidden();
  } catch (error: unknown) {
    const diagnostics = await first.evaluate(async () => {
      const chrome = (globalThis as unknown as { chrome: TestChrome }).chrome;
      const result: unknown = await chrome.runtime.sendMessage({
        kind: 'credential-vault-request',
        requestId: crypto.randomUUID(),
        operation: 'status'
      });
      const data = result && typeof result === 'object' && 'data' in result ? result.data : null;
      const state = data && typeof data === 'object' && 'state' in data ? data.state : null;
      return {
        focused: document.hasFocus(),
        visibility: document.visibilityState,
        focusEvents: Number(document.documentElement.dataset.e2eFocusCount),
        vaultState: state
      };
    });
    await test.info().attach('cross-tab-unlock-state', {
      body: JSON.stringify(diagnostics),
      contentType: 'application/json'
    });
    console.info('Cross-tab unlock focus diagnostics:', diagnostics);
    throw error;
  }
  expect(await first.evaluate(() => Number(document.documentElement.dataset.e2eFocusCount))).toBeGreaterThan(
    0
  );
  await first.reload();
  await expect(first.getByLabel('App Key', { exact: true })).toHaveValue(credentialFixture.manual.appKey);
  await expect(first.getByRole('dialog', { name: unlockTitle, exact: true })).toBeHidden();
});
