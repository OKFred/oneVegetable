import { expect, test } from '@playwright/test';

test('translation appears in the capability debugger with a typed batch and explicit permission context', async ({
  page
}) => {
  await page.goto('/#/capabilities');
  await page.getByRole('textbox', { name: /搜索/ }).fill('alibaba.icbu.text.trans');
  await page.getByRole('button', { name: 'alibaba.icbu.text.trans', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/ICBU翻译能力/)).toBeVisible();
  await expect(dialog.locator('textarea')).toHaveValue(/icbu_translate_task_dto/);
  await expect(dialog.locator('textarea')).toHaveValue(/source_language/);
});
