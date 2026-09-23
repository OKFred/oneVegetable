import { expect, test, type Page } from '@playwright/test';
import rfqFixture from '../../mock/data/rfqs.json' with { type: 'json' };
import credentialFixture from '../../mock/data/node-gateway-credentials.json' with { type: 'json' };

const guardTitle = '放弃未保存的修改？';
const cleanupTitle = '清理旧版本地编辑草稿？';
const rfqDraftKey = `one-vegetable:rfq-draft:${rfqFixture.primaryRfq.id}`;

test.beforeEach(async ({ context }) => {
  // This suite exercises only the in-process Web fixture; no platform/BFF writes.
  await context.route(/https:\/\/.*(?:alibaba|taobao)\.com\//u, (route) => route.abort());
  await context.route('**/api/v1/**', (route) => route.abort());
  await context.addInitScript((fixture) => {
    const key = 'one-vegetable-mock-settings';
    if (!localStorage.getItem(key))
      localStorage.setItem(
        key,
        JSON.stringify({
          appKey: fixture.appKey,
          appSecret: fixture.appSecret,
          accessToken: fixture.accessToken,
          endpoint: 'https://eco.taobao.com/router/rest',
          signMethod: 'hmac'
        })
      );
  }, credentialFixture.manual);
});

async function openSettings(page: Page): Promise<void> {
  await page.goto('/#/settings');
  await expect(page.getByTestId('account-avatar')).toHaveAttribute('aria-label', '当前用户：本地演示用户');
  await expect(page.getByLabel('App Key', { exact: true })).toHaveValue(credentialFixture.manual.appKey);
}

test('dirty settings keep the current hash and values on cancel, and discard only after confirmation', async ({
  page
}) => {
  await openSettings(page);
  await page.getByLabel('App Key', { exact: true }).fill('unsaved-local-value');
  await page.getByRole('link', { name: '订单', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: guardTitle });
  await expect(confirmation).toBeVisible();
  await expect(page).toHaveURL(/#\/settings$/u);
  await expect(page.getByLabel('App Key', { exact: true })).toHaveValue('unsaved-local-value');
  await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(page).toHaveURL(/#\/settings$/u);

  await page.getByRole('link', { name: '订单', exact: true }).click();
  await confirmation.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
  await expect(page).toHaveURL(/#\/orders$/u);
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('App Key', { exact: true })).toHaveValue(credentialFixture.manual.appKey);
  expect(await page.evaluate(() => localStorage.getItem('one-vegetable-mock-settings'))).not.toContain(
    'unsaved-local-value'
  );
});

test('browser Back cannot replace the edited view before the leave dialog is accepted', async ({ page }) => {
  await page.goto('/#/dashboard');
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('App Key', { exact: true })).toHaveValue(credentialFixture.manual.appKey);
  await page.getByLabel('App Key', { exact: true }).fill('pending-back-navigation');
  await page.evaluate(() => {
    history.back();
  });
  const confirmation = page.getByRole('dialog', { name: guardTitle });
  await expect(confirmation).toBeVisible();
  await expect(page).toHaveURL(/#\/settings$/u);
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden();
  await expect(page.getByLabel('App Key', { exact: true })).toHaveValue('pending-back-navigation');
  await expect(page).toHaveURL(/#\/settings$/u);
});

test('refresh uses the native warning only while business fields are dirty', async ({ page }) => {
  await openSettings(page);
  // Chromium requires a real user activation before it may show beforeunload.
  await page.getByLabel('App Key', { exact: true }).click();
  await page.getByLabel('App Key', { exact: true }).fill('unsaved-before-reload');
  expect(await page.evaluate(() => navigator.userActivation.hasBeenActive)).toBe(true);
  const nativeDialog = page.waitForEvent('dialog');
  // A cancelled reload may stay pending until its navigation timeout in Chromium.
  const reload = page.reload({ timeout: 5_000 }).catch(() => null);
  const warning = await nativeDialog;
  expect(warning.type()).toBe('beforeunload');
  await warning.dismiss();
  await reload;
  await expect(page.getByLabel('App Key', { exact: true })).toHaveValue('unsaved-before-reload');

  await page.getByLabel('App Key', { exact: true }).fill(credentialFixture.manual.appKey);
  const unexpectedDialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    unexpectedDialogs.push(dialog.type());
    await dialog.dismiss();
  });
  await page.reload();
  await expect(page.getByLabel('App Key', { exact: true })).toHaveValue(credentialFixture.manual.appKey);
  expect(unexpectedDialogs).toEqual([]);
});

test('RFQ does not restore legacy data and closing an edited sheet requires consent', async ({ page }) => {
  await page.goto('/#/rfqs');
  await expect(page.getByRole('button', { name: rfqFixture.primaryRfq.subject, exact: true })).toBeVisible();
  await page.evaluate(
    ({ key, subject }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          message: 'legacy-form-must-not-load',
          paymentTerms: 'T/T',
          expiresAt: '2026-12-01',
          itemName: subject,
          unitPrice: '10',
          currency: 'USD',
          quantity: '1',
          quantityUnit: 'Pieces',
          shippingTerms: 'FOB',
          port: 'Test',
          remark: '',
          attachmentFilesString: ''
        })
      );
    },
    { key: rfqDraftKey, subject: rfqFixture.primaryRfq.subject }
  );
  await page.reload();
  const cleanup = page.getByRole('dialog', { name: cleanupTitle });
  await expect(cleanup).toBeHidden();
  await page.getByRole('button', { name: rfqFixture.primaryRfq.subject, exact: true }).click();
  const sheet = page.getByRole('dialog', { name: rfqFixture.primaryRfq.subject, exact: true });
  const message = sheet.getByText('给买家留言', { exact: false }).locator('textarea');
  await expect(message).toHaveValue('');
  await expect(sheet.getByRole('button', { name: '保存草稿', exact: true })).toHaveCount(0);
  await message.fill('Current session only');
  await sheet.getByRole('button', { name: '关闭详情', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: guardTitle });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(message).toHaveValue('Current session only');
  await sheet.getByRole('button', { name: '关闭详情', exact: true }).click();
  await confirmation.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
  await expect(sheet).toBeHidden();
  await page.getByRole('button', { name: rfqFixture.primaryRfq.subject, exact: true }).click();
  await expect(message).toHaveValue('');
  await sheet.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(confirmation).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'RFQ 工作台' })).toBeVisible();
  await expect(cleanup).toBeHidden();
  expect(await page.evaluate((key) => localStorage.getItem(key), rfqDraftKey)).toContain(
    'legacy-form-must-not-load'
  );
});

test('startup ignores legacy editor data without prompting or deleting queues and preferences', async ({
  page
}) => {
  await page.goto('/#/settings');
  const legacyKeys = [
    'one-vegetable-product-editor-drafts-v3',
    'one-vegetable-product-editor-drafts-v2',
    'one-vegetable-product-schema-draft',
    rfqDraftKey
  ];
  const preservedKeys = [
    'one-vegetable-product-batch-publish-v1',
    'one-vegetable-product-batch-publish-v2',
    'one-vegetable:columns:v1:products',
    'one-vegetable:columns:v2:products'
  ];
  await page.evaluate(
    ({ legacy, preserved }) => {
      for (const key of [...legacy, ...preserved]) localStorage.setItem(key, 'cleanup-scope-sentinel');
    },
    { legacy: legacyKeys, preserved: preservedKeys }
  );
  await page.reload();
  await expect(page.getByLabel('App Key', { exact: true })).toHaveValue(credentialFixture.manual.appKey);
  await expect(page.getByRole('dialog', { name: cleanupTitle })).toBeHidden();
  const values = await page.evaluate(
    (keys) => keys.map((key) => localStorage.getItem(key)),
    [...legacyKeys, ...preservedKeys]
  );
  expect(values).toEqual([...legacyKeys, ...preservedKeys].map(() => 'cleanup-scope-sentinel'));
  expect(
    await page.evaluate(() => localStorage.getItem('one-vegetable:legacy-editor-drafts:notice:v1'))
  ).toBeNull();
  await page.reload();
  await expect(page.getByLabel('App Key', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: cleanupTitle })).toBeHidden();
});

test('presentation changes remain clean, with localized confirmation in dark mode', async ({ page }) => {
  await openSettings(page);
  await page.getByTestId('theme-toggle').click();
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveClass(/dark/u);
  await page.getByTestId('language-toggle').click();
  await page.getByRole('link', { name: 'Orders', exact: true }).click();
  await expect(page).toHaveURL(/#\/orders$/u);
  await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('App Key', { exact: true })).toHaveValue(credentialFixture.manual.appKey);
  await page.getByLabel('App Key', { exact: true }).fill('local-only-edit');
  await page.getByRole('link', { name: 'Orders', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toHaveClass(/bg-background/u);
  await confirmation.getByRole('button', { name: 'Continue editing', exact: true }).click();
  await expect(page).toHaveURL(/#\/settings$/u);
  await expect(page.getByLabel('App Key', { exact: true })).toHaveValue('local-only-edit');
});

test('closing the leave confirmation with X or backdrop cancels navigation without discarding', async ({
  page
}) => {
  await openSettings(page);
  await page.getByLabel('App Key', { exact: true }).fill('keep-on-dialog-dismiss');
  const confirmation = page.getByRole('dialog', { name: guardTitle });
  for (const dismiss of ['close', 'backdrop'] as const) {
    await page.getByRole('link', { name: '订单', exact: true }).click();
    await expect(confirmation).toBeVisible();
    if (dismiss === 'close')
      await confirmation.getByRole('button', { name: `关闭${guardTitle}`, exact: true }).click();
    else await page.mouse.click(6, 6);
    await expect(confirmation).toBeHidden();
    await expect(page).toHaveURL(/#\/settings$/u);
    await expect(page.getByLabel('App Key', { exact: true })).toHaveValue('keep-on-dialog-dismiss');
  }
});

test('query filter drafts and applied filters are not unsaved business edits', async ({ page }) => {
  await page.goto('/#/rfqs');
  await expect(page.getByRole('button', { name: rfqFixture.primaryRfq.subject, exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^筛选/u }).click();
  const filters = page.getByRole('dialog', { name: '筛选', exact: true });
  await filters.getByLabel('国家代码', { exact: true }).fill('CA');
  await filters.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog', { name: guardTitle })).toBeHidden();
  await page.getByRole('button', { name: /^筛选/u }).click();
  await expect(filters.getByLabel('国家代码', { exact: true })).toHaveValue('');
  await filters.getByLabel('国家代码', { exact: true }).fill('CA');
  await filters.getByRole('button', { name: '应用筛选', exact: true }).click();
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await expect(page).toHaveURL(/#\/settings$/u);
  await expect(page.getByLabel('App Key', { exact: true })).toHaveValue(credentialFixture.manual.appKey);
  await expect(page.getByRole('dialog', { name: guardTitle })).toBeHidden();
});

test('switching away from an order draft asks before resetting its editable fields', async ({ page }) => {
  await page.goto('/#/orders');
  await page.getByRole('button', { name: '信保订单草稿', exact: true }).click();
  const subject = page.getByPlaceholder('商品名称', { exact: true });
  await expect(subject).toHaveValue('');
  await subject.fill('Unsaved test order title');
  const oldUrl = page.url();
  await page.getByRole('button', { name: '订单与聚合详情', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: guardTitle });
  await expect(confirmation).toBeVisible();
  await expect(page).toHaveURL(oldUrl);
  await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(subject).toHaveValue('Unsaved test order title');
  await page.getByRole('button', { name: '订单与聚合详情', exact: true }).click();
  await confirmation.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
  await expect(subject).toBeHidden();
  await page.getByRole('button', { name: '信保订单草稿', exact: true }).click();
  await expect(subject).toHaveValue('');
  // This test never clicks order creation or performs even a simulated trade.
});

test('logistics quote and draft share edits, while leaving their workflow requires confirmation', async ({
  page
}) => {
  await page.goto('/#/logistics');
  const cargoName = page.getByLabel('英文品名', { exact: true });
  await expect(cargoName).toBeVisible();
  const baseline = await cargoName.inputValue();
  await cargoName.fill('Unsaved cargo description');
  await page.getByRole('button', { name: '下单草稿', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: guardTitle });
  await expect(confirmation).toBeHidden();
  await page.getByRole('button', { name: '运费试算', exact: true }).click();
  await expect(cargoName).toHaveValue('Unsaved cargo description');
  await page.getByRole('button', { name: '物流订单', exact: true }).click();
  await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(cargoName).toHaveValue('Unsaved cargo description');
  await page.getByRole('button', { name: '物流订单', exact: true }).click();
  await confirmation.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
  await page.getByRole('button', { name: '运费试算', exact: true }).click();
  await expect(cargoName).toHaveValue(baseline);
  // Quote calculation and order submission are intentionally not triggered.
});
