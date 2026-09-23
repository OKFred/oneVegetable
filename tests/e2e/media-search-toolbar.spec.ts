import { expect, test, type Page } from '@playwright/test';
import { expectTwoRowToolbar } from './helpers/list-toolbar';

interface ReadCall {
  operation: string;
  payload: unknown;
}

async function observeMockReads(page: Page): Promise<void> {
  await page.evaluate(() => {
    function object(value: unknown): Record<PropertyKey, unknown> {
      if (!value || typeof value !== 'object') throw new Error('Missing mock test host');
      return value as Record<PropertyKey, unknown>;
    }
    const root = document.querySelector('#app');
    const app = object(root && Reflect.get(root, '__vue_app__'));
    const provides = object(object(app._instance).provides);
    const key = Reflect.ownKeys(provides).find(
      (entry) => typeof entry === 'symbol' && entry.description === 'one-vegetable-services'
    );
    if (!key) throw new Error('Mock services not mounted');
    const services = object(provides[key]);
    if (services.mode !== 'mock') throw new Error('Media toolbar regression requires Mock mode');
    const gateway = object(services.gateway);
    if (typeof gateway.request !== 'function') throw new Error('Mock request unavailable');
    const original = gateway.request as (...args: unknown[]) => unknown;
    const calls: { operation: string; payload: unknown }[] = [];
    Reflect.set(globalThis, '__oneVegetableMediaSearchCalls', calls);
    gateway.request = (...args: unknown[]) => {
      if (typeof args[0] === 'string') calls.push({ operation: args[0], payload: structuredClone(args[1]) });
      return original.apply(gateway, args);
    };
  });
}

async function readCalls(page: Page): Promise<ReadCall[]> {
  return page.evaluate(
    () =>
      (globalThis as unknown as { __oneVegetableMediaSearchCalls: ReadCall[] }).__oneVegetableMediaSearchCalls
  );
}

for (const scenario of [
  {
    name: 'images',
    route: '/#/photos',
    toolbar: 'photo-toolbar',
    operation: 'listPhotos',
    initial: 'solar-station-front.jpg',
    query: 'dehydrator',
    result: 'dehydrator-detail.jpg',
    payload: { page: 1, pageSize: 24, groupId: '-1' }
  },
  {
    name: 'videos',
    route: '/#/photos/videos',
    toolbar: 'video-toolbar',
    operation: 'listVideos',
    initial: 'Example clothing video',
    query: 'unlinked',
    result: 'Example unlinked video',
    payload: { page: 1, pageSize: 20, title: 'unlinked' }
  }
] as const) {
  test(`${scenario.name}: compact search replaces refresh and repeated submissions read fresh data`, async ({
    page
  }) => {
    // Stable local regression snapshot; unrelated agent edits must not HMR-reset request counters.
    await page.routeWebSocket(/\/.*$/u, async (socket) => {
      await socket.close();
    });
    await page.route('https://**', (route) => route.abort());
    await page.goto(scenario.route);
    await expect(page.getByText(scenario.initial, { exact: true })).toBeVisible();
    const toolbar = page.getByTestId(scenario.toolbar);
    await expectTwoRowToolbar(toolbar);
    const form = toolbar.locator('form');
    const search = form.getByRole('button', { name: '搜索', exact: true });
    await expect(search).toBeEnabled();
    await expect(toolbar.getByRole('button', { name: '刷新', exact: true })).toHaveCount(0);
    await expect(toolbar.getByRole('button', { name: /^筛选/ })).toBeVisible();
    await expect(form.getByRole('button', { name: '上传', exact: true })).toHaveCount(0);
    await expect(toolbar.getByRole('button', { name: '上传', exact: true })).toBeVisible();
    await observeMockReads(page);
    await form.getByRole('textbox').fill(scenario.query);
    await expect(page.getByText(scenario.initial, { exact: true })).toBeVisible();
    for (const count of [1, 2]) {
      await search.click();
      await expect
        .poll(
          async () => (await readCalls(page)).filter((call) => call.operation === scenario.operation).length
        )
        .toBe(count);
      await expect(search).toBeEnabled();
      await expect(page.getByText(scenario.result, { exact: true })).toBeVisible();
      await expect(page.getByText(scenario.initial, { exact: true })).toHaveCount(0);
      const reads = (await readCalls(page)).filter((call) => call.operation === scenario.operation);
      expect(reads.at(-1)?.payload).toEqual(scenario.payload);
      if (scenario.name === 'images')
        expect((await readCalls(page)).filter((call) => call.operation === 'listPhotoGroups')).toHaveLength(
          count
        );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expectTwoRowToolbar(toolbar);
    const bounds = await form.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error('Missing search group');
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await expect(search).toBeVisible();
    await expect(toolbar.getByRole('button', { name: /^筛选/ })).toBeVisible();
  });
}
