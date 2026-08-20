import { readFile } from 'node:fs/promises';

import { OpenApiAuthError } from './storage';

import type { AlibabaOpenApiCredentialBundle } from './types';

export async function readCredentialBundle(path: string): Promise<AlibabaOpenApiCredentialBundle> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new OpenApiAuthError('CREDENTIAL_BUNDLE_UNREADABLE', '授权包不存在、不可读或不是有效 JSON');
  }
  if (!isCredentialBundle(value)) {
    throw new OpenApiAuthError('CREDENTIAL_BUNDLE_INVALID', '授权包字段不完整或版本不受支持');
  }
  return value;
}

export function isCredentialBundle(value: unknown): value is AlibabaOpenApiCredentialBundle {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  const application = value.application;
  const oauth = value.oauth;
  const callback = value.callback;
  return (
    isRecord(application) &&
    nonEmptyString(application.appName) &&
    nonEmptyString(application.appKey) &&
    nonEmptyString(application.appSecret) &&
    nonEmptyString(application.callbackUrl) &&
    typeof application.status === 'string' &&
    Array.isArray(application.permissions) &&
    application.permissions.every(
      (item) => isRecord(item) && typeof item.name === 'string' && typeof item.status === 'string'
    ) &&
    isRecord(oauth) &&
    nonEmptyString(oauth.accessToken) &&
    nullableString(oauth.refreshToken) &&
    nullableString(oauth.expiresAtUtc) &&
    nullableString(oauth.refreshExpiresAtUtc) &&
    isRecord(callback) &&
    typeof callback.receivedAtUtc === 'string' &&
    callback.stateMatched === true &&
    typeof callback.callbackOrigin === 'string' &&
    typeof callback.callbackPath === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 4096;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
