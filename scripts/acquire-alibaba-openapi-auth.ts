import { existsSync } from 'node:fs';
import { loadEnvFile, stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { readOpenApiAuthConfiguration } from './openapi-auth/config';
import {
  acquireAlibabaCredentialWithNodePlaywright,
  createNodePlaywrightAuthProgress
} from './openapi-auth/node-playwright-driver';
import { atomicWriteJson, OpenApiAuthError, safeError } from './openapi-auth/storage';

import type { OpenApiAuthDiagnostic } from './openapi-auth/types';

loadLocalEnvironment();

const configuration = readOpenApiAuthConfiguration(process.env, process.cwd());
let progress = createNodePlaywrightAuthProgress();

try {
  const result = await acquireAlibabaCredentialWithNodePlaywright(configuration, {
    confirmCallbackChange,
    onProgress: (next) => {
      progress = next;
    }
  });
  progress = result.progress;
  await atomicWriteJson(configuration.outputPath, result.bundle);
  progress = { ...progress, stage: 'complete' };
  await writeDiagnostic(true, null);
  process.stdout.write(`OpenAPI 授权包已保存：${configuration.outputPath}\n`);
  process.stdout.write('该文件包含明文密钥，仅限本机开发使用。\n');
} catch (error: unknown) {
  const safe = safeError(error);
  await writeDiagnostic(false, safe);
  process.stderr.write(`OpenAPI 授权失败：${safe.code} ${safe.message}\n`);
  process.exitCode = 1;
}

async function confirmCallbackChange(currentUrl: URL, requestedUrl: URL): Promise<boolean> {
  process.stdout.write(`当前 Callback：${currentUrl.href}\n`);
  process.stdout.write(`请求修改为：${requestedUrl.href}\n`);
  if (process.env.OPEN_API_CALLBACK_CHANGE_CONFIRMED === '1') return true;
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new OpenApiAuthError(
      'CALLBACK_CONFIRMATION_REQUIRED',
      '非交互环境修改 Callback 时，必须显式设置 OPEN_API_CALLBACK_CHANGE_CONFIRMED=1'
    );
  }
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await prompt.question('确认修改 Callback？输入 yes 继续，其余输入将保留现值：')).trim();
    const confirmed = /^yes$/iu.test(answer);
    if (!confirmed) process.stdout.write('已保留应用现有 Callback。\n');
    return confirmed;
  } finally {
    prompt.close();
  }
}

async function writeDiagnostic(ok: boolean, error: OpenApiAuthDiagnostic['error']): Promise<void> {
  const diagnostic: OpenApiAuthDiagnostic = {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    ok,
    stage: progress.stage,
    targetUrl: configuration.targetUrl.href,
    currentUrl: safeUrl(progress.currentUrl),
    selectedApplication: progress.selectedApplication,
    callback: progress.callback,
    error,
    savedFiles: [
      configuration.diagnosticPath,
      ...(progress.screenshotSaved ? [configuration.screenshotPath] : [])
    ]
  };
  await atomicWriteJson(configuration.diagnosticPath, diagnostic);
}

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function loadLocalEnvironment(): void {
  if (!existsSync('.env')) return;
  loadEnvFile('.env');
}
