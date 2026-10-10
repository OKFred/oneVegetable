import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect, test, type Page } from '@playwright/test';
import fixture from '../../mock/data/template-library.json' with { type: 'json' };
import { completeOnboarding, ONBOARDING_STORAGE_KEY } from '../../packages/core/src/privacy';
import { parseTemplateBundle } from '../../packages/core/src/template-library';

async function createTemplate(page: Page): Promise<string> {
  const source = fixture.templates[0];
  if (!source) throw new Error('Missing template fixture');
  const name = `${source.name} E2E`;
  await page.getByRole('button', { name: '新建模板', exact: true }).click();
  await page.getByLabel('模板名称', { exact: true }).fill(name);
  await page
    .locator('.ProseMirror')
    .fill('Template editing acceptance. Replace with accurate company information.');
  await page.getByRole('combobox', { name: /模板分类/u }).selectOption('company');
  await page.getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  return name;
}

async function archiveRestore(page: Page, name: string): Promise<void> {
  const card = page.locator('article').filter({ hasText: name });
  await card.getByRole('button', { name: '预览', exact: true }).click();
  const preview = page.getByRole('dialog', { name, exact: true });
  await expect(preview).toContainText('Template editing acceptance');
  await preview.getByRole('button', { name: `关闭${name}`, exact: true }).click();
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('.ProseMirror').fill('Template editing acceptance. Updated reusable content.');
  await page.getByRole('button', { name: '保存模板', exact: true }).click();
  await card.getByRole('button', { name: '归档', exact: true }).click();
  await expect(card).toBeHidden();
  await page.getByRole('checkbox', { name: '显示已归档模板' }).check();
  await card.getByRole('button', { name: '恢复', exact: true }).click();
  await page.getByRole('checkbox', { name: '显示已归档模板' }).uncheck();
  await expect(card).toBeVisible();
}

async function exportImport(page: Page, name: string): Promise<void> {
  await page.getByRole('checkbox', { name: `选择${name}`, exact: true }).check();
  await page.getByRole('button', { name: '导出', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '导出', exact: true });
  await dialog.getByRole('button', { name: '导出', exact: true }).click();
  const download = page.waitForEvent('download');
  await page
    .getByRole('dialog', { name: '导出', exact: true })
    .last()
    .getByRole('button', { name: '确认', exact: true })
    .click();
  const file = await (await download).path();
  if (!file) throw new Error('Missing downloaded package');
  const bundle = parseTemplateBundle(new Uint8Array(await readFile(file)));
  expect(bundle.templates).toHaveLength(1);
  expect(bundle.templates[0]?.name).toBe(name);
  expect(bundle.templates[0]?.html).toContain('Updated reusable content');
  expect(Object.keys(bundle.templates[0] ?? {}).sort()).toEqual([
    'category',
    'html',
    'language',
    'name',
    'remark'
  ]);
  await page.getByRole('button', { name: '导入', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '导入', exact: true });
  await dialog.locator('input[type=file]').setInputFiles(file);
  await expect(dialog).toContainText('1 个模板');
  await dialog.getByRole('combobox', { name: /同语言、同名冲突/u }).selectOption('copy');
  await dialog.getByRole('button', { name: '导入', exact: true }).click();
  await page
    .getByRole('dialog', { name: '导入', exact: true })
    .last()
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(page.getByText(`${name} (2)`, { exact: true })).toBeVisible();
}

test('Web template library supports rich editing, archive/restore and confirmed JSON exchange', async ({
  page
}) => {
  await page.route(/https:\/\/.*(?:alibaba|taobao)\.com\//u, (route) => route.abort());
  await page.goto('/#/templates');
  const name = await createTemplate(page);
  await archiveRestore(page, name);
  await exportImport(page, name);
  await page.getByRole('button', { name: '切换为英文界面', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await mkdir(resolve('artifacts/template-library'), { recursive: true });
  await page.screenshot({ path: resolve('artifacts/template-library/web-library.png') });
});

test('formal independent extension retains editable local templates across reload without BFF or Alibaba', async () => {
  test.setTimeout(90_000);
  const extension = resolve('apps/extension/.output/chrome-mv3');
  const context = await chromium.launchPersistentContext(await mkdtemp(resolve(tmpdir(), 'ov-templates-')), {
    headless: false,
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  try {
    let externalCalls = 0;
    await context.route(/^https?:\/\//u, (route) => {
      externalCalls++;
      return route.abort();
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await worker.evaluate(
      async (values) => {
        const chrome = (
          globalThis as unknown as {
            chrome: { storage: { local: { set(value: Record<string, unknown>): Promise<void> } } };
          }
        ).chrome;
        await chrome.storage.local.set(values);
      },
      { [ONBOARDING_STORAGE_KEY]: completeOnboarding() }
    );
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#/templates`);
    const name = await createTemplate(page);
    await archiveRestore(page, name);
    await exportImport(page, name);
    await page.reload();
    await expect(page.getByText(`${name} (2)`, { exact: true })).toBeVisible();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await mkdir(resolve('artifacts/template-library'), { recursive: true });
    await page.screenshot({ path: resolve('artifacts/template-library/extension-library.png') });
    await page
      .locator('article')
      .filter({ hasText: `${name} (2)` })
      .getByRole('button', { name: '预览', exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: `${name} (2)`, exact: true })).toContainText(
      'Updated reusable content'
    );
    expect(externalCalls).toBe(0);
  } finally {
    await context.close();
  }
});
