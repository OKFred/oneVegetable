import type { AlibabaOpenApiCredentialBundle } from '@one-vegetable/core/credential-bundle';
import { parseAuthorizationJson } from './authorization-json-editor';

type ApplicationMetadata = Pick<
  AlibabaOpenApiCredentialBundle['application'],
  'appName' | 'appKey' | 'appSecret' | 'callbackUrl'
>;

/** Read only application metadata. This is not a credential-import parser. */
export function parseTopApplicationBackup(text: string): ApplicationMetadata {
  if (new TextEncoder().encode(text).length > 65_536) throw new Error('AUTH_JSON_TOO_LARGE');
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error('AUTH_JSON_INVALID');
  }
  let application: Record<string, unknown>;
  if (isRecord(value) && Object.keys(value).every((key) => key === 'protocol' || key === 'application')) {
    if (value.protocol === 'iop') throw new Error('TOP_REQUIRED');
    if ((value.protocol !== undefined && value.protocol !== 'top') || !isRecord(value.application))
      throw new Error('AUTH_JSON_INVALID');
    application = value.application;
  } else {
    // Complete historical bundles and dual arrays keep their existing strict validation.
    application = parseAuthorizationJson(text, 'top').application;
  }
  const result: ApplicationMetadata = {
    appName: application.appName === undefined ? '' : field(application.appName, true),
    appKey: field(application.appKey),
    appSecret: field(application.appSecret),
    callbackUrl: field(application.callbackUrl)
  };
  if (/\s/u.test(result.appKey) || /\s/u.test(result.appSecret)) throw new Error('AUTH_JSON_INVALID');
  if ([result.appName, result.appKey, result.appSecret].some((entry) => entry.startsWith('YOUR_')))
    throw new Error('AUTH_JSON_EXAMPLE');
  try {
    const callback = new URL(result.callbackUrl);
    if (callback.protocol !== 'https:' || callback.username || callback.password || callback.hash)
      throw new Error('AUTH_JSON_INVALID');
    result.callbackUrl = callback.href;
  } catch {
    throw new Error('AUTH_JSON_INVALID');
  }
  return result;
}

function field(value: unknown, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > 4096 || (!allowEmpty && !value.trim()))
    throw new Error('AUTH_JSON_INVALID');
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
