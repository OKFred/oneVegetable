import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  test(`list actions share icons, neutral colors and dimensions (${theme})`, async ({ page }, testInfo) => {
    await page.route('https://**', (route) => route.abort());
    for (const route of [
      'products',
      'photos',
      'photos/videos',
      'orders',
      'inventory',
      'rfqs',
      'capabilities'
    ]) {
      await page.goto(`/#/${route}`);
      const toolbar = page.locator('[data-list-toolbar]').first();
      await expect(toolbar).toBeVisible();
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle('dark', dark),
        theme === 'dark'
      );
      const actions = toolbar.locator('[data-list-action]');
      await expect(actions.first()).toBeVisible();
      const presentation = await actions.evaluateAll((buttons) =>
        buttons.map((button) => {
          const style = getComputedStyle(button);
          return {
            label: button.textContent.trim(),
            icon: button.querySelector('svg[aria-hidden="true"]') !== null,
            background: style.backgroundColor,
            foreground: style.color,
            height: style.height,
            font: style.fontSize,
            gap: style.gap,
            radius: style.borderRadius,
            border: style.borderTopWidth
          };
        })
      );
      const baseline = presentation[0];
      expect(baseline).toBeDefined();
      for (const action of presentation) {
        expect(action.label).toBeTruthy();
        expect(action.icon, `${route}: ${action.label}`).toBe(true);
        expect(action.height).toBe('36px');
        expect(action.font).toBe('14px');
        expect(action.border).toBe('1px');
        expect(action.background).toBe(baseline?.background);
        expect(action.foreground).toBe(baseline?.foreground);
        expect(action.gap).toBe(baseline?.gap);
        expect(action.radius).toBe(baseline?.radius);
      }
      if (['products', 'photos', 'photos/videos'].includes(route)) {
        await toolbar.screenshot({ path: testInfo.outputPath(`${route.replaceAll('/', '-')}-${theme}.png`) });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      for (const action of await actions.all()) {
        const box = await action.boundingBox();
        expect(box).not.toBeNull();
        if (box) expect(box.x + box.width).toBeLessThanOrEqual(391);
      }
      await page.setViewportSize({ width: 1280, height: 720 });
    }
  });
}

test('row actions use neutral menu items, including links, and keep keyboard navigation', async ({
  page
}) => {
  await page.route('https://**', (route) => route.abort());
  await page.goto('/#/products');
  await page.locator('table tbody tr').first().locator('td').last().getByRole('button').click();
  const menu = page.locator('[data-row-actions]');
  await expect(menu).toBeVisible();
  const edit = menu.getByRole('button', { name: '编辑', exact: true });
  const link = menu.getByRole('link', { name: '链接', exact: true });
  await expect(edit).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(link).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(edit).toHaveCSS('height', '32px');
  await expect(link).toHaveCSS('height', '32px');
  const color = await edit.evaluate((element) => getComputedStyle(element).color);
  await expect(link).toHaveCSS('color', color);
  await edit.focus();
  await page.keyboard.press('End');
  await expect(menu.locator('button:not(:disabled),a[href]').last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});
