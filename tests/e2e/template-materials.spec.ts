import { mkdir, readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import source from '../../mock/data/template-material-core.json' with { type: 'json' };
import photos from '../../mock/data/photos.json' with { type: 'json' };
import { readTemplateMaterialArchive } from '../../packages/ui/src/lib/template-material-archive';

test('Web material ZIP rewrites gallery images and reuses confirmed receipts on repeated imports', async ({
  page
}) => {
  test.setTimeout(90_000);
  await page.route(/^https:\/\/.*alicdn\.com\//u, (route) => route.abort());
  await page.goto('/#/templates');
  const name = `${source.template.name} image E2E`;
  await page.getByRole('button', { name: '新建模板', exact: true }).click();
  await page.getByLabel('模板名称', { exact: true }).fill(name);
  await page.getByText('安全 HTML', { exact: true }).click();
  await page
    .getByLabel('安全 HTML', { exact: true })
    .fill(
      `${source.template.html}<img src="${source.sourceUrl}" data-photobank-file-id="${source.oldFileId}" alt="company">`
    );
  await page.getByRole('button', { name: '保存模板', exact: true }).click();
  await page.getByRole('checkbox', { name: `选择${name}`, exact: true }).check();
  await page.getByRole('button', { name: '导出', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '导出', exact: true });
  await dialog.getByTestId('template-material-format').selectOption('zip');
  await dialog.getByRole('button', { name: '导出', exact: true }).click();
  const download = page.waitForEvent('download');
  await page
    .getByRole('dialog', { name: '导出', exact: true })
    .last()
    .getByRole('button', { name: '确认', exact: true })
    .click();
  const file = await (await download).path();
  if (!file) throw new Error('No ZIP download');
  const pack = await readTemplateMaterialArchive(new Uint8Array(await readFile(file)));
  expect(pack.assets).toHaveLength(1);
  expect(pack.document.templates[0]?.html).toContain('assets/');
  expect(pack.document.templates[0]?.html).not.toContain(source.sourceUrl);
  expect(pack.document.templates[0]?.html).not.toContain(source.oldFileId);
  const group = photos.responses.listPhotoGroups.find((item) => item.id !== '-1' && item.parentId === null);
  if (!group) throw new Error('No group fixture');
  for (const suffix of [2, 3]) {
    await page.getByRole('button', { name: '导入', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '导入', exact: true });
    await dialog.locator('input[type=file]').setInputFiles(file);
    await dialog.getByRole('tree').getByRole('button', { name: group.name, exact: true }).click();
    await dialog.getByRole('combobox', { name: /同语言、同名冲突/u }).selectOption('copy');
    await dialog.getByRole('button', { name: '导入', exact: true }).click();
    if (suffix === 3)
      await expect(page.locator('[role="dialog"]').filter({ hasText: '计划新上传：' })).toContainText(
        '计划新上传：0 个；复用已确认素材：1'
      );
    await page
      .getByRole('dialog', { name: '导入', exact: true })
      .last()
      .getByRole('button', { name: '确认', exact: true })
      .click();
    const card = page.locator('article').filter({ hasText: `${name} (${suffix})` });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByText('安全 HTML', { exact: true }).click();
    const html = await page.getByLabel('安全 HTML', { exact: true }).inputValue();
    expect(html).toContain(photos.responses.uploadPhoto.url);
    expect(html).toContain('data-photobank-file-id="ph_upload_');
    expect(html).not.toContain('assets/');
    expect(html).not.toContain(source.oldFileId);
    await page.getByRole('button', { name: '保存模板', exact: true }).click();
  }
  await page.getByTestId('language-toggle').click();
  await page.getByTestId('theme-toggle').click();
  await mkdir('artifacts/template-materials', { recursive: true });
  await page.screenshot({ path: 'artifacts/template-materials/web-en-dark.png' });
});
