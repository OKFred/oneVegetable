import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

if (process.platform !== 'win32') {
  throw new Error('真实商品 ZIP Smoke 只能在 Windows 环境运行');
}
if (existsSync('.env')) loadEnvFile('.env');
if (process.env.ONE_VEGETABLE_REAL_PRODUCT_TRANSFER_ZIP_SMOKE !== '1') {
  throw new Error('真实商品 ZIP Smoke 必须显式设置 ONE_VEGETABLE_REAL_PRODUCT_TRANSFER_ZIP_SMOKE=1');
}

process.env.ONE_VEGETABLE_REAL_WEB_SMOKE = '1';
await import('./prepare-real-web-smoke');

const command = process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe';
const child = spawn(
  command,
  [
    '/d',
    '/s',
    '/c',
    'pnpm exec playwright test --config playwright.real.config.ts tests/e2e-real/product-transfer-zip.spec.ts'
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    windowsHide: true
  }
);

const exitCode = await new Promise<number>((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (signal) reject(new Error(`真实商品 ZIP Smoke 已由信号 ${signal} 停止`));
    else resolve(code ?? 1);
  });
});
process.exitCode = exitCode;
