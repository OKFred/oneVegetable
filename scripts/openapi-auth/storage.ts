import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await rename(temporaryPath, path);
  await bestEffortPrivatePermissions(path);
}

export function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof OpenApiAuthError) {
    return { code: error.code, message: redactText(error.message) };
  }
  if (error instanceof Error) {
    return { code: 'UNEXPECTED_ERROR', message: redactText(error.message) };
  }
  return { code: 'UNEXPECTED_ERROR', message: '未知错误' };
}

export function redactText(value: string): string {
  return value
    .replace(/([?&](?:code|access_token|refresh_token|token|state)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(
      /((?:app[_ -]?secret|password|authorization|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*)[^\s,;]+/gi,
      '$1[REDACTED]'
    )
    .slice(0, 1_000);
}

export class OpenApiAuthError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'OpenApiAuthError';
  }
}

async function bestEffortPrivatePermissions(path: string): Promise<void> {
  try {
    await chmod(path, 0o600);
  } catch {
    // Windows ACL 不映射 POSIX mode；文件仍位于 gitignored 的本地 artifacts 目录。
  }
}
