import { expect, test, type Page } from '@playwright/test';

const workerOrigin = 'http://127.0.0.1:8796';

test('authenticated Web uses Worker, D1 and documentation replay across every domain', async ({ page }) => {
  const successfulOperations = new Set<string>();
  const failedOperations: string[] = [];
  const operationOrigins = new Set<string>();
  page.on('response', (response) => {
    if (!response.url().endsWith('/api/v1/operations/call')) return;
    operationOrigins.add(new URL(response.url()).origin);
    const request = response.request().postDataJSON() as { operation?: unknown } | null;
    const operation = typeof request?.operation === 'string' ? request.operation : 'unknown';
    if (response.ok()) successfulOperations.add(operation);
    else failedOperations.push(`${operation}:${response.status()}`);
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: '登录运营工作台' })).toBeVisible();

  await page.getByRole('button', { name: '初始化管理员' }).click();
  await page.getByLabel('管理员引导令牌').fill('bff-replay-e2e-bootstrap-token-32-bytes');
  await page.getByLabel('工作台用户名').fill('replay-admin');
  await page.getByLabel(/^工作台密码/).fill('Replay-admin-2026!');
  await page.getByRole('button', { name: '创建管理员' }).click();

  const onboardingDialog = page.getByRole('dialog', { name: '四步连接 Alibaba 开放平台' });
  await expect(onboardingDialog).toBeVisible();
  await expect(onboardingDialog.locator('img')).toHaveCount(4);
  await onboardingDialog.getByRole('checkbox').check();
  await onboardingDialog.getByRole('button', { name: '开始授权向导' }).click();
  const acquisitionDialog = page.getByRole('dialog', { name: '一键连接 Alibaba' });
  await expect(acquisitionDialog).toBeVisible();
  await expect(acquisitionDialog.getByText(/账号和密码只用于当前 HTTPS 请求/u)).toBeVisible();
  await acquisitionDialog.getByRole('button', { name: '取消' }).click();

  await expect(page.getByRole('heading', { name: '运营总览' })).toBeVisible();
  await expect(page.getByTestId('account-avatar')).toHaveAttribute('aria-label', '当前用户：replay-admin');
  await expectOperation(successfulOperations, 'getDashboard');

  await openDomain(page, successfulOperations, '商品', '商品管理', ['listProducts']);
  await openDomain(page, successfulOperations, '图库', '图库', ['listPhotoGroups', 'listPhotos']);
  await openDomain(page, successfulOperations, 'RFQ', 'RFQ 工作台', ['listRfqs', 'getRfqEquity']);
  await openDomain(page, successfulOperations, '订单', '交易 / 订单工作台', ['listTradeOrders']);
  await openDomain(page, successfulOperations, '国际物流', '国际物流工作台', []);
  await page.getByRole('button', { name: '地址与模板' }).click();
  await expectOperation(successfulOperations, 'listShippingTemplates');
  await openDomain(page, successfulOperations, '数据洞察', '数据与供应商洞察', ['getInsightsSupplierRank']);
  await openDomain(page, successfulOperations, 'API 能力', 'API 能力目录', ['listCapabilities']);
  await openDomain(page, successfulOperations, '管理后台', '管理后台', []);

  await expect(page.getByText('cloudflare / test', { exact: true })).toBeVisible();
  await expect(page.getByText('replay', { exact: true })).toBeVisible();
  await expect(page.getByText(/^d1 \/ v[1-9][0-9]*$/)).toBeVisible();
  expect(failedOperations).toEqual([]);
  expect([...operationOrigins]).toEqual([workerOrigin]);
});

test('BFF replay rejects a write operation while preserving its requestId', async ({ request }) => {
  const bootstrapRequestId = crypto.randomUUID();
  const bootstrap = await request.post('http://127.0.0.1:8796/api/v1/auth/bootstrap', {
    data: {
      requestId: bootstrapRequestId,
      bootstrapToken: 'bff-replay-e2e-bootstrap-token-32-bytes',
      username: 'write-guard-admin',
      password: 'Write-guard-2026!',
      remark: 'BFF replay write guard'
    }
  });

  // The serial UI test may already have consumed the bootstrap token. Log in with that administrator then.
  const authentication = bootstrap.ok()
    ? bootstrap
    : await request.post('http://127.0.0.1:8796/api/v1/auth/login', {
        data: {
          requestId: crypto.randomUUID(),
          username: 'replay-admin',
          password: 'Replay-admin-2026!'
        }
      });
  expect(authentication.ok()).toBe(true);
  const authenticationBody = (await authentication.json()) as {
    data?: { session?: { csrfToken?: string } };
  };
  const csrfToken = authenticationBody.data?.session?.csrfToken;
  if (!csrfToken) throw new Error('Authentication response is missing its CSRF token');
  const requestId = crypto.randomUUID();
  const response = await request.post('http://127.0.0.1:8796/api/v1/operations/call', {
    headers: {
      Origin: 'http://127.0.0.1:4174',
      'X-CSRF-Token': csrfToken
    },
    data: {
      requestId,
      operation: 'createProductGroup',
      payload: { name: 'must-not-be-created', parentId: -1 }
    }
  });
  const body = (await response.json()) as {
    requestId: string;
    ok: boolean;
    error?: { code?: string };
  };
  expect(response.status()).toBe(403);
  expect(response.headers()['x-request-id']).toBe(requestId);
  expect(body).toMatchObject({ requestId, ok: false, error: { code: 'MUTATION_FLAG_DISABLED' } });
});

async function openDomain(
  page: Page,
  successfulOperations: Set<string>,
  navigation: string,
  heading: string,
  operations: readonly string[]
): Promise<void> {
  await page.getByRole('link', { name: navigation, exact: true }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  for (const operation of operations) await expectOperation(successfulOperations, operation);
}

async function expectOperation(successfulOperations: Set<string>, operation: string): Promise<void> {
  await expect
    .poll(() => successfulOperations.has(operation), { message: `${operation} should succeed` })
    .toBe(true);
}
