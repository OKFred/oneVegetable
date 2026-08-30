import type { AlibabaCredentialAcquisitionExtensionFallbackReason } from '@one-vegetable/core';

export function classifyAlibabaChallenge(
  text: string
): AlibabaCredentialAcquisitionExtensionFallbackReason | null {
  if (/captcha|验证码/iu.test(text)) return 'captcha';
  if (/slider|slide to verify|滑块|拖动/iu.test(text)) return 'slider';
  if (/multi-factor|two-factor|verification code|二次验证|双重验证/iu.test(text)) return 'mfa';
  if (/security verification|安全验证|密钥验证/iu.test(text)) return 'secret-verification';
  if (/robot|bot detected|unusual traffic|机器人|异常流量/iu.test(text)) return 'bot-rejected';
  return null;
}

export function findApplicationRecords(value: unknown): { appKey: string; appName: string }[] {
  return findRecords(value, (record) => {
    const appKey = stringField(record, ['appkey', 'appKey', 'app_key']);
    const appName = stringField(record, ['name', 'appName', 'appname']);
    return appKey && appName ? { appKey, appName } : null;
  });
}

export function findLegacyApplicationRecords(value: unknown): {
  appKey: string;
  appName: string;
  callbackUrl: string | null;
  status: string;
}[] {
  return findRecords(value, (record) => {
    const appKey = stringField(record, ['appKey', 'appkey', 'app_key']);
    if (!appKey) return null;
    return {
      appKey,
      appName: stringField(record, ['appName', 'appname', 'name', 'isvName']) ?? 'Legacy ICBU application',
      callbackUrl: stringField(record, ['callbackUrl', 'callbackURL', 'callback_url']),
      status: 'Legacy Online'
    };
  });
}

function findRecords<T>(value: unknown, mapper: (record: Record<string, unknown>) => T | null): T[] {
  const values: T[] = [];
  const visit = (current: unknown, depth: number): void => {
    if (depth > 8 || current === null || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }
    const record = current as Record<string, unknown>;
    const mapped = mapper(record);
    if (mapped) values.push(mapped);
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(value, 0);
  return values;
}

function stringField(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}
