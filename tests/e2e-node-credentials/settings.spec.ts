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
    await panel.locator('summary').click();
    const en = locale === 'en-US';
    await panel.getByRole('button', { name: en ? 'Enter manually' : '手动填写', exact: true }).click();
    const form = page.getByRole('dialog').filter({ has: page.locator('form') });
    const passwords = form.locator('input[type="password"]');
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
      buffer: Buffer.from(JSON.stringify(fixture.oauthBundle))
    });
    await expect(confirm).toBeVisible();
    expect(writes.some((path) => path.endsWith('/import'))).toBe(false);
    await confirm.getByRole('button', { name: en ? 'Confirm' : '确认', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(panel).toContainText(fixture.oauthBundle.application.appName);
    await expect(panel).not.toContainText(fixture.manual.accessToken);
    await panel.getByRole('button', { name: en ? 'Clear configuration' : '清除配置', exact: true }).click();
    await clear.getByRole('button', { name: en ? 'Confirm' : '确认', exact: true }).click();
    await expect(panel.getByText(en ? 'Not configured' : '尚未配置', { exact: true })).toBeVisible();

    // Exercise the actual BFF missing-S3 response, not an intercepted error or a live storage account.
    await page.goto('/#/photos');
    await page.getByRole('button', { name: en ? 'Import' : '导入', exact: true }).click();
    const galleryImport = page.getByRole('dialog', {
      name: en ? 'Import gallery assets' : '导入图库素材',
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
  });
}
