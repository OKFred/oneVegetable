import assert from 'node:assert/strict';
import { IOP_BUSINESS_ENDPOINT, isRecord } from '../../packages/core/src/alibaba-iop';

export type PhotoProbeTransport = 'documented' | 'sdk-query-form';
const photoListPath = '/rest/icbu/product/photobank/list';
const businessKeys = ['groupId', 'currentPage', 'pageSize'];

/** Operator-only SDK comparison. Does not change production transport or regenerate signatures. */
export function photoProbeTransport(
  request: { url: string; parameters: Readonly<Record<string, string>> },
  mode: PhotoProbeTransport
): { url: string; body: URLSearchParams } {
  const url = new URL(request.url);
  assert(
    url.origin === new URL(IOP_BUSINESS_ENDPOINT).origin &&
      url.pathname === photoListPath &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password,
    'PHOTO_PROBE_READ_PATH_REQUIRED'
  );
  assert(
    (['documented', 'sdk-query-form'] as readonly string[]).includes(mode),
    'PHOTO_PROBE_TRANSPORT_INVALID'
  );
  assert(
    businessKeys.every((key) => request.parameters[key]?.trim()),
    'PHOTO_PROBE_PARAMETERS_REQUIRED'
  );
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(request.parameters)) {
    if (mode === 'sdk-query-form' && !businessKeys.includes(key)) url.searchParams.set(key, value);
    else body.set(key, value);
  }
  return { url: url.href, body };
}

/** Persist counts only: never retain IDs, filenames, URLs, account fields or raw server messages. */
export function photoProbeScope(items: readonly unknown[], groupId: string) {
  let targetGroup = 0;
  let otherGroup = 0;
  let missingGroup = 0;
  let invalidGroup = 0;
  for (const item of items) {
    if (!isRecord(item) || item.group_id === undefined || item.group_id === null) missingGroup++;
    else if (
      (typeof item.group_id !== 'string' && typeof item.group_id !== 'number') ||
      !/^[1-9]\d*$/u.test(String(item.group_id)) ||
      !Number.isSafeInteger(Number(item.group_id))
    )
      invalidGroup++;
    else if (String(item.group_id) === groupId) targetGroup++;
    else otherGroup++;
  }
  return { returned: items.length, targetGroup, otherGroup, missingGroup, invalidGroup };
}
