import type { AlibabaClient } from './alibaba-client';
import { validateCapabilityRequest, validateCapabilityResponse } from './capability-registry';
import { GatewayException } from './errors';
import type { ProductShowcaseSnapshot, ProductShowcaseMutationResult, RequestOf } from './types';
export {
  validateProductShowcaseSnapshot,
  validateProductShowcaseMutationResult
} from './generated/validators-showcase';

const prefix = 'alibaba.scbp.showcase.';
export function showcaseError(code: string): GatewayException {
  return new GatewayException({ code, message: code, retryable: false });
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw showcaseError('SHOWCASE_INCOMPLETE');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) return value;
  throw showcaseError('SHOWCASE_INCOMPLETE');
}
function count(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw showcaseError('SHOWCASE_INCOMPLETE');
}
function imageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** Dedicated operation adapter: never exposes unrestricted mutation calls. */
export class ProductShowcaseAdapter {
  constructor(private readonly client: Pick<AlibabaClient, 'call'>) {}

  private async call(suffix: string, parameters: Record<string, unknown>): Promise<Record<string, unknown>> {
    const method = prefix + suffix;
    if ((await validateCapabilityRequest(method, parameters)).length)
      throw showcaseError('REQUEST_CONTRACT_INVALID');
    const result = await this.client.call(method, parameters);
    const envelope = record(result.data);
    const data = record(envelope[`${method.replaceAll('.', '_')}_response`] ?? envelope);
    if ((await validateCapabilityResponse(method, data)).length) throw showcaseError('SHOWCASE_INCOMPLETE');
    return data;
  }

  async get(): Promise<ProductShowcaseSnapshot> {
    const status = await this.call('status', {});
    const total = count(status.total_count);
    const used = count(status.current_count);
    const entries: ProductShowcaseSnapshot['entries'] = [];
    const seen = new Set<string>();
    // Require an explicit terminal page. A repeated/full page is never treated as empty.
    for (let page = 1; page <= 100; page++) {
      const data = await this.call('list', { per_page_size: 20, to_page: page });
      if (!Array.isArray(data.results)) throw showcaseError('SHOWCASE_INCOMPLETE');
      for (const value of data.results) {
        const row = record(value);
        const windowId = id(row.id);
        if (seen.has(windowId)) throw showcaseError('SHOWCASE_INCOMPLETE');
        seen.add(windowId);
        entries.push({
          windowId,
          productId: id(row.product_id),
          subject: typeof row.subject === 'string' ? row.subject : null,
          imageUrl: imageUrl(row.image_url),
          valid: typeof row.valid === 'boolean' ? row.valid : null
        });
      }
      if (data.results.length < 20) {
        if (
          entries.length !== used ||
          used > total ||
          new Set(entries.map((row) => row.productId)).size !== entries.length
        )
          throw showcaseError('SHOWCASE_INCOMPLETE');
        return { total, used, available: total - used, entries };
      }
    }
    throw showcaseError('SHOWCASE_INCOMPLETE');
  }

  async mutate(
    action: 'add',
    request: RequestOf<'addShowcaseProducts'>
  ): Promise<ProductShowcaseMutationResult>;
  async mutate(
    action: 'remove',
    request: RequestOf<'removeShowcaseProducts'>
  ): Promise<ProductShowcaseMutationResult>;
  async mutate(
    action: 'add' | 'remove',
    request: RequestOf<'addShowcaseProducts'> | RequestOf<'removeShowcaseProducts'>
  ): Promise<ProductShowcaseMutationResult> {
    const method = prefix + (action === 'add' ? 'addproduct' : 'deleteproduct');
    // Validate before even the read preflight, including duplicate IDs and extra properties.
    if ((await validateCapabilityRequest(method, request)).length)
      throw showcaseError('REQUEST_CONTRACT_INVALID');
    const ids = 'product_id_list' in request ? request.product_id_list : request.window_id_list;
    const before = await this.get();
    if (action === 'add') {
      if (ids.some((value) => before.entries.some((row) => row.productId === value)))
        throw showcaseError('SHOWCASE_ALREADY_PRESENT');
      if (ids.length > before.available) throw showcaseError('SHOWCASE_FULL');
    } else if (ids.some((value) => !before.entries.some((row) => row.windowId === value))) {
      throw showcaseError('SHOWCASE_BASELINE_CHANGED');
    }
    const data = await this.call(action === 'add' ? 'addproduct' : 'deleteproduct', request);
    if (data.result !== true)
      throw showcaseError(data.result === false ? 'SHOWCASE_REJECTED' : 'SHOWCASE_UNCONFIRMED');
    const traceId = typeof data.request_id === 'string' ? data.request_id : null;
    try {
      const snapshot = await this.get();
      const retained = before.entries.filter((row) => action === 'add' || !ids.includes(row.windowId));
      const matches =
        action === 'add'
          ? ids.every((value) => snapshot.entries.some((row) => row.productId === value))
          : ids.every((value) => !snapshot.entries.some((row) => row.windowId === value));
      const unchanged = retained.every((row) =>
        snapshot.entries.some((next) => next.windowId === row.windowId && next.productId === row.productId)
      );
      const size = before.used + (action === 'add' ? ids.length : -ids.length);
      return {
        outcome: matches && unchanged && snapshot.used === size ? 'confirmed' : 'unconfirmed',
        traceId,
        snapshot
      };
    } catch {
      // Readback failure must never turn a previously sent mutation into a retryable upload.
      return { outcome: 'unconfirmed', traceId, snapshot: null };
    }
  }
}
