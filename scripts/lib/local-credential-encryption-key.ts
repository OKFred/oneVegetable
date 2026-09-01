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
    const concurrentlyStoredValue = await readStoredKey(input.filePath);
    if (concurrentlyStoredValue === null) throw error;
    return {
      value: validateEncryptionKey(concurrentlyStoredValue),
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

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === code
  );
}
