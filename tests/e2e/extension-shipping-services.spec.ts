import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { completeOnboarding, ONBOARDING_STORAGE_KEY } from '../../packages/core/src/privacy';
import type { ShippingServicesStoredState } from '../../apps/extension/lib/shipping-services-service';
import requestFixture from '../../mock/data/shipping-services/cn-export-request.json' with { type: 'json' };
import providerFixture from '../../mock/data/shipping-services/freightos-estimate.json' with { type: 'json' };

// Main builds first. Run: pnpm exec playwright test tests/e2e/extension-shipping-services.spec.ts --workers=1
// No AppServices injection: only native permission decisions and fetch are fixture-backed in this profile.
const STORAGE_KEY = 'one-vegetable-shipping-services-v1';
const HOST = 'https://ship.freightos.com/*';
const ENDPOINT = 'https://ship.freightos.com/api/rate-estimate/v1/search';
const API_KEY = 'fixture-freightos-key-never-live';
interface PermissionQuery {
  origins?: string[];
  permissions?: string[];
}
interface TestChrome {
  runtime: { sendMessage(value: unknown): Promise<unknown> };
  permissions: {
    contains(query: PermissionQuery): Promise<boolean>;
    request(query: PermissionQuery): Promise<boolean>;
  };
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
}
interface TransportFixture {
  granted: boolean;
  behavior: 'success' | 'unknown' | 'hold';
  checks: string[][];
  calls: { url: string; requestId: string | null; claimed: boolean; keyMatches: boolean }[];
}
interface PageFixture {
  allowed: boolean;
  permissions: { origins: string[]; active: boolean }[];
  messages: { action: string; requestId: string }[];
  responses: { action: string; code: string | null }[];
}
declare const chrome: TestChrome;

function invoke(page: Page, input: Record<string, unknown>): Promise<unknown> {
  return page.evaluate((value) => chrome.runtime.sendMessage(value), {
    kind: 'shipping-services-request',
    provider: 'freightos',
    requestId: randomUUID(),
    ...input
  });
}
function quote(expectedRevision = 1) {
  return { ...requestFixture, requestId: randomUUID(), expectedRevision, action: 'quote' };
}
function save(expectedRevision: number | null = null) {
  return { action: 'save', apiKey: API_KEY, expectedRevision, termsAccepted: true, costAcknowledged: true };
}
function readState(page: Page): Promise<ShippingServicesStoredState | undefined> {
  return page.evaluate(
    async (key) => (await chrome.storage.local.get(key))[key] as ShippingServicesStoredState | undefined,
    STORAGE_KEY
  );
}
function transportState(worker: Worker): Promise<TransportFixture> {
  return worker.evaluate(
    () => (globalThis as unknown as { shippingTransportFixture: TransportFixture }).shippingTransportFixture
  );
}
function pageState(page: Page): Promise<PageFixture> {
  return page.evaluate(
    () => (globalThis as unknown as { shippingPageFixture: PageFixture }).shippingPageFixture
  );
}

async function installTransport(worker: Worker): Promise<void> {
  await worker.evaluate(
    ({ host, endpoint, key, apiKey, response }) => {
      const target = globalThis as unknown as {
        chrome: TestChrome;
        fetch: typeof fetch;
        shippingTransportFixture: TransportFixture;
      };
      const fixture: TransportFixture = { granted: false, behavior: 'success', checks: [], calls: [] };
      target.shippingTransportFixture = fixture;
      const contains = target.chrome.permissions.contains.bind(target.chrome.permissions);
      target.chrome.permissions.contains = (query) => {
        if (!query.origins?.includes(host)) return contains(query);
        fixture.checks.push([...query.origins]);
        return Promise.resolve(fixture.granted && query.origins.length === 1 && !query.permissions?.length);
      };
      // Intentionally no native-fetch fallback: even a bad endpoint cannot leave this worker.
      target.fetch = async (input, init) => {
        const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        if (url !== endpoint || init?.method !== 'POST') throw new Error('Unexpected fixture dispatch');
        const headers = new Headers(init.headers);
        const requestId = headers.get('X-Request-ID');
        const state = (await target.chrome.storage.local.get(key))[key] as ShippingServicesStoredState;
        fixture.calls.push({
          url,
          requestId,
          keyMatches: headers.get('apiKey') === apiKey,
          claimed: state.claims.some(
            (claim) => claim.requestId === requestId && claim.completedAtUtc === null
          )
        });
        if (fixture.behavior === 'unknown') throw new Error('Fixture unknown outcome');
        if (fixture.behavior === 'hold')
          return new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener(
              'abort',
              () => {
                reject(new Error('Fixture deadline'));
              },
              { once: true }
            );
          });
        return Response.json(response);
      };
    },
    { host: HOST, endpoint: ENDPOINT, key: STORAGE_KEY, apiKey: API_KEY, response: providerFixture }
  );
}

async function allow(worker: Worker, page?: Page): Promise<void> {
  await worker.evaluate(() => {
    (
      globalThis as unknown as { shippingTransportFixture: TransportFixture }
    ).shippingTransportFixture.granted = true;
  });
  if (page)
    await page.evaluate(() => {
      (globalThis as unknown as { shippingPageFixture: PageFixture }).shippingPageFixture.allowed = true;
    });
}

async function launch() {
  const profile = await mkdtemp(resolve(tmpdir(), 'one-vegetable-shipping-mv3-'));
  const extension = resolve(import.meta.dirname, '../../apps/extension/.output/chrome-mv3');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    args: [
      '--disable-extensions-except=' + extension,
      '--load-extension=' + extension,
      '--host-resolver-rules=MAP ship.freightos.com ~NOTFOUND, MAP public-api.easyship.com ~NOTFOUND'
    ]
  });
  try {
    await context.setOffline(true);
    await context.route(/^https?:\/\//u, (route) => route.abort());
    const providerNetwork: string[] = [];
    context.on('request', (request) => {
      if (new URL(request.url()).hostname === 'ship.freightos.com') providerNetwork.push(request.url());
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await installTransport(worker);
    await worker.evaluate(
      async ({ key, onboarding }) => {
        await chrome.storage.local.set({ [key]: onboarding });
      },
      { key: ONBOARDING_STORAGE_KEY, onboarding: completeOnboarding() }
    );
    const page = await context.newPage();
    await page.addInitScript(
      ({ key, onboarding }) => {
        if (location.protocol !== 'chrome-extension:' || location.pathname !== '/options.html') return;
        localStorage.setItem(key, JSON.stringify(onboarding));
        const target = globalThis as unknown as { chrome: TestChrome; shippingPageFixture: PageFixture };
        const fixture: PageFixture = { allowed: false, permissions: [], messages: [], responses: [] };
        target.shippingPageFixture = fixture;
        target.chrome.permissions.request = (query) => {
          fixture.permissions.push({
            origins: query.origins ?? [],
            active: navigator.userActivation.isActive
          });
          return Promise.resolve(
            fixture.allowed &&
              query.origins?.length === 1 &&
              query.origins[0] === 'https://ship.freightos.com/*' &&
              !query.permissions?.length
          );
        };
        const send = target.chrome.runtime.sendMessage.bind(target.chrome.runtime);
        target.chrome.runtime.sendMessage = (value) => {
          if (
            value &&
            typeof value === 'object' &&
            'kind' in value &&
            value.kind === 'shipping-services-request' &&
            'action' in value &&
            typeof value.action === 'string' &&
            'requestId' in value &&
            typeof value.requestId === 'string'
          )
            fixture.messages.push({ action: value.action, requestId: value.requestId });
          return send(value).then((response) => {
            if (
              value &&
              typeof value === 'object' &&
              'kind' in value &&
              value.kind === 'shipping-services-request' &&
              'action' in value &&
              typeof value.action === 'string'
            ) {
              const error =
                response && typeof response === 'object' && 'error' in response ? response.error : null;
              fixture.responses.push({
                action: value.action,
                code:
                  error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
                    ? error.code
                    : null
              });
            }
            return response;
          });
        };
      },
      { key: ONBOARDING_STORAGE_KEY, onboarding: completeOnboarding() }
    );
    const origin = 'chrome-extension://' + new URL(worker.url()).host;
    await page.goto(origin + '/options.html#/logistics');
    await page.getByRole('button', { name: '物流服务', exact: true }).click();
    await expect(page.getByTestId('shipping-services-workspace')).toBeVisible();
    return { context, page, worker, origin, providerNetwork };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function restart(context: BrowserContext, page: Page, worker: Worker): Promise<Worker> {
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('ServiceWorker.enable');
    const closed = new Promise<void>((resolve) => {
      worker.once('close', () => {
        resolve();
      });
    });
    await cdp.send('ServiceWorker.stopAllWorkers');
    await closed;
    const replacement = context.waitForEvent(
      'serviceworker',
      (candidate) => candidate.url() === worker.url()
    );
    // A local summary wakes the real packaged listener without making a provider request.
    const summary = invoke(page, { action: 'configuration' });
    const next = await replacement;
    await installTransport(next);
    await allow(next);
    expect(await summary).toMatchObject({ ok: true, data: { configured: true, revision: 1 } });
    return next;
  } finally {
    await cdp.detach();
  }
}

async function fillShipment(page: Page): Promise<void> {
  const shipment = requestFixture.shipment;
  await page.getByTestId('shipping-mode').selectOption('lcl');
  for (const [name, value] of Object.entries({
    originProvince: shipment.origin.state,
    originCity: shipment.origin.city,
    originPostal: shipment.origin.postalCode,
    destinationCountry: shipment.destination.countryCode,
    destinationProvince: shipment.destination.state,
    destinationCity: shipment.destination.city,
    destinationPostal: shipment.destination.postalCode,
    quantity: String(shipment.quantity),
    weightKg: String(shipment.weightKg),
    lengthCm: String(shipment.lengthCm),
    widthCm: String(shipment.widthCm),
    heightCm: String(shipment.heightCm),
    declaredValue: String(shipment.declaredValue)
  }))
    await page.getByTestId('shipping-' + name).fill(value);
}
async function sendFromUi(page: Page): Promise<void> {
  await page.getByTestId('shipping-review').click();
  await page.getByTestId('shipping-quote-data').check();
  await page.getByTestId('shipping-quote-cost').check();
  await page.getByTestId('shipping-send').click();
}

test('formal MV3 shipping: exact-host denial, real options/SW wiring, trusted senders, restart and durable attempt ceiling', async () => {
  test.setTimeout(120_000);
  const h = await launch();
  let worker = h.worker;
  try {
    expect((await pageState(h.page)).permissions).toEqual([]);
    expect((await transportState(worker)).calls).toEqual([]);
    await h.page.getByTestId('shipping-configure').click();
    await h.page.getByTestId('shipping-api-key').fill(API_KEY);
    await h.page.getByTestId('shipping-config-terms').check();
    await h.page.getByTestId('shipping-config-cost').check();
    await h.page.getByTestId('shipping-save').click();
    await expect(h.page.getByRole('alert')).toBeVisible();
    expect((await pageState(h.page)).permissions).toEqual([{ origins: [HOST], active: true }]);
    expect((await pageState(h.page)).messages.map((message) => message.action)).toEqual(['configuration']);
    expect(await readState(h.page)).toBeUndefined();
    expect((await transportState(worker)).calls).toEqual([]);
    await allow(worker, h.page);
    await h.page.getByTestId('shipping-save').click();
    await expect(h.page.getByTestId('shipping-api-key')).toHaveValue('');
    await h.page.getByRole('dialog').getByRole('button', { name: '关闭详情', exact: true }).click();
    await fillShipment(h.page);
    await worker.evaluate(() => {
      (
        globalThis as unknown as { shippingTransportFixture: TransportFixture }
      ).shippingTransportFixture.granted = false;
    });
    await sendFromUi(h.page);
    await expect
      .poll(
        async () =>
          (await pageState(h.page)).responses.filter((response) => response.action === 'quote').at(-1)?.code
      )
      .toBe('SHIPPING_PERMISSION_REQUIRED');
    expect((await transportState(worker)).calls).toEqual([]);
    expect((await readState(h.page))?.claims).toEqual([]);
    await allow(worker);
    await sendFromUi(h.page);
    await expect(h.page.getByTestId('shipping-results')).toContainText('USD 394.43');
    const firstId = (await pageState(h.page)).messages
      .filter((message) => message.action === 'quote')
      .at(-1)?.requestId;
    expect(firstId).toBeTruthy();
    expect((await transportState(worker)).calls).toEqual([
      { url: ENDPOINT, requestId: firstId, claimed: true, keyMatches: true }
    ]);
    expect(
      (await transportState(worker)).checks.every(
        (origins) => JSON.stringify(origins) === JSON.stringify([HOST])
      )
    ).toBe(true);
    expect(
      (await pageState(h.page)).permissions.every(
        (entry) => entry.active && JSON.stringify(entry.origins) === JSON.stringify([HOST])
      )
    ).toBe(true);

    const popup = await h.context.newPage();
    await popup.goto(h.origin + '/popup.html');
    expect(await invoke(popup, quote())).toMatchObject({
      ok: false,
      error: { code: 'SHIPPING_UNTRUSTED_SENDER' }
    });
    const contentUrl = 'https://eco.taobao.com/one-vegetable-shipping-fixture';
    await h.context.route(contentUrl, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Offline sender fixture</title>' })
    );
    const contentPage = await h.context.newPage();
    await contentPage.goto(contentUrl);
    const contentResult = await worker.evaluate(
      async ({ url, message }) => {
        const api = (
          globalThis as unknown as {
            chrome: {
              tabs: { query(input: { url: string }): Promise<{ id?: number }[]> };
              scripting: {
                executeScript(input: {
                  target: { tabId: number };
                  func: (message: Record<string, unknown>) => Promise<unknown>;
                  args: [Record<string, unknown>];
                }): Promise<{ result?: unknown }[]>;
              };
            };
          }
        ).chrome;
        const tab = (await api.tabs.query({ url }))[0];
        if (tab?.id === undefined) throw new Error('Missing offline content-script tab');
        return (
          await api.scripting.executeScript({
            target: { tabId: tab.id },
            func: (value) => chrome.runtime.sendMessage(value),
            args: [message]
          })
        )[0]?.result;
      },
      { url: contentUrl, message: { kind: 'shipping-services-request', ...quote() } }
    );
    expect(contentResult).toMatchObject({ ok: false, error: { code: 'SHIPPING_UNTRUSTED_SENDER' } });
    expect((await transportState(worker)).calls).toHaveLength(1);

    worker = await restart(h.context, h.page, worker);
    expect(await invoke(h.page, { ...quote(), requestId: firstId })).toMatchObject({
      error: { code: 'SHIPPING_QUOTE_ALREADY_SENT' }
    });
    expect((await transportState(worker)).calls).toEqual([]);
    expect(await invoke(h.page, quote())).toMatchObject({
      ok: true,
      data: { options: [{ kind: 'market-estimate', amount: '394.43', currency: 'USD' }] }
    });
    await worker.evaluate(() => {
      (
        globalThis as unknown as { shippingTransportFixture: TransportFixture }
      ).shippingTransportFixture.behavior = 'unknown';
    });
    const unknown = quote();
    expect(await invoke(h.page, unknown)).toMatchObject({
      error: { code: 'SHIPPING_QUOTE_OUTCOME_UNKNOWN' }
    });
    expect(await invoke(h.page, unknown)).toMatchObject({ error: { code: 'SHIPPING_QUOTE_ALREADY_SENT' } });
    await worker.evaluate(() => {
      (
        globalThis as unknown as { shippingTransportFixture: TransportFixture }
      ).shippingTransportFixture.behavior = 'success';
    });
    for (let index = 0; index < 7; index++) expect(await invoke(h.page, quote())).toMatchObject({ ok: true });
    expect((await readState(h.page))?.claims).toHaveLength(10);
    expect(await invoke(h.page, { action: 'clear', expectedRevision: 1 })).toMatchObject({ ok: true });
    expect((await readState(h.page))?.claims).toHaveLength(10);
    expect(await invoke(h.page, save())).toMatchObject({ ok: true, data: { revision: 2 } });
    expect(await invoke(h.page, quote(2))).toMatchObject({ error: { code: 'SHIPPING_LOCAL_DAILY_LIMIT' } });
    expect((await transportState(worker)).calls).toHaveLength(9);
    const stored = JSON.stringify(await readState(h.page));
    for (const value of [API_KEY, 'Shenzhen', 'Los Angeles', '394.43', providerFixture.requestId])
      expect(stored).not.toContain(value);
    expect(h.providerNetwork).toEqual([]);
  } finally {
    await h.context.close();
  }
});

test('formal MV3 crash keeps its ID claimed but releases other manual IDs after a bounded serial lease', async () => {
  test.setTimeout(120_000);
  const h = await launch();
  let worker = h.worker;
  try {
    await allow(worker);
    expect(await invoke(h.page, save())).toMatchObject({ ok: true });
    await worker.evaluate(() => {
      (
        globalThis as unknown as { shippingTransportFixture: TransportFixture }
      ).shippingTransportFixture.behavior = 'hold';
    });
    const crashed = quote();
    await h.page.evaluate(
      (message) => {
        // Keep the message pending while CDP kills its worker; handle the expected closed-port rejection.
        void chrome.runtime.sendMessage(message).catch(() => undefined);
      },
      { kind: 'shipping-services-request', ...crashed }
    );
    await expect.poll(async () => (await transportState(worker)).calls.length).toBe(1);
    expect((await readState(h.page))?.claims).toMatchObject([
      { requestId: crashed.requestId, completedAtUtc: null }
    ]);
    worker = await restart(h.context, h.page, worker);
    expect(await invoke(h.page, crashed)).toMatchObject({ error: { code: 'SHIPPING_QUOTE_ALREADY_SENT' } });
    expect(await invoke(h.page, quote())).toMatchObject({ error: { code: 'SHIPPING_QUOTE_IN_PROGRESS' } });
    // Advance persisted lease metadata instead of sleeping 60s; leave ciphertext and IDs untouched.
    await h.page.evaluate(async (key) => {
      const state = (await chrome.storage.local.get(key))[key] as ShippingServicesStoredState;
      await chrome.storage.local.set({
        [key]: {
          ...state,
          claims: state.claims.map((claim) => ({ ...claim, attemptedAtUtc: Date.now() - 60_001 }))
        }
      });
    }, STORAGE_KEY);
    expect(await invoke(h.page, quote())).toMatchObject({ ok: true });
    expect(await invoke(h.page, crashed)).toMatchObject({ error: { code: 'SHIPPING_QUOTE_ALREADY_SENT' } });
    expect((await readState(h.page))?.claims).toHaveLength(2);
    expect((await transportState(worker)).calls).toHaveLength(1);
    expect(h.providerNetwork).toEqual([]);
  } finally {
    await h.context.close();
  }
});
