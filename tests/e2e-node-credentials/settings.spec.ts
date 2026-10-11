import { expect, test } from '@playwright/test';
import fixture from '../../mock/data/node-gateway-credentials.json' with { type: 'json' };
import { completeOnboarding, ONBOARDING_STORAGE_KEY } from '../../packages/core/src/privacy';

for (const locale of ['zh-CN', 'en-US'] as const) {
  test(`${locale}: administrator saves and clears Node credentials through confirmations`, async ({
    page
  }) => {
    const http = page.context().request;
    const api = 'http://127.0.0.1:8786/api/v1';
    const auth = fixture.workbench;
    const bootstrap = await http.post(`${api}/auth/bootstrap`, {
      data: {
        requestId: crypto.randomUUID(),
        bootstrapToken: 'node-credential-e2e-bootstrap-32-bytes',
        ...auth
      }
    });
    if (!bootstrap.ok())
      expect(
        (await http.post(`${api}/auth/login`, { data: { requestId: crypto.randomUUID(), ...auth } })).ok()
      ).toBe(true);
    test.setTimeout(90000);
    await page.addInitScript(
      ({ key, state, locale }) => {
        localStorage.setItem(key, JSON.stringify(state));
        localStorage.setItem(
          'one-vegetable:preferences:v2',
          JSON.stringify({ version: 2, uiLocale: locale, alibabaLanguage: 'zh_CN', theme: 'dark' })
        );
      },
      { key: ONBOARDING_STORAGE_KEY, state: completeOnboarding(), locale }
    );
    const writes: string[] = [];
    page.on('request', (r) => {
      if (/gateway-credentials\/(?:save|import|clear|test)$/u.test(r.url()))
        writes.push(new URL(r.url()).pathname);
    });
    await page.goto('/#/settings');
    const panel = page.getByTestId('gateway-credential-panel');
    await expect(panel).toBeVisible();
    const en = locale === 'en-US';
    const manual = panel.getByRole('button', { name: en ? 'Enter manually' : '手动填写', exact: true });
    await expect(manual).toBeVisible();
    await expect(panel.locator('details').filter({ has: manual })).toHaveCount(0);
    await manual.click();
    const form = page.getByRole('dialog').filter({ has: page.locator('form') });
    const passwords = form.locator('input[type="password"]');
    const discard = page.getByRole('dialog', {
      name: en ? 'Discard unsaved changes?' : '放弃未保存的修改？',
      exact: true
    });
    for (const action of ['cancel', 'close', 'escape', 'overlay'] as const) {
      if (action !== 'cancel') await manual.click();
      if (action === 'cancel')
        await form.getByRole('button', { name: en ? 'Cancel' : '取消', exact: true }).click();
      else if (action === 'close')
        await form.getByRole('button', { name: en ? 'Close Enter manually' : '关闭手动填写' }).click();
      else if (action === 'escape') await page.keyboard.press('Escape');
      else await page.locator('.ov-dialog-overlay').click({ position: { x: 5, y: 5 } });
      await expect(form).toBeHidden();
      await expect(discard).toBeHidden();
    }
    for (const action of ['cancel', 'close', 'escape', 'overlay'] as const) {
      await manual.click();
      await passwords.nth(0).fill(fixture.manual.appKey);
      if (action === 'cancel')
        await form.getByRole('button', { name: en ? 'Cancel' : '取消', exact: true }).click();
      else if (action === 'close')
        await form.getByRole('button', { name: en ? 'Close Enter manually' : '关闭手动填写' }).click();
      else if (action === 'escape') await page.keyboard.press('Escape');
      else await page.locator('.ov-dialog-overlay').click({ position: { x: 5, y: 5 } });
      await expect(discard).toBeVisible();
      // The discard dialog must own focus and accept keyboard interaction, not sit behind the form.
      await expect(discard).toContainText(en ? 'Continue editing' : '继续编辑');
      expect(await discard.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      if (action === 'cancel')
        await discard
          .getByRole('button', { name: en ? 'Continue editing' : '继续编辑', exact: true })
          .click();
      else if (action === 'close')
        await discard
          .getByRole('button', {
            name: en ? 'Close Discard unsaved changes?' : '关闭放弃未保存的修改？',
            exact: true
          })
          .click();
      else if (action === 'escape') await page.keyboard.press('Escape');
      else
        await page
          .locator('.ov-dialog-overlay')
          .last()
          .click({ position: { x: 5, y: 5 } });
      await expect(discard).toBeHidden();
      await expect(passwords.nth(0)).toHaveValue(fixture.manual.appKey);
      await form.getByRole('button', { name: en ? 'Cancel' : '取消', exact: true }).click();
      await discard
        .getByRole('button', { name: en ? 'Discard changes and leave' : '放弃修改并离开', exact: true })
        .click();
      await expect(form).toBeHidden();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(writes).toEqual([]);
    }
    await manual.click();
    await expect(passwords.nth(0)).toHaveValue('');
    await passwords.nth(0).fill(fixture.manual.appKey);
    await passwords.nth(1).fill(fixture.manual.appSecret);
    await passwords.nth(2).fill(fixture.manual.accessToken);
    await form
      .getByRole('button', { name: en ? 'Save and activate' : '保存并立即生效', exact: true })
      .click();
    expect(writes).toEqual([]);
    const confirm = page.getByRole('dialog', {
      name: en ? 'Replace server credentials?' : '确认更换服务端凭据？',
      exact: true
    });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: en ? 'Confirm' : '确认', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      panel.getByText(en ? 'Encrypted SQLite configuration' : 'SQLite 加密配置', { exact: true })
    ).toBeVisible();
    expect(writes.filter((path) => path.endsWith('/save'))).toHaveLength(1);
    expect(writes.some((path) => path.endsWith('/test'))).toBe(false);
    await expect(panel).not.toContainText(fixture.manual.appSecret);
    await expect(panel.getByTestId('credential-expiry')).toContainText(en ? 'Expiry unknown' : '有效期未知');
    await page.goto('/#/dashboard');
    await expect(page.getByRole('menuitem', { name: en ? 'Sign out' : '退出', exact: true })).toBeHidden();
    let renewalRequests = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/admin/gateway-credentials/refresh')) renewalRequests += 1;
    });
    await page.getByTestId('dashboard-renew-authorization').click();
    const renewal = page.getByRole('dialog', { name: en ? 'Renew authorization' : '授权续期', exact: true });
    await expect(renewal).toContainText(en ? 'Reauthorize and import' : '重新授权后导入');
    expect(renewalRequests).toBe(0);
    await renewal
      .getByRole('link', { name: en ? 'Credential settings' : '前往凭据配置', exact: true })
      .click();
    await expect(page).toHaveURL(/\/#\/settings$/u);
    await expect(renewal).toBeHidden();
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: en ? 'Clear configuration' : '清除配置', exact: true }).click();
    const clear = page.getByRole('dialog', {
      name: en ? 'Clear server credentials?' : '确认清除服务端凭据？',
      exact: true
    });
    await clear.getByRole('button', { name: en ? 'Cancel' : '取消', exact: true }).click();
    expect(writes.some((path) => path.endsWith('/clear'))).toBe(false);
    await panel.getByRole('button', { name: en ? 'Clear configuration' : '清除配置', exact: true }).click();
    await clear.getByRole('button', { name: en ? 'Confirm' : '确认', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(panel.getByText(en ? 'Not configured' : '尚未配置', { exact: true })).toBeVisible();
    await page.reload();
    await expect(panel.getByText(en ? 'Not configured' : '尚未配置', { exact: true })).toBeVisible();
    await panel.locator('input[type="file"]').setInputFiles({
      name: 'credentialInfo.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          ...fixture.oauthBundle,
          oauth: { ...fixture.oauthBundle.oauth, expiresAtUtc: fixture.knownExpiry }
        })
      )
    });
    await expect(confirm).toBeVisible();
    expect(writes.some((path) => path.endsWith('/import'))).toBe(false);
    await confirm.getByRole('button', { name: en ? 'Confirm' : '确认', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(panel).toContainText(fixture.oauthBundle.application.appName);
    await expect(panel.getByTestId('credential-expiry')).toContainText('2030-01-02');
    await page.reload();
    await expect(panel.getByTestId('credential-expiry')).toContainText('2030-01-02');
    await expect(panel).not.toContainText(fixture.manual.accessToken);
    await panel.getByRole('button', { name: en ? 'Clear configuration' : '清除配置', exact: true }).click();
    await clear.getByRole('button', { name: en ? 'Confirm' : '确认', exact: true }).click();
    await expect(panel.getByText(en ? 'Not configured' : '尚未配置', { exact: true })).toBeVisible();

    // Exercise the actual BFF missing-S3 response, not an intercepted error or a live storage account.
    await page.goto('/#/photos');
    await page.getByRole('button', { name: en ? 'Import' : '导入', exact: true }).click();
    const galleryImport = page.getByRole('dialog', {
      name: en ? 'Import image assets' : '导入图片素材',
      exact: true
    });
    await galleryImport.getByRole('button', { name: 'S3', exact: true }).click();
    const scanResponse = page.waitForResponse((response) =>
      response.url().endsWith('/admin/storage/s3/objects/list')
    );
    await galleryImport.getByRole('button', { name: en ? 'Scan S3' : '扫描 S3', exact: true }).click();
    expect((await scanResponse).ok()).toBe(false);
    const error = galleryImport.getByRole('alert');
    await expect(error).toContainText(
      en ? 'Configure S3 asset storage in Settings first.' : '请先在设置中配置 S3 素材存储。'
    );
    await expect(error).toContainText('S3_STORAGE_NOT_CONFIGURED');
    await expect(error).not.toContainText('errors.codes.');
    await error
      .getByRole('link', { name: en ? 'S3 asset storage' : 'S3 素材存储', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/gallery-s3-error-${locale}.png` });
    await error.getByRole('link', { name: en ? 'S3 asset storage' : 'S3 素材存储', exact: true }).click();
    await expect(page).toHaveURL(/\/#\/settings$/u);
    await expect(galleryImport).toBeHidden();
    await page.getByTestId('account-menu-trigger').click();
    const logoutResponse = page.waitForResponse((response) => response.url().endsWith('/auth/logout'));
    await page.getByRole('menuitem', { name: en ? 'Sign out' : '退出', exact: true }).click();
    expect((await logoutResponse).ok()).toBe(true);
    await expect(page.getByTestId('account-menu-trigger')).toBeHidden();
    await expect(
      page.getByRole('textbox', { name: en ? 'Workspace username' : '工作台用户名', exact: true })
    ).toBeVisible();
  });
}
