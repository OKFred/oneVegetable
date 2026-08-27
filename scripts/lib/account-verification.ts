import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const ACCOUNT_VERIFICATION_STATUSES = [
  'passed',
  'no-data',
  'permission-denied',
  'contract-drift',
  'provider-error',
  'skipped-prerequisite'
] as const;

export type AccountVerificationStatus = (typeof ACCOUNT_VERIFICATION_STATUSES)[number];

export interface AccountVerificationResult {
  method: string;
  status: AccountVerificationStatus;
  reasonCode: string | null;
}

export interface AccountVerificationSnapshot {
  schemaVersion: 1;
  checkedAtUtc: string;
  results: AccountVerificationResult[];
}

export async function readAccountVerifiedMethods(root: string): Promise<ReadonlySet<string>> {
  return readMethods(root, 'config/alibaba-account-verified-read-methods.json');
}

export async function readAccountVerifiedMutationMethods(root: string): Promise<ReadonlySet<string>> {
  return readMethods(root, 'config/alibaba-account-verified-mutation-methods.json');
}

export async function readAccountVerificationSnapshot(root: string): Promise<AccountVerificationSnapshot> {
  const value: unknown = JSON.parse(
    await readFile(resolve(root, 'config/alibaba-account-verification-results.json'), 'utf8')
  );
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.checkedAtUtc !== 'string' ||
    Number.isNaN(Date.parse(value.checkedAtUtc)) ||
    !Array.isArray(value.results)
  ) {
    throw new Error('Alibaba account verification result snapshot is invalid');
  }
  const results = value.results.map(parseResult);
  if (new Set(results.map((result) => result.method)).size !== results.length) {
    throw new Error('Alibaba account verification result snapshot contains duplicate methods');
  }
  return { schemaVersion: 1, checkedAtUtc: value.checkedAtUtc, results };
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

function parseResult(value: unknown): AccountVerificationResult {
  if (
    !isRecord(value) ||
    typeof value.method !== 'string' ||
    value.method.trim() === '' ||
    !ACCOUNT_VERIFICATION_STATUSES.includes(value.status as AccountVerificationStatus) ||
    (value.reasonCode !== null && typeof value.reasonCode !== 'string') ||
    (typeof value.reasonCode === 'string' && value.reasonCode.length > 160)
  ) {
    throw new Error('Alibaba account verification result entry is invalid');
  }
  return {
    method: value.method,
    status: value.status as AccountVerificationStatus,
    reasonCode: value.reasonCode
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
