import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

if (process.platform !== 'win32') {
  throw new Error('真实 Web Smoke 只能在 Windows 环境运行');
}
if (existsSync('.env')) loadEnvFile('.env');
if (process.env.ONE_VEGETABLE_REAL_WEB_SMOKE !== '1') {
  throw new Error('真实 Web Smoke 必须显式设置 ONE_VEGETABLE_REAL_WEB_SMOKE=1');
}

const root = resolve(import.meta.dirname, '..');
const artifactsDirectory = resolve(root, 'artifacts/real-web-smoke');
const configuredCredentialFile =
  process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ??
  process.env.OPEN_API_OUTPUT ??
  'artifacts/openapi-auth/credentials.json';
const credentialFile = isAbsolute(configuredCredentialFile)
  ? configuredCredentialFile
  : resolve(root, configuredCredentialFile);

if (!existsSync(credentialFile)) {
  throw new Error('未找到 Alibaba 授权包，请先运行 pnpm openapi:auth');
}

await mkdir(artifactsDirectory, { recursive: true });
for (const fileName of [
  'one-vegetable.sqlite',
  'one-vegetable.sqlite-shm',
  'one-vegetable.sqlite-wal',
  'report.json',
  'report.json.tmp'
]) {
  const target = resolve(artifactsDirectory, fileName);
  const targetRelativePath = relative(artifactsDirectory, target);
  if (targetRelativePath.startsWith('..') || isAbsolute(targetRelativePath)) {
    throw new Error(`拒绝清理真实 Web Smoke 目录之外的路径：${target}`);
  }
  await rm(target, { force: true });
}

process.stdout.write(
  process.env.ONE_VEGETABLE_REAL_PRODUCT_TRANSFER_ZIP_SMOKE === '1'
    ? '真实 Web Smoke 隔离环境已准备完成；仅开放本次图库上传。\n'
    : '真实 Web Smoke 隔离环境已准备完成；mutation flags 保持为空。\n'
);
