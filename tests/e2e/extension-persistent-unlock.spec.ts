import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import fixture from '../../mock/data/node-gateway-credentials.json' with { type: 'json' };

test('remembers unlock across browser restarts until manually locked', async () => {
  test.setTimeout(120_000);
  const profile = await mkdtemp(resolve(tmpdir(), 'one-vegetable-unlock-'));
  const extension = resolve(import.meta.dirname, '../../apps/extension/.output/chrome-mv3');
  let context: BrowserContext | undefined;
  async function launch(): Promise<Page> {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      locale: 'zh-CN',
      args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension]
    });
    await context.route(/^https?:\/\//u, (route) => route.abort());
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const page = await context.newPage();
    await page.goto('chrome-extension://' + new URL(worker.url()).host + '/options.html#/settings');
    return page;
  }
  function invoke(page: Page, operation: string, payload?: unknown) {
    return page.evaluate(
      async (input) => {
        const runtime = (
          globalThis as unknown as {
            chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
          }
        ).chrome.runtime;
        return runtime.sendMessage({
          requestId: crypto.randomUUID(),
          kind: 'credential-vault-request',
          ...input
        });
      },
      { operation, payload }
    );
  }
  async function authorization(page: Page, protocol: 'top' | 'iop', action: 'import' | 'status') {
    // URL.origin for extension URLs may be null; retain the known extension host.
    const base = 'chrome-extension://' + new URL(page.url()).host;
    await page.goto(base + '/authorization.html?protocol=' + protocol);
    const result = await page.evaluate(
      async (input) => {
        return (
          globalThis as unknown as {
            chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
          }
        ).chrome.runtime.sendMessage({
          kind: 'iop-authorization-request',
          requestId: crypto.randomUUID(),
          ...input
        });
      },
      {
        protocol,
        action,
        payload:
          action === 'import'
            ? {
                bundle: { ...fixture.oauthBundle, protocol },
                passphrase: fixture.workbench.password
              }
            : {}
      }
    );
    await page.goto(base + '/options.html#/settings');
    return result;
  }
  try {
    let page = await launch();
    expect(
      await invoke(page, 'create', {
        passphrase: fixture.workbench.password,
        settings: {
          appKey: fixture.manual.appKey,
          appSecret: fixture.manual.appSecret,
          accessToken: fixture.manual.accessToken,
          endpoint: 'https://eco.taobao.com/router/rest',
          signMethod: 'hmac'
        }
      })
    ).toMatchObject({ ok: true, data: { state: 'unlocked' } });
    expect(await invoke(page, 'update-policy', { idleTimeoutMinutes: 5 })).toMatchObject({
      ok: true,
      data: { idleTimeoutMinutes: 0 }
    });
    await context?.close();
    page = await launch();
    expect(await invoke(page, 'status')).toMatchObject({
      ok: true,
      data: { state: 'unlocked', hasAccessToken: true, idleTimeoutMinutes: 0 }
    });
    for (const protocol of ['top', 'iop'] as const) {
      expect(await authorization(page, protocol, 'import')).toMatchObject({
        ok: true,
        data: { state: 'ready' }
      });
    }
    await context?.close();
    page = await launch();
    for (const protocol of ['top', 'iop'] as const) {
      expect(await authorization(page, protocol, 'status')).toMatchObject({
        ok: true,
        data: { state: 'ready' }
      });
    }
    expect(await invoke(page, 'lock')).toMatchObject({ ok: true, data: { state: 'locked' } });
    await context?.close();
    page = await launch();
    expect(await invoke(page, 'status')).toMatchObject({
      ok: true,
      data: { state: 'locked', lockReason: 'manual' }
    });
    for (const protocol of ['top', 'iop'] as const) {
      expect(await authorization(page, protocol, 'status')).toMatchObject({
        ok: true,
        data: { state: 'locked' }
      });
    }
    expect(await invoke(page, 'unlock', { passphrase: fixture.workbench.password })).toMatchObject({
      ok: true,
      data: { state: 'unlocked' }
    });
    await context?.close();
    page = await launch();
    expect(await invoke(page, 'status')).toMatchObject({ ok: true, data: { state: 'unlocked' } });
  } finally {
    await context?.close();
  }
});
