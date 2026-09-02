import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type LocalCredentialEncryptionKeySource = 'environment' | 'local-file' | 'generated';

export interface LocalCredentialEncryptionKey {
  value: string;
  source: LocalCredentialEncryptionKeySource;
  filePath: string | null;
}

export async function resolveLocalCredentialEncryptionKey(input: {
  configuredValue: string | undefined;
  filePath: string;
}): Promise<LocalCredentialEncryptionKey> {
  const configuredValue = input.configuredValue?.trim();
  if (configuredValue) {
    return {
      value: validateEncryptionKey(configuredValue),
      source: 'environment',
      filePath: null
    };
  }

  const storedValue = await readStoredKey(input.filePath);
  if (storedValue !== null) {
    return {
      value: validateEncryptionKey(storedValue),
      source: 'local-file',
      filePath: input.filePath
    };
  }

  await mkdir(dirname(input.filePath), { recursive: true });
  const generatedValue = randomBytes(32).toString('base64url');
  try {
    const handle = await open(input.filePath, 'wx', 0o600);
    try {
      await handle.writeFile(`${generatedValue}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    return {
      value: generatedValue,
      source: 'generated',
      filePath: input.filePath
    };
  } catch (error: unknown) {
    if (!hasErrorCode(error, 'EEXIST')) throw error;
    const concurrentlyStoredValue = await readConcurrentStoredKey(input.filePath, error);
    return {
      value: concurrentlyStoredValue,
      source: 'local-file',
      filePath: input.filePath
    };
  }
}

function validateEncryptionKey(value: string): string {
  const normalized = value.trim();
  const bytes = Buffer.from(normalized, 'base64url');
  if (!/^[A-Za-z0-9_-]{43}$/u.test(normalized) || bytes.byteLength !== 32) {
    throw new Error('本地凭据加密密钥必须是 32 字节 Base64URL');
  }
  return normalized;
}

async function readStoredKey(filePath: string): Promise<string | null> {
  try {
    return (await readFile(filePath, 'utf8')).trim();
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw error;
  }
}

async function readConcurrentStoredKey(filePath: string, originalError: unknown): Promise<string> {
  const maximumAttempts = 100;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const storedValue = await readStoredKey(filePath);
    if (storedValue !== null) {
      try {
        return validateEncryptionKey(storedValue);
      } catch {
        // open(..., 'wx') makes the file visible before the winning process finishes its write.
      }
    }
    if (attempt < maximumAttempts - 1) await delay(5);
  }
  throw originalError;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === code
  );
}
