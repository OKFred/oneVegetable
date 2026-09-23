import { expect, test } from '@playwright/test';

test('image cards keep select-all at the left edge without changing tri-state selection', async ({
  page
}) => {
  await page.route('https://**', (route) => route.abort());
  await page.goto('/#/photos');
  const toolbar = page.getByTestId('photo-toolbar');
  const selectAll = toolbar.getByRole('checkbox');
  const cards = page.getByTestId('photo-card-grid');
  await expect(cards).toBeVisible();

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(async () => {
      const checkbox = await selectAll.boundingBox();
      const row = await toolbar.locator('[data-slot="list-toolbar-actions"]').boundingBox();
      if (!checkbox || !row) throw new Error('Missing image selection bounds');
      expect(checkbox.x).toBeCloseTo(row.x, 0);
      expect(checkbox.x + checkbox.width).toBeLessThanOrEqual(row.x + row.width);
    }).toPass({ timeout: 5_000 });
  }

  await expect(selectAll).not.toBeChecked();
  await cards.getByRole('checkbox').first().check();
  await expect(selectAll).toHaveAttribute('aria-checked', 'mixed');
  await selectAll.check();
  for (const checkbox of await cards.getByRole('checkbox').all()) await expect(checkbox).toBeChecked();
  await selectAll.uncheck();
  for (const checkbox of await cards.getByRole('checkbox').all()) await expect(checkbox).not.toBeChecked();
  await toolbar.getByRole('button', { name: '列表', exact: true }).click();
  await expect(selectAll).toHaveCount(0);
});
