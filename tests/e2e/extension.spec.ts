import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { chromium, expect, test, type BrowserContext } from '@playwright/test';

let context: BrowserContext;

test.beforeAll(async () => {
  const extensionPath = resolve(import.meta.dirname, '../../apps/extension/.output/chrome-mv3');
  const userDataDir = await mkdtemp(resolve(tmpdir(), 'one-vegetable-e2e-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
});

test.afterAll(async () => {
  await context.close();
});

test('MV3 options page persists settings and exposes the audited catalog', async () => {
  let serviceWorker = context.serviceWorkers()[0];
  serviceWorker ??= await context.waitForEvent('serviceworker');
  const extensionId = new URL(serviceWorker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(page.getByRole('heading', { name: '运营总览' })).toBeVisible();
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByLabel('App Key').fill('e2e-app-key');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('设置已安全写入 chrome.storage.local。')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByLabel('App Key')).toHaveValue('e2e-app-key');

  await page.getByRole('button', { name: 'API 能力' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(86);
  await page.getByPlaceholder('搜索 API 方法').fill('alibaba.icbu.product.schema.add');
  await page.getByRole('button', { name: 'alibaba.icbu.product.schema.add', exact: true }).click();
  await expect(page.getByText(/真实写能力尚未通过账号 smoke test/)).toBeVisible();
  await expect(page.getByRole('button', { name: '调用能力' })).toBeDisabled();

  await page.evaluate(() => {
    localStorage.setItem(
      'one-vegetable-product-schema-draft',
      JSON.stringify({
        categoryId: '100009999',
        language: 'en_US',
        market: 'wholesale',
        xml: '<itemSchema><field id="productDescType" name="详情类型" type="label"><value>2</value></field><field id="superText" name="商品详情" type="input"><rules><rule name="valueTypeRule" value="html"/></rules><value>&lt;p&gt;Extension draft detail&lt;/p&gt;</value></field></itemSchema>'
      })
    );
  });
  await page.getByRole('button', { name: '商品' }).click();
  await page.getByRole('tab', { name: 'Schema 发品/编辑' }).click();
  await expect(page.getByText('已恢复浏览器中的未提交表单草稿。')).toBeVisible();
  await expect(page.getByRole('button', { name: /发布商品/ })).toBeDisabled();
  await page.getByRole('button', { name: /插入图库图片/ }).click();
  await expect(page.getByRole('heading', { name: '国际站图库' })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toBeDisabled();
  await expect(page.getByRole('textbox', { name: '外部图片 URL' })).toBeDisabled();
  await expect(page.getByText(/真实上传尚未完成账号 smoke test/)).toBeVisible();
  await page.getByRole('button', { name: '完成选择' }).click();

  await page.getByRole('button', { name: 'RFQ' }).click();
  await expect(page.getByRole('heading', { name: 'RFQ 工作台' })).toBeVisible();
  await expect(page.getByText(/真实附件上传和提交报价尚未通过账号 smoke test/)).toBeVisible();

  await page.getByRole('button', { name: '订单' }).click();
  await expect(page.getByRole('heading', { name: '交易 / 订单工作台' })).toBeVisible();
  await expect(page.getByText(/完整详情明确标记为不可用/)).toBeVisible();
  await page.getByRole('button', { name: '信保订单草稿' }).click();
  await expect(page.getByText('扩展真实写入已禁用')).toBeVisible();
  await expect(page.getByRole('button', { name: '创建 Mock 信保订单' })).toBeDisabled();
});
