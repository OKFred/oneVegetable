import { chmod, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import type { AlibabaCredentialAcquisitionPrerequisiteReason } from '../../packages/core/src/alibaba-credential-acquisition';

export interface AtomicWriteJsonOptions {
  platform?: NodeJS.Platform;
  rename?: (source: string, target: string) => Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
  unlink?: (path: string) => Promise<void>;
}

const renameRetryDelays = [50, 100, 200, 400] as const;

export async function atomicWriteJson(
  path: string,
  value: unknown,
  options: AtomicWriteJsonOptions = {}
): Promise<void> {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  // Exclusive creation establishes ownership: never clean up a pre-existing file.
  const file = await open(temporaryPath, 'wx', 0o600);
  try {
    try {
      await file.writeFile(serialized, 'utf8');
    } finally {
      await file.close();
    }
    const replace = options.rename ?? rename;
    const sleep = options.sleep ?? setTimeout;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await replace(temporaryPath, path);
        break;
      } catch (error) {
        const delay = renameRetryDelays[attempt];
        if (
          (options.platform ?? process.platform) !== 'win32' ||
          delay === undefined ||
          !isTransientWindowsRenameError(error)
        )
          throw error;
        // Retry ONLY this same rename, never serialization, writing or a caller's HTTP operation.
        await sleep(delay);
      }
    }
  } catch (error) {
    try {
      await (options.unlink ?? unlink)(temporaryPath);
    } catch {
      // Keep the original failure. A locked owned temp may remain; never remove the target.
    }
    throw error;
  }
  await bestEffortPrivatePermissions(path);
}

function isTransientWindowsRenameError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EBUSY')
  );
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
    message: string,
    readonly prerequisiteReason: AlibabaCredentialAcquisitionPrerequisiteReason | null = null
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
