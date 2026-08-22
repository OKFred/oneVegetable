import { writeFile } from 'node:fs/promises';

const RETRYABLE_WINDOWS_WRITE_CODES = new Set(['EACCES', 'EBUSY', 'EPERM', 'UNKNOWN']);
const MAX_WRITE_ATTEMPTS = 6;

export async function writeTextFileWithRetry(path: string, contents: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    try {
      await writeFile(path, contents, 'utf8');
      return;
    } catch (error: unknown) {
      if (attempt === MAX_WRITE_ATTEMPTS || !isRetryableWindowsWriteError(error)) throw error;
      await delay(25 * 2 ** (attempt - 1));
    }
  }
}

export function isRetryableWindowsWriteError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return typeof error.code === 'string' && RETRYABLE_WINDOWS_WRITE_CODES.has(error.code);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
