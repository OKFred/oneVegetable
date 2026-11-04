import type {
  S3StorageConfiguration,
  S3StorageConfigurationSummary,
  S3ObjectPage
} from '@one-vegetable/core/s3-storage';

export const EXTENSION_S3_STORAGE_KEY = 'one-vegetable.s3.v1';
export interface S3MessageMap {
  summary: { input: Record<string, never>; output: S3StorageConfigurationSummary };
  save: {
    input: { configuration: S3StorageConfiguration; revision: number | null; remark: string | null };
    output: S3StorageConfigurationSummary;
  };
  clear: { input: { revision: number }; output: null };
  reset: { input: Record<string, never>; output: null };
  test: { input: Record<string, never>; output: { connected: boolean; visibleObjectCount: number } };
  list: {
    input: { prefix?: string; continuationToken?: string; maximum?: number; delimiter?: '/' };
    output: S3ObjectPage;
  };
  get: {
    input: { key: string };
    output: {
      key: string;
      contentBase64: string;
      byteLength: number;
      contentType: string | null;
      etag: string | null;
    };
  };
  put: {
    input: {
      key: string;
      contentBase64: string;
      contentType: string;
      createOnly?: boolean;
      directory?: boolean;
    };
    output: { key: string; etag: string | null };
  };
}
export type S3Operation = keyof S3MessageMap;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nullableString = (value: unknown): boolean => value === null || typeof value === 'string';
const nullableNumber = (value: unknown): boolean =>
  value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
export function validS3Output(operation: S3Operation, value: unknown): boolean {
  if (operation === 'reset' || operation === 'clear') return value === null;
  if (!isRecord(value)) return false;
  if (operation === 'summary' || operation === 'save')
    return (
      (value.configurationId === undefined ||
        value.configurationId === null ||
        (typeof value.configurationId === 'string' && /^[a-f0-9]{64}$/u.test(value.configurationId))) &&
      typeof value.configured === 'boolean' &&
      ['endpoint', 'region', 'bucket', 'accessKeyIdSuffix', 'rootPrefix', 'updaterId', 'remark'].every(
        (key) => nullableString(value[key])
      ) &&
      typeof value.hasSessionToken === 'boolean' &&
      (value.pathStyle === null || typeof value.pathStyle === 'boolean') &&
      nullableNumber(value.revision) &&
      nullableNumber(value.updateTimeUtc)
    );
  if (operation === 'test')
    return (
      typeof value.connected === 'boolean' &&
      typeof value.visibleObjectCount === 'number' &&
      Number.isSafeInteger(value.visibleObjectCount) &&
      value.visibleObjectCount >= 0
    );
  if (operation === 'list')
    return (
      (value.prefixes === undefined ||
        (Array.isArray(value.prefixes) &&
          value.prefixes.every((prefix: unknown) => typeof prefix === 'string' && prefix.endsWith('/')))) &&
      Array.isArray(value.items) &&
      value.items.every(
        (item: unknown) =>
          isRecord(item) &&
          typeof item.key === 'string' &&
          typeof item.size === 'number' &&
          Number.isSafeInteger(item.size) &&
          item.size >= 0 &&
          nullableString(item.etag) &&
          nullableNumber(item.lastModifiedTimeUtc)
      ) &&
      nullableString(value.nextContinuationToken)
    );
  if (typeof value.key !== 'string' || !nullableString(value.etag)) return false;
  if (operation === 'put') return true;
  return (
    typeof value.contentBase64 === 'string' &&
    value.contentBase64.length <= 7_000_000 &&
    nullableString(value.contentType) &&
    typeof value.byteLength === 'number' &&
    Number.isSafeInteger(value.byteLength) &&
    value.byteLength >= 0 &&
    value.byteLength <= 5 * 1024 * 1024
  );
}
export interface S3Response<T> {
  requestId: string;
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; retryable: false };
}
