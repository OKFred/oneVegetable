import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page, type Response } from '@playwright/test';
import { unzipSync } from 'fflate';

interface UploadRecord {
  requestId: string | null;
  statusCode: number;
  ok: boolean;
  fileId: string | null;
}

interface ProductTransferZipSmokeReport {
  schemaVersion: 1;
  capturedAtUtc: string;
  status: 'preflight-ready' | 'mutation-started' | 'mutation-failed' | 'passed';
  sourceProductId: string;
  sourceTitleSha256: string;
  archiveSha256: string;
  archiveByteLength: number;
  assetCount: number;
  uploadRecords: UploadRecord[];
  queueItemCount: number;
  error: string | null;
}

const enabled = process.env.ONE_VEGETABLE_REAL_PRODUCT_TRANSFER_ZIP_SMOKE === '1';
const runDate = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const reportPath = resolve(
  process.env.ONE_VEGETABLE_REAL_PRODUCT_TRANSFER_ZIP_OUTPUT ??
    `artifacts/real-smoke/product-transfer-zip-${runDate}.report.json`
);
const archivePath = resolve(
  process.env.ONE_VEGETABLE_REAL_PRODUCT_TRANSFER_ZIP_FILE ??
    `artifacts/real-smoke/product-transfer-zip-${runDate}.zip`
);

test.use({ trace: 'off' });
test.skip(!enabled, '真实商品 ZIP Smoke 需要显式 opt-in');

test('real Web exports one product ZIP and imports its assets into the gallery', async ({ page }) => {
  test.setTimeout(240_000);
  const existing = await readExistingReport();
  if (existing && ['mutation-started', 'mutation-failed', 'passed'].includes(existing.status)) {
    throw new Error(`已有 ${existing.status} 报告；为避免重复上传，拒绝自动重跑`);
  }

  const uploadRecords: UploadRecord[] = [];
  const captureTasks = new Set<Promise<void>>();
  page.on('response', (response) => {
    if (!isOperation(response, 'uploadPhoto')) return;
    const task = captureUpload(response, uploadRecords).finally(() => captureTasks.delete(task));
    captureTasks.add(task);
  });

  let report: ProductTransferZipSmokeReport = {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    status: 'preflight-ready',
    sourceProductId: '',
    sourceTitleSha256: '',
    archiveSha256: '',
    archiveByteLength: 0,
    assetCount: 0,
    uploadRecords,
    queueItemCount: 0,
    error: null
  };

  try {
    await bootstrap(page);
    await page.getByRole('link', { name: '商品' }).click();
    await expect(page.getByTestId('data-source-status')).toHaveText(/Alibaba 实时数据/);

    const productRows = page
      .getByRole('row')
      .filter({ has: page.getByRole('checkbox', { name: /^选择 /u }) });
    await expect(productRows.first()).toBeVisible({ timeout: 30_000 });
    const row = productRows.first();
    const selector = row.getByRole('checkbox', { name: /^选择 /u });
    const selectionLabel = await selector.getAttribute('aria-label');
    const rowText = await row.innerText();
    const productId = /\b[1-9][0-9]{9,}\b/u.exec(rowText)?.[0] ?? '';
    const sourceTitle = selectionLabel?.replace(/^选择 /u, '') ?? '';
    if (!productId || !sourceTitle) throw new Error('真实商品行缺少可验证的 ID 或标题');
    await selector.check();

    await page.getByRole('button', { name: '导出', exact: true }).click();
    const exportDialog = page.getByRole('dialog', { name: '导出商品' });
    await exportDialog.locator('summary').click();
    await exportDialog.getByLabel('ZIP 资源包').check();
    await exportDialog.getByRole('button', { name: '导出', exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 120_000 }),
      page
        .getByRole('dialog', { name: '确认导出' })
        .getByRole('button', { name: '确认导出', exact: true })
        .click()
    ]);
    await mkdir(resolve(archivePath, '..'), { recursive: true });
    await download.saveAs(archivePath);
    const archiveBytes = new Uint8Array(await readFile(archivePath));
    const archive = unzipSync(archiveBytes);
    const manifestBytes = archive['products.json'];
    if (!manifestBytes) throw new Error('真实商品 ZIP 缺少 products.json');
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      schemaVersion?: number;
      products?: { source?: { productId?: string }; schemaJson?: unknown; schemaXml?: string }[];
    };
    const assetPaths = Object.keys(archive).filter((path) => path.startsWith('assets/'));
    if (manifest.schemaVersion !== 2 || manifest.products?.length !== 1) {
      throw new Error('真实商品 ZIP 清单版本或商品数量不正确');
    }
    if (manifest.products[0]?.source?.productId !== productId) {
      throw new Error('真实商品 ZIP 的来源商品 ID 与所选行不一致');
    }
    if (assetPaths.length === 0 || !JSON.stringify(manifest.products[0]).includes('assets/')) {
      throw new Error('真实商品 ZIP 没有导出可回填的图库资源');
    }

    report = {
      ...report,
      capturedAtUtc: new Date().toISOString(),
      sourceProductId: productId,
      sourceTitleSha256: sha256(new TextEncoder().encode(sourceTitle)),
      archiveSha256: sha256(archiveBytes),
      archiveByteLength: archiveBytes.byteLength,
      assetCount: assetPaths.length
    };
    await writeReport(report);

    await page.getByRole('button', { name: '导入', exact: true }).click();
    const importDialog = page.getByRole('dialog', { name: '导入商品' });
    await importDialog.getByLabel('选择商品 JSON 或 ZIP 文件').setInputFiles({
      name: 'product-transfer-real-smoke.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(archiveBytes)
    });
    await expect(importDialog).toContainText(`${assetPaths.length} 张引用图片`);
    await expect(importDialog).toContainText('上传到图库分组');
    await importDialog.getByRole('button', { name: '导入', exact: true }).click();

    report = { ...report, capturedAtUtc: new Date().toISOString(), status: 'mutation-started' };
    await writeReport(report);
    const successMessage = page.getByText(/商品 ZIP 已导入本机队列：新增 1/u);
    const importError = importDialog.getByRole('alert');
    await page
      .getByRole('dialog', { name: '确认导入' })
      .getByRole('button', { name: '确认导入', exact: true })
      .click();
    await Promise.race([
      successMessage.waitFor({ state: 'visible', timeout: 120_000 }),
      importError.waitFor({ state: 'visible', timeout: 120_000 }).then(async () => {
        throw new Error(`图库上传失败：${await importError.innerText()}`);
      })
    ]);
    await Promise.all([...captureTasks]);

    expect(uploadRecords).toHaveLength(assetPaths.length);
    expect(uploadRecords.every((record) => record.ok && record.fileId)).toBe(true);
    const queue = await page.evaluate(() => {
      const raw = localStorage.getItem('one-vegetable-product-batch-publish-v1');
      return raw ? (JSON.parse(raw) as { xml?: string }[]) : [];
    });
    expect(queue).toHaveLength(1);
    expect(queue[0]?.xml).not.toContain('assets/');

    report = {
      ...report,
      capturedAtUtc: new Date().toISOString(),
      status: 'passed',
      uploadRecords: [...uploadRecords],
      queueItemCount: queue.length
    };
    await writeReport(report);
  } catch (error: unknown) {
    const current = await readExistingReport();
    if (current?.status === 'mutation-started') {
      await writeReport({
        ...report,
        capturedAtUtc: new Date().toISOString(),
        status: 'mutation-failed',
        uploadRecords: [...uploadRecords],
        error: safeError(error)
      });
    }
    throw error;
  }
});

async function bootstrap(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '登录运营工作台' })).toBeVisible();
  await page.getByRole('button', { name: '初始化管理员' }).click();
  await page.getByLabel('管理员引导令牌').fill('real-web-smoke-bootstrap');
  await page.getByLabel('工作台用户名').fill('product-transfer-smoke-admin');
  await page.getByLabel('工作台密码').fill('Product-transfer-smoke-2026!');
  await page.getByRole('button', { name: '创建管理员' }).click();
  await expect(page.getByRole('heading', { name: '运营总览' })).toBeVisible();
}

function isOperation(response: Response, operation: string): boolean {
  if (!response.url().endsWith('/api/v1/operations/call')) return false;
  const body = response.request().postDataJSON() as unknown;
  return readString(readRecord(body), 'operation') === operation;
}

async function captureUpload(response: Response, records: UploadRecord[]): Promise<void> {
  const body = readRecord(await response.json());
  const data = readRecord(body.data);
  records.push({
    requestId: readString(body, 'requestId'),
    statusCode: response.status(),
    ok: body.ok === true,
    fileId: readString(data, 'id')
  });
}

async function readExistingReport(): Promise<ProductTransferZipSmokeReport | null> {
  if (!existsSync(reportPath)) return null;
  return JSON.parse(await readFile(reportPath, 'utf8')) as ProductTransferZipSmokeReport;
}

async function writeReport(report: ProductTransferZipSmokeReport): Promise<void> {
  await mkdir(resolve(reportPath, '..'), { recursive: true });
  const temporaryPath = `${reportPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, reportPath);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : '真实商品 ZIP Smoke 失败';
  return message.replace(/[\r\n\t]+/gu, ' ').slice(0, 500);
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === 'string' ? record[key] : null;
}
