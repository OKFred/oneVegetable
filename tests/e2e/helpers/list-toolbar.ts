import { expect, type Locator } from '@playwright/test';

/** Assert geometry, not just utility classes: search fills row one; actions stay below it. */
export async function expectTwoRowToolbar(toolbar: Locator): Promise<void> {
  const form = toolbar.locator('[data-slot="list-toolbar-search"]');
  const actions = toolbar.locator('[data-slot="list-toolbar-actions"]');
  const input = form.getByRole('textbox');
  const search = form.locator('button[type="submit"]');
  await expect(input).toBeVisible();
  await expect(search).toBeVisible();
  await expect(actions).toBeVisible();
  const [rowBox, inputBox, buttonBox, actionsBox] = await Promise.all(
    [form, input, search, actions].map((locator) => locator.boundingBox())
  );
  if (!rowBox || !inputBox || !buttonBox || !actionsBox) throw new Error('Missing toolbar bounds');
  expect(inputBox.x).toBeCloseTo(rowBox.x, 0);
  expect(buttonBox.x + buttonBox.width).toBeCloseTo(rowBox.x + rowBox.width, 0);
  expect(buttonBox.x - (inputBox.x + inputBox.width)).toBeGreaterThanOrEqual(0);
  expect(buttonBox.x - (inputBox.x + inputBox.width)).toBeLessThanOrEqual(9);
  expect(actionsBox.y).toBeGreaterThanOrEqual(rowBox.y + rowBox.height);
  expect(actionsBox.x + actionsBox.width).toBeCloseTo(rowBox.x + rowBox.width, 0);
  expect(await actions.evaluate((element) => getComputedStyle(element).justifyContent)).toBe('flex-end');
}
