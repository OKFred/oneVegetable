import { expect, type Page } from '@playwright/test';

/** Use the public settings UI; all credentials passed here are test fixtures. */
export async function prepareExtensionVault(page: Page, passphrase = 'e2e-vault-password'): Promise<void> {
  const setup = page.getByTestId('vault-passphrase-setup');
  await expect(setup.or(page.getByText('已解锁', { exact: true }))).toBeVisible();
  if (await setup.isVisible()) {
    await setup.locator('input').nth(0).fill(passphrase);
    await page.getByLabel('确认保护口令', { exact: true }).fill(passphrase);
    await setup.getByTestId('save-vault-near-passphrase').click();
    await expect(page.getByText('已解锁', { exact: true })).toBeVisible();
  }
}

export async function openExtensionCredentialEditor(
  page: Page,
  protocol: 'top' | 'iop' = 'top'
): Promise<void> {
  await page.getByTestId(`select-authorization-${protocol}`).click();
  await page
    .getByRole('dialog', { name: `${protocol.toUpperCase()} 授权配置`, exact: true })
    .getByRole('button', { name: '手动填写', exact: true })
    .click();
}

export async function closeExtensionCredentialConfiguration(
  page: Page,
  protocol: 'top' | 'iop' = 'top'
): Promise<void> {
  const dialog = page.getByRole('dialog', { name: `${protocol.toUpperCase()} 授权配置`, exact: true });
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(dialog).toBeHidden();
}

export async function importExtensionAuthorization(
  page: Page,
  bundle: unknown,
  passphrase?: string
): Promise<void> {
  await page.getByTestId('get-alibaba-credentials').click();
  const dialog = page.getByRole('dialog', { name: '连接 Alibaba 账号', exact: true });
  await expect(
    dialog.locator('[data-testid="authorization-protection"], [data-testid="authorization-method-file"]')
  ).toBeVisible();
  if (await dialog.getByTestId('authorization-protection').isVisible()) {
    if (passphrase) await dialog.getByTestId('authorization-protection-passphrase').fill(passphrase);
    await dialog.getByTestId('continue-authorization-protection').click();
  }
  await dialog.getByTestId('authorization-method-file').click();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'credentialInfo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle))
  });
  await dialog.getByTestId('confirm-authorization-file-import').click();
  await expect(dialog).toBeHidden();
}
