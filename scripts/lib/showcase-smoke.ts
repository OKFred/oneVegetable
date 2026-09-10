import { isRecord } from './product-stock-smoke';

export interface ShowcaseEntry {
  windowId: string;
  productId: string;
}

function id(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) return value;
  throw new Error('INVALID_SHOWCASE_RESPONSE_ID');
}

export function showcaseEntries(value: unknown): ShowcaseEntry[] {
  if (!isRecord(value) || !Array.isArray(value.results)) throw new Error('INCOMPLETE_SHOWCASE_LIST');
  const entries = value.results.map((row: unknown) => {
    if (!isRecord(row)) throw new Error('INVALID_SHOWCASE_ROW');
    return { windowId: id(row.id), productId: id(row.product_id) };
  });
  if (new Set(entries.map((entry) => entry.windowId)).size !== entries.length)
    throw new Error('DUPLICATE_SHOWCASE_WINDOW');
  return entries;
}

export function newShowcaseEntry(
  before: ShowcaseEntry[],
  after: ShowcaseEntry[],
  productId: string
): ShowcaseEntry {
  if (before.some((row) => row.productId === productId)) throw new Error('TARGET_ALREADY_IN_SHOWCASE');
  const matches = after.filter((row) => row.productId === productId);
  const candidate = matches[0];
  if (matches.length !== 1 || !candidate || before.some((row) => row.windowId === candidate.windowId)) {
    throw new Error('NEW_SHOWCASE_ENTRY_NOT_UNIQUE');
  }
  return candidate;
}

export function restorationConfirmed(
  before: ShowcaseEntry[],
  after: ShowcaseEntry[],
  added: ShowcaseEntry
): boolean {
  return (
    !after.some((row) => row.windowId === added.windowId || row.productId === added.productId) &&
    before.every((row) =>
      after.some((current) => current.windowId === row.windowId && current.productId === row.productId)
    )
  );
}

export function mutationConfirmed(value: unknown): boolean {
  return isRecord(value) && value.result === true;
}

export function unwrapShowcaseResponse(value: unknown, method: string): unknown {
  if (!isRecord(value)) return value;
  const wrapper = `${method.replaceAll('.', '_')}_response`;
  return Object.hasOwn(value, wrapper) ? value[wrapper] : value;
}
