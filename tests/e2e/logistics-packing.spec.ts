import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect, test, type Page, type TestInfo } from '@playwright/test';
import { completeOnboarding, ONBOARDING_STORAGE_KEY } from '../../packages/core/src/privacy';

async function instrumentGpu(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { draws: 0 };
    Object.assign(window, { packingGpu: state });
    if (typeof WebGL2RenderingContext === 'undefined') return;
    for (const key of [
      'drawArrays',
      'drawElements',
      'drawArraysInstanced',
      'drawElementsInstanced'
    ] as const) {
      const original = Reflect.get(WebGL2RenderingContext.prototype, key) as (
        this: WebGL2RenderingContext,
        ...args: unknown[]
      ) => void;
      Object.defineProperty(WebGL2RenderingContext.prototype, key, {
        configurable: true,
        value: function (this: WebGL2RenderingContext, ...args: unknown[]) {
          Reflect.apply(original, this, args);
          state.draws++;
        }
      });
    }
  });
}
const draws = (page: Page) =>
  page.evaluate(() => (window as unknown as { packingGpu: { draws: number } }).packingGpu.draws);

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath(name), fullPage: true });
}

async function exercisePacking(page: Page, testInfo: TestInfo, prefix: string): Promise<void> {
  await page.getByRole('button', { name: '装箱预览', exact: true }).click();
  const workspace = page.getByTestId('packing-workspace');
  await expect(workspace).toBeVisible();
  await expect(workspace.getByTestId('packing-container-length')).toHaveValue('');
  await workspace.getByTestId('packing-example').click();
  await workspace.getByTestId('packing-generate').click();
  await expect(workspace.getByTestId('packing-packed')).toHaveText('20');
  await expect(workspace.getByTestId('packing-results')).toContainText('62.2%');
  await expect(workspace.getByTestId('packing-results')).toContainText('0.084 m³');
  const canvas = workspace.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(() => draws(page)).toBeGreaterThan(0);
  const initial = await canvas.screenshot();
  let count = await draws(page);
  await workspace.getByRole('button', { name: '俯视', exact: true }).click();
  await expect.poll(() => draws(page)).toBeGreaterThan(count);
  expect((await canvas.screenshot()).equals(initial)).toBe(false);
  count = await draws(page);
  await workspace.getByRole('button', { name: '重置视角', exact: true }).click();
  await expect.poll(() => draws(page)).toBeGreaterThan(count);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing visible canvas');
  count = await draws(page);
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.55, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => draws(page)).toBeGreaterThan(count);
  expect((await canvas.screenshot()).equals(initial)).toBe(false);
  count = await draws(page);
  await page.mouse.wheel(0, -180);
  await expect.poll(() => draws(page)).toBeGreaterThan(count);
  await workspace.getByRole('button', { name: '正视', exact: true }).click();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(workspace.getByTestId('packing-scene')).not.toHaveAttribute('data-selected-cargo', '');
  const legend = workspace.getByRole('button', { name: /示例货物 A.*12.*12/u });
  await expect(legend).toHaveAttribute('aria-pressed', 'true');
  await legend.focus();
  await page.keyboard.press('Space');
  await expect(legend).toHaveAttribute('aria-pressed', 'false');
  await legend.click();
  await expect(legend).toHaveAttribute('aria-pressed', 'true');
  await workspace.getByRole('button', { name: '重置视角', exact: true }).click();
  await capture(page, testInfo, prefix + '-zh-light.png');
  await page.getByTestId('language-toggle').click();
  await expect(workspace).toContainText('Packing results');
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
  });
  await capture(page, testInfo, prefix + '-en-dark.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#app-primary-navigation')).toHaveAttribute('aria-hidden', 'true');
  await expect
    .poll(async () => {
      const navigation = await page.locator('#app-primary-navigation').boundingBox();
      return navigation ? navigation.x + navigation.width : 0;
    })
    .toBeLessThanOrEqual(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await capture(page, testInfo, prefix + '-mobile.png');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByTestId('language-toggle').click();
  await page.getByRole('button', { name: '运费试算', exact: true }).click();
  await expect(canvas).toHaveCount(0);
  const afterHide = await draws(page);
  await page.getByRole('button', { name: '装箱预览', exact: true }).click();
  await expect(workspace.getByTestId('packing-container-length')).toHaveValue('60');
  await expect(canvas).toBeVisible();
  await expect.poll(() => draws(page)).toBeGreaterThan(afterHide);
  await workspace.getByTestId('packing-plan-save').click();
  const saveDialog = page.getByRole('dialog', { name: '保存方案', exact: true });
  await saveDialog.getByTestId('packing-plan-name').fill('Packing example');
  await saveDialog.getByTestId('packing-plan-save-confirm').click();
  await expect(saveDialog).not.toBeVisible();
  const downloading = page.waitForEvent('download');
  await workspace.getByTestId('packing-plan-export').click();
  const downloaded = await downloading;
  const filename = await downloaded.path();
  if (!filename) throw new Error('Plan download unavailable');
  const exported = JSON.parse(await readFile(filename, 'utf8')) as {
    kind: string;
    unit: string;
    input: { container: { length: number } };
  };
  expect(exported.kind).toBe('one-vegetable-packing-plan');
  expect(exported.unit).toBe('mm');
  expect(exported.input.container.length).toBe(600);
  expect(exported).not.toHaveProperty('placements');
  expect(exported).not.toHaveProperty('result');
  await page.reload();
  await page.getByRole('button', { name: '装箱预览', exact: true }).click();
  await expect(page.getByTestId('packing-container-length')).toHaveValue('');
  await expect(page.getByTestId('packing-packed')).toHaveCount(0);
  await page.getByTestId('packing-plan-open').click();
  await page
    .getByRole('dialog', { name: '本机方案', exact: true })
    .getByRole('button', { name: '打开', exact: true })
    .click();
  await expect(page.getByTestId('packing-container-length')).toHaveValue('60');
  await expect(page.getByTestId('packing-packed')).toHaveCount(0);
  await page.getByTestId('packing-generate').click();
  await expect(page.getByTestId('packing-packed')).toHaveText('20');
  const incoming = {
    name: 'plan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        ...exported,
        input: { ...exported.input, container: { ...exported.input.container, length: 610 } }
      })
    )
  };
  await page.getByTestId('packing-plan-file').setInputFiles(incoming);
  let replace = page.getByRole('dialog', { name: '替换当前输入？', exact: true });
  await replace.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByTestId('packing-container-length')).toHaveValue('60');
  await page.getByTestId('packing-plan-file').setInputFiles(incoming);
  replace = page.getByRole('dialog', { name: '替换当前输入？', exact: true });
  await replace.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByTestId('packing-container-length')).toHaveValue('61');
  await expect(page.getByTestId('packing-packed')).toHaveCount(0);
  await page.getByTestId('packing-generate').click();
  await expect(page.getByTestId('packing-packed')).toHaveText('20');
  await capture(page, testInfo, prefix + '-reused-plan.png');
  await page.getByTestId('packing-plan-open').click();
  const removePlan = page.getByRole('button', { name: '删除方案 Packing example', exact: true });
  await expect(removePlan).toHaveText('删除');
  await removePlan.click();
  await page
    .getByRole('dialog', { name: '删除本机方案？', exact: true })
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '本机方案', exact: true })).toContainText('暂无保存的方案');
  await page.keyboard.press('Escape');
}

test('Web renders and releases local packing without platform calls', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const calls: string[] = [];
  await page.route('https://**', (route) => {
    calls.push(new URL(route.request().url()).origin);
    return route.abort();
  });
  await instrumentGpu(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/logistics');
  await exercisePacking(page, testInfo, 'web');
  expect(calls).toEqual([]);
});

test('WebGL unavailable keeps actual packing statistics', async ({ page }) => {
  await page.route('https://**', (route) => route.abort());
  await page.addInitScript(() => {
    const original = Reflect.get(HTMLCanvasElement.prototype, 'getContext') as (
      this: HTMLCanvasElement,
      ...args: unknown[]
    ) => RenderingContext | null;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
      if (args[0] === 'webgl2') return null;
      return Reflect.apply(original, this, args);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto('/#/logistics');
  await page.getByRole('button', { name: '装箱预览', exact: true }).click();
  await page.getByTestId('packing-example').click();
  await page.getByTestId('packing-generate').click();
  await expect(page.getByTestId('packing-packed')).toHaveText('20');
  await expect(page.getByTestId('packing-workspace')).toContainText('当前浏览器无法显示三维预览');
});

test('formal MV3 uses local Worker and GPU without credentials or new permissions', async ({
  browserName
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(90_000);
  const extension = resolve('apps/extension/.output/chrome-mv3');
  const context = await chromium.launchPersistentContext(await mkdtemp(resolve(tmpdir(), 'ov-packing-')), {
    headless: false,
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  try {
    const calls: string[] = [];
    await context.route(/^https?:\/\//u, (route) => {
      calls.push(new URL(route.request().url()).origin);
      return route.abort();
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await worker.evaluate(
      async (values) => {
        const chrome = (
          globalThis as unknown as { chrome: { storage: { local: { set(value: unknown): Promise<void> } } } }
        ).chrome;
        await chrome.storage.local.set(values);
      },
      { [ONBOARDING_STORAGE_KEY]: completeOnboarding() }
    );
    const page = await context.newPage();
    await instrumentGpu(page);
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#/logistics`);
    await exercisePacking(page, testInfo, 'extension');
    expect(calls).toEqual([]);
  } finally {
    await context.close();
  }
});
