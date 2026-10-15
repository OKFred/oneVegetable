import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import fixture from '../../mock/data/template-composition.json' with { type: 'json' };

test('templates fill product variables and compose with preview, without publishing or storing filled values', async ({
  page
}) => {
  test.setTimeout(90_000);
  const businessRequests: string[] = [];
  page.on('request', (request) => {
    if (
      request.url().includes('/api/v1/operations/call') ||
      /(?:taobao|alibaba)\.com\/(?:rest|router|openapi)/u.test(request.url())
    )
      businessRequests.push(request.url());
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      'one-vegetable:preferences:v2',
      JSON.stringify({ version: 2, uiLocale: 'zh-CN', alibabaLanguage: 'en_US', theme: 'light' })
    );
  });
  await page.goto('/#/templates');
  for (const item of fixture.templates.slice(0, 2)) {
    await page.getByRole('button', { name: '新建模板', exact: true }).click();
    await page.getByLabel('模板名称', { exact: true }).fill(item.name);
    await page.getByText('安全 HTML', { exact: true }).click();
    await page.getByLabel('安全 HTML', { exact: true }).fill(item.html);
    await page.getByRole('button', { name: '保存模板', exact: true }).click();
    await expect(page.getByText(item.name, { exact: true })).toBeVisible();
  }
  await page.getByRole('link', { name: '商品', exact: true }).click();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await page.getByRole('combobox').click();
  const category = page.getByRole('dialog', { name: '选择商品类目' });
  await category.getByRole('button', { name: /Consumer Electronics/u }).click();
  await category.getByRole('button', { name: /Portable Power Stations/u }).click();
  await page.getByRole('button', { name: '开始填写', exact: true }).click();
  await page.getByLabel('商品标题', { exact: true }).fill(fixture.values.productName);
  await page.getByRole('button', { name: /六步向导/u }).click();
  await page.getByRole('button', { name: /4\. 商品详情/u }).click();
  await page.locator('.ProseMirror').fill('Existing description');
  await page.getByRole('button', { name: '商品详情模板', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '商品详情模板', exact: true });
  for (const item of fixture.templates.slice(0, 2))
    await dialog.getByRole('checkbox', { name: `选择${item.name}`, exact: true }).check();
  await dialog.getByRole('button', { name: '组合使用', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '组合与填入模板', exact: true });
  await expect(dialog.locator('input[id$="-productName"]')).toHaveValue(fixture.values.productName);
  await expect(dialog.getByRole('button', { name: '确认追加', exact: true })).toBeDisabled();
  for (const variable of ['companyName', 'leadTime', 'shippingOrigin', 'model'] as const)
    await dialog.locator(`input[id$="-${variable}"]`).fill(fixture.values[variable]);
  await dialog.getByRole('button', { name: '上移 Shipping', exact: true }).click();
  await expect(dialog.locator('li').first()).toContainText('Shipping');
  await expect(dialog.getByTestId('template-filled-preview')).toBeInViewport();
  await expect(page.locator('.ProseMirror')).not.toContainText(fixture.values.companyName);
  await mkdir('artifacts/template-composition', { recursive: true });
  await page.screenshot({ path: 'artifacts/template-composition/web-zh.png' });
  await dialog.getByRole('button', { name: '确认追加', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toContainText('Existing description');
  await expect(page.locator('.ProseMirror')).toContainText(fixture.values.companyName);
  await page.getByTestId('language-toggle').click();
  await page.getByTestId('theme-toggle').click();
  await page.getByRole('button', { name: 'Product description templates', exact: true }).click();
  await page.getByRole('button', { name: 'Use together', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Compose and fill templates', exact: true });
  // Filled company/delivery information was not saved as template or account defaults.
  await expect(dialog.locator('input[id$="-companyName"]')).toHaveValue('');
  await expect(dialog.locator('input[id$="-leadTime"]')).toHaveValue('');
  for (const variable of ['companyName', 'leadTime', 'shippingOrigin', 'model'] as const)
    await dialog.locator(`input[id$="-${variable}"]`).fill(fixture.values[variable]);
  await page.screenshot({ path: 'artifacts/template-composition/web-en-dark.png' });
  await dialog.getByRole('combobox').selectOption('replace');
  dialog = page.getByRole('dialog', { name: 'Confirm description replacement', exact: true });
  await expect(dialog.getByRole('heading', { name: 'Current description', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm full replacement', exact: true }).click();
  await expect(page.locator('.ProseMirror')).not.toContainText('Existing description');
  await expect(page.locator('.ProseMirror')).not.toContainText('{{');
  expect(businessRequests).toEqual([]);
});
