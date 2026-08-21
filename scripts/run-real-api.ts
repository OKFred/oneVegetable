import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

if (existsSync('.env')) loadEnvFile('.env');

const configuredPath =
  process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ??
  process.env.OPEN_API_OUTPUT ??
  'artifacts/openapi-auth/credentials.json';
const credentialFile = isAbsolute(configuredPath) ? configuredPath : resolve(process.cwd(), configuredPath);
if (!existsSync(credentialFile)) {
  throw new Error('未找到 Alibaba 授权包，请先运行 pnpm openapi:auth');
}

const windows = process.platform === 'win32';
const command = windows ? (process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe') : 'pnpm';
const args = windows
  ? ['/d', '/s', '/c', 'pnpm --filter @one-vegetable/api dev:node']
  : ['--filter', '@one-vegetable/api', 'dev:node'];
const child = spawn(command, args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ONE_VEGETABLE_ENVIRONMENT: 'local-node',
    ONE_VEGETABLE_GATEWAY_MODE: 'real',
    ONE_VEGETABLE_MUTATION_FLAGS:
      process.env.ONE_VEGETABLE_MUTATION_FLAGS ??
      'operation:operatePhotoGroup,operation:uploadPhoto,operation:transferPhotoFromUrl,operation:saveProductDraft',
    ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: credentialFile
  },
  stdio: 'inherit',
  windowsHide: true
});

child.once('error', (error) => {
  process.stderr.write(`启动本地真实 BFF 失败：${error.message}\n`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) process.stderr.write(`本地真实 BFF 已由信号 ${signal} 停止。\n`);
  process.exitCode = code ?? 1;
});
