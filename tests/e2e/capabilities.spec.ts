import { expect, test, type Page } from '@playwright/test';

// This suite uses only the explicit local mock app. Abort all non-local traffic
// and BFF requests so a misconfigured test cannot reach Alibaba or a real backend.
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173' || url.pathname.startsWith('/api/')) {
      await route.abort();
      return;
    }
    await route.continue();
  });
});

test('catalog separates integration, documentation, history and current environment in both locales', async ({
  page
}) => {
  await page.goto('/#/capabilities');
  await expect(page.getByRole('columnheader', { name: '接入状态', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '文档证据', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '账号快照', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '当前环境', exact: true })).toBeVisible();
  await expect(page.getByText(/不会自动回退到 Mock/)).toBeVisible();
  await page.getByTestId('language-toggle').click();
  await expect(page.getByRole('columnheader', { name: 'Integration', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Documentation', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Current environment', exact: true })).toBeVisible();
  await page.getByPlaceholder('Search API methods').fill('alibaba.icbu.product.list');
  await page.getByRole('button', { name: 'alibaba.icbu.product.list', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Integration / contract', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Documentation evidence', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Mock data', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Call capability', exact: true })).toBeEnabled();
});

test('explicit mock can run a deprecated example without implying a live call', async ({ page }) => {
  const bffRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/')) bffRequests.push(request.url());
  });
  const dialog = await openCapability(page, 'alibaba.icbu.category.attr.get');
  await expect(dialog.getByText(/废弃状态仅为警告/)).toBeVisible();
  await expect(dialog.getByText('Mock 数据', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '调用能力', exact: true }).click();
  await expect(
    dialog.locator('pre').filter({ hasText: 'mock-alibaba-icbu-category-attr-get' })
  ).toBeVisible();
  expect(bffRequests).toEqual([]);
});

test('advanced capability filters apply together and discard cancelled draft changes', async ({ page }) => {
  await page.goto('/#/capabilities');
  const method = 'alibaba.icbu.product.list';
  await page.getByPlaceholder('搜索 API 方法').fill(method);
  await expect(page.getByRole('button', { name: method, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  const filters = page.getByRole('dialog', { name: '筛选', exact: true });
  await filters.getByLabel('全部业务域').selectOption('photo');
  await filters.getByLabel('账号验证快照').selectOption('permission-denied');
  await expect(page.locator('tbody')).toContainText(method);
  await filters.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: method, exact: true })).toBeVisible();

  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect(filters.getByLabel('全部业务域')).toHaveValue('all');
  await expect(filters.getByLabel('账号验证快照')).toHaveValue('all');
  await filters.getByLabel('全部业务域').selectOption('photo');
  await filters.getByLabel('账号验证快照').selectOption('permission-denied');
  await filters.getByRole('button', { name: '应用筛选' }).click();
  await expect(page.getByRole('button', { name: '筛选 · 2', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: method, exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '筛选 · 2', exact: true }).click();
  await filters.getByRole('button', { name: '重置', exact: true }).click();
  await filters.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '筛选 · 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '筛选 · 2', exact: true }).click();
  await filters.getByRole('button', { name: '重置', exact: true }).click();
  await filters.getByRole('button', { name: '应用筛选' }).click();
  await expect(page.getByRole('button', { name: '筛选', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: method, exact: true })).toBeVisible();
});

test('restricted protocol examples remain read-only and cannot be sent', async ({ page }) => {
  const dialog = await openCapability(page, 'alibaba.icbu.risk.send');
  await expect(dialog.getByLabel('只读文档参数示例')).toBeVisible();
  await expect(dialog.getByText(/WUA、UMID、IMEI、IMSI、MAC/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '调用能力', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('调用参数 JSON')).toHaveCount(0);
});

test('disabled restricted catalog entries still show typed contracts, metadata and examples', async ({
  page
}) => {
  const dialog = await openCapability(page, 'alibaba.dropshipping.product.get');
  await expect(dialog.getByText('已类型化', { exact: true })).toBeVisible();
  await expect(dialog.getByText('能力受限', { exact: true })).toBeVisible();
  await expect(dialog.getByText('API 目录', { exact: true })).toBeVisible();
  await expect(dialog.getByText('需业务资格', { exact: true })).toBeVisible();
  await expect(dialog.getByText('国际站DropShipping权限包', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Requires applicable business qualifications/).first()).toBeVisible();
  await expect(dialog.getByLabel('调用参数 JSON')).toHaveValue(/param_distribution_sale_product_request/);
  await expect(dialog.getByRole('button', { name: '调用能力', exact: true })).toBeDisabled();
  await dialog.getByText('文档响应示例', { exact: true }).click();
  await expect(
    dialog.getByText('仅为文档示例，不是调用结果，也不代表账号已授权。', { exact: true })
  ).toBeVisible();
  await expect(dialog.locator('pre').filter({ hasText: 'is_can_place_order' })).toBeVisible();
});

async function openCapability(page: Page, method: string) {
  await page.goto('/#/capabilities');
  await page.getByPlaceholder('搜索 API 方法').fill(method);
  await page.getByRole('button', { name: `${method}的操作`, exact: true }).click();
  await page.locator('.row-actions').getByRole('button', { name: 'API 能力详情' }).click();
  return page.getByRole('dialog');
}
