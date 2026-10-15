import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import scenarios from '../../mock/data/alibaba-auth/developer-page-scenarios.json' with { type: 'json' };
import { inspectAlibabaDeveloperPageDocument } from '../../packages/core/src/alibaba-developer-page-inspection';

interface TestChrome {
  storage: {
    local: {
      setAccessLevel(value: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
      get(key: string): Promise<Record<string, unknown>>;
    };
  };
  scripting: { executeScript(value: { target: { tabId: number }; files: string[] }): Promise<unknown> };
  tabs: {
    query(value: { url: string }): Promise<{ id?: number }[]>;
    sendMessage(tabId: number, value: unknown): Promise<unknown>;
  };
}

test('formal MV3 guide works with trusted-only storage and detects current Review Approved', async () => {
  const extensionPath = resolve(import.meta.dirname, '../../apps/extension/.output/chrome-mv3');
  const profile = await mkdtemp(resolve(tmpdir(), 'one-vegetable-guide-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    locale: 'en-US',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  try {
    await context.route(/^https?:\/\//u, (route) => route.abort());
    const url = 'https://eco.taobao.com/one-vegetable-guide-test';
    await context.route(url, (route) =>
      route.fulfill({ contentType: 'text/html', body: scenarios.reviewApproved.html })
    );
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    expect(await page.evaluate(inspectAlibabaDeveloperPageDocument)).toEqual({
      kind: 'registration-approved'
    });
    const tabId = await worker.evaluate(async (targetUrl) => {
      const chrome = (globalThis as unknown as { chrome: TestChrome }).chrome;
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      const tab = (await chrome.tabs.query({ url: targetUrl }))[0];
      if (tab?.id === undefined) throw new Error('Missing guide fixture tab');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['/alibaba-developer-guide.js']
      });
      return tab.id;
    }, url);
    await worker.evaluate(async (id) => {
      const chrome = (globalThis as unknown as { chrome: TestChrome }).chrome;
      await chrome.tabs.sendMessage(id, {
        kind: 'one-vegetable-alibaba-developer-guide-update',
        uiLocale: 'zh-CN',
        state: {
          status: 'prerequisite-required',
          reasonCode: 'developer-registration-under-review',
          checkedAtUtc: Date.now()
        }
      });
    }, tabId);
    const guide = page.locator('#one-vegetable-alibaba-developer-guide');
    await expect(guide.getByRole('heading', { name: '注册资料正在审核' })).toBeVisible();
    await expect(guide.getByRole('button', { name: '重新检查', exact: true })).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => {
            resolve();
          })
        )
    );
    expect(errors).toEqual([]);
    await worker.evaluate(async (id) => {
      const chrome = (globalThis as unknown as { chrome: TestChrome }).chrome;
      await chrome.tabs.sendMessage(id, { kind: 'one-vegetable-alibaba-developer-guide-remove' });
    }, tabId);
    await expect(guide).toHaveCount(0);
  } finally {
    await context.close();
  }
});
