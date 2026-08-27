import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('dashboard and product list have no automatic WCAG A/AA violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '运营总览' })).toBeVisible();
  await expectNoAccessibilityViolations(page);

  await page.getByRole('link', { name: '商品' }).click();
  await expect(page.getByRole('heading', { name: '商品管理' })).toBeVisible();
  await expect(page.getByText('Portable solar power station 1000W')).toBeVisible();
  await expectNoAccessibilityViolations(page);
});

test('mobile navigation has a name and restores keyboard focus after Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const menuButton = page.getByRole('button', { name: '打开主导航' });
  await menuButton.click();
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link').first()).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(menuButton).toBeFocused();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  await expectNoAccessibilityViolations(page);
});

async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations).toEqual([]);
}
