import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import { describeUserVisibleError } from '@one-vegetable/core';
import type {
  GatewayClient,
  ProductInventorySnapshot,
  ProductScore,
  TradeOrderAggregate,
  TradeOrderSummary
} from '@one-vegetable/core';

type Detail = ProductScore | TradeOrderAggregate | ProductInventorySnapshot;
interface Entry {
  at: number;
  data: Detail;
}
const stores = new WeakMap<
  GatewayClient,
  { cache: Map<string, Entry>; pending: Map<string, Promise<Detail>> }
>();

export async function pageDetailIdentity(gateway: GatewayClient, mode: string): Promise<string> {
  const context = await gateway.galleryTransferContext?.();
  if (!context && mode !== 'mock') throw new Error('GALLERY_CONTEXT_UNAVAILABLE');
  return context ? JSON.stringify([context.identity, context.gateway]) : 'mock';
}

export function detailErrorState(error: unknown): 'denied' | 'failed' {
  const code = detailErrorCode(error);
  return /PERMISSION|FORBIDDEN|ACCESS_DENIED|QUALIFICATION/.test(code) ? 'denied' : 'failed';
}

function detailErrorCode(error: unknown): string {
  const details = describeUserVisibleError(error, '');
  return (
    details.code ??
    (error && typeof error === 'object' && 'code' in error ? String(error.code) : details.message)
  );
}

export async function requestPageDetail(
  gateway: GatewayClient,
  mode: string,
  language: string,
  request:
    | { kind: 'score'; id: string }
    | { kind: 'order'; order: TradeOrderSummary }
    | { kind: 'inventory'; id: string; source: 'product' | 'sku' },
  expectedIdentity?: string,
  refresh = false
): Promise<Detail> {
  let store = stores.get(gateway);
  if (!store) {
    store = { cache: new Map(), pending: new Map() };
    stores.set(gateway, store);
  }
  const context = await gateway.galleryTransferContext?.();
  // Production gateways must expose an opaque identity before sharing cached account data.
  if (!context && mode !== 'mock') throw new Error('GALLERY_CONTEXT_UNAVAILABLE');
  const identity = context ? JSON.stringify([context.identity, context.gateway]) : 'mock';
  if (expectedIdentity !== undefined && expectedIdentity !== identity)
    throw new Error('GALLERY_CONTEXT_CHANGED');
  const key = JSON.stringify([
    mode,
    identity,
    language,
    request.kind,
    request.kind === 'order' ? request.order.id : request.id,
    request.kind === 'inventory' ? request.source : null
  ]);
  const cached = store.cache.get(key);
  if (!refresh && cached && Date.now() - cached.at < 300_000) return cached.data;
  const pending = store.pending.get(key);
  if (pending) return pending;
  const capturedStore = store;
  const job = (async () => {
    const options = context ? { galleryContext: context } : undefined;
    const data =
      request.kind === 'inventory'
        ? await gateway.request(
            'getProductInventory',
            {
              productId: request.id,
              source: request.source,
              language: language === 'zh_CN' ? 'zh_CN' : 'en_US'
            },
            options
          )
        : request.kind === 'score'
          ? await gateway.request('getProductScore', { productId: request.id }, options)
          : await gateway.request('getTradeOrderAggregate', { order: request.order }, options);
    const latest = await gateway.galleryTransferContext?.();
    if (context && JSON.stringify([latest?.identity, latest?.gateway]) !== identity)
      throw new Error('GALLERY_CONTEXT_CHANGED');
    for (const [oldKey, entry] of capturedStore.cache)
      if (Date.now() - entry.at >= 300_000) capturedStore.cache.delete(oldKey);
    if (capturedStore.cache.size >= 500) capturedStore.cache.clear();
    if (
      (!('order' in data) || (data.fund && data.logistics)) &&
      (!('records' in data) || data.status === 'ready' || data.status === 'no-data')
    )
      capturedStore.cache.set(key, { at: Date.now(), data });
    return data;
  })();
  store.pending.set(key, job);
  try {
    return await job;
  } finally {
    store.pending.delete(key);
  }
}

export function usePageDetails<T>(
  rows: Ref<T[]>,
  boundary: Ref<unknown>,
  id: (row: T) => string,
  query: (row: T, identity?: string) => Promise<Detail>,
  accept: (row: T, data: Detail) => void,
  readIdentity?: () => Promise<string>
) {
  const busy = ref(false);
  const done = ref(0);
  const total = ref(0);
  const states = shallowRef<Record<string, 'loading' | 'ready' | 'failed'>>({});
  const errors = shallowRef<Record<string, unknown>>({});
  const securityFailure = ref(false);
  let epoch = 0;
  const stopRequested = ref(false);
  function stop(): void {
    stopRequested.value = true;
  }
  function stopped(): boolean {
    return stopRequested.value;
  }
  function invalidate(): void {
    epoch++;
    stop();
    states.value = {};
    errors.value = {};
  }
  watch(boundary, invalidate);
  onScopeDispose(invalidate);
  async function load(
    onlyFailed = false,
    selected?: T[]
  ): Promise<{ success: number; failed: number } | null> {
    if (busy.value) return null;
    const targets = (selected ?? rows.value).filter(
      (row) => !onlyFailed || states.value[id(row)] === 'failed'
    );
    const current = epoch;
    stopRequested.value = false;
    busy.value = true;
    done.value = 0;
    total.value = targets.length;
    securityFailure.value = false;
    let success = 0;
    let failed = 0;
    let identity: string | undefined;
    try {
      for (const row of targets) {
        if (stopped() || current !== epoch) break;
        const key = id(row);
        states.value = { ...states.value, [key]: 'loading' };
        try {
          identity ??= await readIdentity?.();
          if (stopped() || current !== epoch) break;
          const result = await query(row, identity);
          if (current !== epoch) break;
          accept(row, result);
          errors.value = Object.fromEntries(Object.entries(errors.value).filter(([id]) => id !== key));
          success++;
          states.value = { ...states.value, [key]: 'ready' };
        } catch (error: unknown) {
          if (current !== epoch) break;
          failed++;
          errors.value = { ...errors.value, [key]: error };
          states.value = { ...states.value, [key]: 'failed' };
          const code = detailErrorCode(error).toUpperCase();
          if (/SESSION|AUTH|TOKEN|CREDENTIAL|PERMISSION|CONTEXT|VAULT|FORBIDDEN/.test(code)) {
            securityFailure.value = true;
            stop();
          }
        }
        done.value++;
        if (!stopped() && done.value < targets.length)
          await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } finally {
      busy.value = false;
    }
    return current === epoch ? { success, failed } : null;
  }
  return { busy, done, total, states, errors, securityFailure, load, stop };
}
