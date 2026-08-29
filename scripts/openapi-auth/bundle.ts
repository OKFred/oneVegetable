import { readFile } from 'node:fs/promises';

import { isAlibabaOpenApiCredentialBundle } from '../../packages/core/src/alibaba-credential-bundle';

import { OpenApiAuthError } from './storage';

import type { AlibabaOpenApiCredentialBundle } from './types';

export async function readCredentialBundle(path: string): Promise<AlibabaOpenApiCredentialBundle> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new OpenApiAuthError('CREDENTIAL_BUNDLE_UNREADABLE', '授权包不存在、不可读或不是有效 JSON');
  }
  if (!isAlibabaOpenApiCredentialBundle(value)) {
    throw new OpenApiAuthError('CREDENTIAL_BUNDLE_INVALID', '授权包字段不完整或版本不受支持');
  }
  return value;
}

export function isCredentialBundle(value: unknown): value is AlibabaOpenApiCredentialBundle {
  return isAlibabaOpenApiCredentialBundle(value);
}
