import { hmac } from '@noble/hashes/hmac.js';
import { md5 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { GatewayCredentials, SignMethod } from './types';

export const ALIBABA_GATEWAY = 'https://eco.taobao.com/router/rest';
export const ALIBABA_SYNC_GATEWAY = 'https://open-api.alibaba.com/sync';

export function formatAlibabaTimestamp(now: Date): string {
  const chinaTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return chinaTime.toISOString().slice(0, 19).replace('T', ' ');
}

function serializeValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Blob) return undefined;
  return JSON.stringify(value);
}

export function serializeAlibabaParameters(
  parameters: Readonly<Record<string, unknown>>
): Record<string, string> {
  const serialized: Record<string, string> = {};
  for (const [key, value] of Object.entries(parameters)) {
    const candidate = serializeValue(value);
    if (candidate !== undefined) serialized[key] = candidate;
  }
  return serialized;
}

export function signAlibabaParameters(
  parameters: Readonly<Record<string, string>>,
  secret: string,
  method: SignMethod
): string {
  const content = Object.keys(parameters)
    .sort()
    .map((key) => `${key}${parameters[key] ?? ''}`)
    .join('');

  const encoder = new TextEncoder();
  const secretBytes = encoder.encode(secret);
  const contentBytes = encoder.encode(content);
  if (method === 'md5') return bytesToHex(md5(encoder.encode(`${secret}${content}${secret}`))).toUpperCase();
  if (method === 'hmac-sha256') return bytesToHex(hmac(sha256, secretBytes, contentBytes)).toUpperCase();
  return bytesToHex(hmac(md5, secretBytes, contentBytes)).toUpperCase();
}

export function createAlibabaRequest(
  credentials: GatewayCredentials,
  method: string,
  businessParameters: Readonly<Record<string, unknown>>,
  now = new Date()
): Record<string, string> {
  const showcaseField =
    method === 'alibaba.scbp.showcase.addproduct'
      ? 'product_id_list'
      : method === 'alibaba.scbp.showcase.deleteproduct'
        ? 'window_id_list'
        : null;
  if (showcaseField) {
    const ids = businessParameters[showcaseField];
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 20 ||
      ids.some((id: unknown) => typeof id !== 'string' || !/^[1-9][0-9]*$/.test(id)) ||
      new Set(ids).size !== ids.length
    )
      throw new Error('INVALID_SHOWCASE_IDS');
    businessParameters = { ...businessParameters, [showcaseField]: ids.join(',') };
  }
  const parameters = serializeAlibabaParameters({
    app_key: credentials.appKey,
    format: 'json',
    method,
    session: method === 'alibaba.icbu.text.trans' ? undefined : credentials.accessToken,
    sign_method: credentials.signMethod,
    simplify: true,
    timestamp: formatAlibabaTimestamp(now),
    v: '2.0',
    ...businessParameters
  });

  return {
    ...parameters,
    sign: signAlibabaParameters(parameters, credentials.appSecret, credentials.signMethod)
  };
}

export function createAlibabaSyncRequest(
  credentials: GatewayCredentials,
  method: string,
  businessParameters: Readonly<Record<string, unknown>>,
  now = new Date()
): Record<string, string> {
  const parameters = serializeAlibabaParameters({
    app_key: credentials.appKey,
    format: 'json',
    method,
    session: credentials.accessToken,
    sign_method: 'sha256',
    simplify: 'true',
    timestamp: String(now.getTime()),
    v: '2.0',
    ...businessParameters
  });

  return {
    ...parameters,
    sign: signAlibabaParameters(parameters, credentials.appSecret, 'hmac-sha256')
  };
}
