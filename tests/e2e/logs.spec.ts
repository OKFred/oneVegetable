import { expect, test } from '@playwright/test';

test('logs navigation follows releases, supports deep links and stays readable in both languages', async ({
  page
}, testInfo) => {
  await page.goto('/#/logs/local');
  await expect(page.getByRole('heading', { name: '日志', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '脱敏诊断', exact: true })).toBeVisible();
  const sidebar = page.getByRole('navigation', { name: '主导航' });
  const links = await sidebar.getByRole('link').allTextContents();
  const titles = links.map((value) => value.trim());
  expect(titles.indexOf('日志')).toBe(titles.indexOf('版本更新') + 1);
  expect(titles.indexOf('设置')).toBe(titles.indexOf('日志') + 1);
  await expect(page.getByRole('link', { name: '请求诊断', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '操作审计', exact: true })).toHaveCount(0);
  await page.getByTestId('language-toggle').click();
  await expect(page.getByRole('heading', { name: 'Logs', exact: true })).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Export diagnostics', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('logs-en-dark-mobile.png'), animations: 'disabled' });
  await page.reload();
  await expect(page).toHaveURL(/#\/logs\/local$/);
  await expect(page.getByRole('heading', { name: 'Logs', exact: true })).toBeVisible();
});
