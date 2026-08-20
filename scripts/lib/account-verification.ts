import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function readAccountVerifiedMethods(root: string): Promise<ReadonlySet<string>> {
  return readMethods(root, 'config/alibaba-account-verified-read-methods.json');
}

export async function readAccountVerifiedMutationMethods(root: string): Promise<ReadonlySet<string>> {
  return readMethods(root, 'config/alibaba-account-verified-mutation-methods.json');
}

async function readMethods(root: string, relativePath: string): Promise<ReadonlySet<string>> {
  const value = JSON.parse(await readFile(resolve(root, relativePath), 'utf8')) as unknown;
  if (!isRecord(value) || !Array.isArray(value.methods)) {
    throw new Error('Alibaba account verification snapshot is invalid');
  }
  const methods = value.methods;
  if (!methods.every((method) => typeof method === 'string' && method.trim() !== '')) {
    throw new Error('Alibaba account verification snapshot contains an invalid method');
  }
  return new Set(methods);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
