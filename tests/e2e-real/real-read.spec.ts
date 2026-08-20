import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page, type Response } from '@playwright/test';

interface OperationResult {
  operation: string;
  requestId: string | null;
  statusCode: number;
  outcome: 'passed' | 'permission-denied' | 'provider-error' | 'denied';
  errorCode: string | null;
  mockSentinelDetected: boolean;
}

interface RealWebSmokeReport {
  schemaVersion: 1;
  capturedAtUtc: string;
  gatewaySource: 'credential-bundle';
  results: OperationResult[];
}

const apiOrigin = 'http://127.0.0.1:8797';
const webOrigin = 'http://127.0.0.1:4175';
const reportPath = resolve('artifacts/real-web-smoke/report.json');
const mockSentinels = ['mock-solar-station', 'RFQ-20260812-001', 'Northwind Trading', 'supplier-enc-001'];

test('authenticated Web renders real read results without Mock fallback', async ({ page, context }) => {
  const results: OperationResult[] = [];
  const captureTasks = new Set<Promise<void>>();
  const captureErrors: string[] = [];
  page.on('response', (response) => {
    if (!response.url().endsWith('/api/v1/operations/call')) return;
    const task = captureOperation(response, results)
      .catch((cause: unknown) => {
        captureErrors.push(cause instanceof Error ? cause.message : '无法读取 operation 响应');
      })
      .finally(() => captureTasks.delete(task));
    captureTasks.add(task);
  });

  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '一根青菜 BFF' })).toBeVisible();
    await page.getByRole('button', { name: '初始化管理员' }).click();
    await page.getByLabel('一次性 Bootstrap Token').fill('real-web-smoke-bootstrap');
    await page.getByLabel('用户名').fill('real-read-admin');
    await page.getByLabel('密码').fill('Real-read-admin-2026!');
    await page.getByRole('button', { name: '创建管理员' }).click();

    await expect(page.getByRole('heading', { name: '运营总览' })).toBeVisible();
    await expect(page.getByText('BFF 在线')).toBeVisible();
    await expectOperation(results, 'getDashboard', 'passed');

    await openDomain(page, '商品', '商品管理');
    await expectOperation(results, 'listProducts', 'passed');
    await expectNoMockSentinel(results, 'listProducts');

    await openDomain(page, '图库', '图库');
    await expectOperation(results, 'listPhotoGroups', 'passed');
    await expectOperation(results, 'listPhotos', 'passed');
    await expectNoMockSentinel(results, 'listPhotos');

    await openDomain(page, '订单', '交易 / 订单工作台');
    await expectOperation(results, 'listTradeOrders', 'passed');
    await expectNoMockSentinel(results, 'listTradeOrders');

    await openDomain(page, 'RFQ', 'RFQ 工作台');
    await expectOperation(results, 'listRfqs', 'observed');

    await openDomain(page, '数据洞察', '数据与供应商洞察');
    await expectOperation(results, 'getInsightsSupplierRank', 'observed');

    await openDomain(page, '管理后台', '管理后台');
    await expect(page.getByText('node / local-node', { exact: true })).toBeVisible();
    await expect(page.getByText('sqlite / v3', { exact: true })).toBeVisible();
    await expect(page.getByText('real', { exact: true })).toBeVisible();
    await expect(page.getByText(/凭据 完整 · 只读真实调用 已启用/)).toBeVisible();

    const csrfCookie = (await context.cookies(`${apiOrigin}/api/v1/operations/call`)).find(
      (cookie) => cookie.name === 'ov_csrf'
    );
    if (!csrfCookie) throw new Error('真实 Web 会话缺少 CSRF Cookie');
    const mutationRequestId = crypto.randomUUID();
    const mutationResponse = await page.request.post(`${apiOrigin}/api/v1/operations/call`, {
      headers: { Origin: webOrigin, 'X-CSRF-Token': csrfCookie.value },
      data: {
        requestId: mutationRequestId,
        operation: 'createProductGroup',
        payload: { name: 'must-not-be-created' }
      }
    });
    const mutationBody: unknown = await mutationResponse.json();
    expect(mutationResponse.status()).toBe(403);
    expect(mutationResponse.headers()['x-request-id']).toBe(mutationRequestId);
    expect(readErrorCode(mutationBody)).toBe('MUTATION_FLAG_DISABLED');
    results.push({
      operation: 'createProductGroup',
      requestId: mutationRequestId,
      statusCode: mutationResponse.status(),
      outcome: 'denied',
      errorCode: readErrorCode(mutationBody),
      mockSentinelDetected: false
    });
  } finally {
    await Promise.all(captureTasks);
    await writeReport(results);
  }

  expect(captureErrors).toEqual([]);
});

async function openDomain(page: Page, navigation: string, heading: string): Promise<void> {
  await page.getByRole('button', { name: navigation, exact: true }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

async function expectOperation(
  results: readonly OperationResult[],
  operation: string,
  expected: 'passed' | 'observed'
): Promise<void> {
  await expect
    .poll(
      () =>
        results.some(
          (result) =>
            result.operation === operation && (expected === 'observed' || result.outcome === expected)
        ),
      { message: `${operation} should be ${expected}` }
    )
    .toBe(true);
}

async function captureOperation(response: Response, results: OperationResult[]): Promise<void> {
  const requestBody = readRecord(response.request().postDataJSON());
  const operation = readString(requestBody, 'operation') ?? 'unknown';
  const responseBody: unknown = await response.json();
  const body = readRecord(responseBody);
  const serialized = JSON.stringify(responseBody);
  const errorCode = readErrorCode(responseBody);
  results.push({
    operation,
    requestId: readString(body, 'requestId'),
    statusCode: response.status(),
    outcome: response.ok() ? 'passed' : errorCode === '11' ? 'permission-denied' : 'provider-error',
    errorCode,
    mockSentinelDetected: response.ok() && mockSentinels.some((sentinel) => serialized.includes(sentinel))
  });
}

async function expectNoMockSentinel(results: readonly OperationResult[], operation: string): Promise<void> {
  await expect
    .poll(() => results.find((result) => result.operation === operation)?.mockSentinelDetected, {
      message: `${operation} should not contain a Mock sentinel`
    })
    .toBe(false);
}

function readErrorCode(value: unknown): string | null {
  const error = readRecord(readRecord(value).error);
  return readString(error, 'code');
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === 'string' ? record[key] : null;
}

async function writeReport(results: readonly OperationResult[]): Promise<void> {
  const report: RealWebSmokeReport = {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    gatewaySource: 'credential-bundle',
    results: [...results]
  };
  const temporaryPath = `${reportPath}.tmp`;
  await mkdir(resolve(reportPath, '..'), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, reportPath);
}
