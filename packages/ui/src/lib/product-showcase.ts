import { computed, ref, shallowRef } from 'vue';
import { GatewayException } from '@one-vegetable/core/errors';
import { toast } from 'vue-sonner';
import type { Product, ProductShowcaseSnapshot } from '@one-vegetable/core';
import type { GalleryTransferContext } from '@one-vegetable/core/gallery-transfer-task';
import {
  validateProductShowcaseSnapshot,
  validateProductShowcaseMutationResult,
  showcaseError
} from '@one-vegetable/core/showcase';
import { useServices } from './services';
import { useShowcaseI18n } from '../i18n/showcase';
import { SHOWCASE_LOCK, SHOWCASE_STORAGE_PREFIX } from './showcase-storage';

export type ShowcaseTarget = Pick<Product, 'id' | 'subject' | 'status'>;

export function useProductShowcase() {
  const services = useServices();
  const s = useShowcaseI18n();
  const snapshot = shallowRef<ProductShowcaseSnapshot | null>(null);
  const error = shallowRef<unknown>(null);
  const loading = ref(false);
  const busy = ref(false);
  const unresolved = ref(false);
  const requestId = ref('');
  const pendingIds = ref<string[]>([]);
  const pendingAction = ref<'add' | 'remove' | null>(null);
  const context = shallowRef<GalleryTransferContext | undefined>();
  const allowed = ref({ add: false, remove: false });
  let receiptKey = '';
  let receiptValue = '';
  let lastLoad = 0;
  let inFlight: Promise<void> | null = null;
  const displayError = computed(() => {
    const cause = error.value;
    if (!(cause instanceof GatewayException)) return cause;
    const messages: Record<string, Parameters<typeof s>[0]> = {
      SHOWCASE_INCOMPLETE: 'incomplete',
      SHOWCASE_FULL: 'full',
      SHOWCASE_ALREADY_PRESENT: 'online',
      SHOWCASE_BASELINE_CHANGED: 'changed',
      SHOWCASE_REJECTED: 'rejected',
      SHOWCASE_UNCONFIRMED: 'uncertain',
      SHOWCASE_LOCKED: 'locked'
    };
    const key = messages[cause.gatewayError.code];
    return key ? new GatewayException({ ...cause.gatewayError, message: s(key) }, cause.requestId) : cause;
  });
  function readReceipt(): void {
    receiptValue = localStorage.getItem(receiptKey) ?? '';
    unresolved.value = receiptValue !== '';
    requestId.value = /^[\da-f-]{36}$/.test(receiptValue) ? receiptValue : '';
    pendingIds.value = [];
    pendingAction.value = null;
    try {
      const value: unknown = JSON.parse(receiptValue);
      if (
        !value ||
        typeof value !== 'object' ||
        !('requestId' in value) ||
        !('action' in value) ||
        !('ids' in value)
      )
        return;
      if (
        typeof value.requestId !== 'string' ||
        !/^[\da-f-]{36}$/.test(value.requestId) ||
        (value.action !== 'add' && value.action !== 'remove') ||
        !Array.isArray(value.ids) ||
        value.ids.length > 20 ||
        !value.ids.every((id: unknown) => typeof id === 'string' && /^[1-9][0-9]*$/.test(id))
      )
        return;
      requestId.value = value.requestId;
      pendingAction.value = value.action;
      pendingIds.value = value.ids as string[];
    } catch {
      /* Legacy UUID or corrupt receipt: remain blocked, never resend. */
    }
  }

  async function identity(): Promise<GalleryTransferContext | undefined> {
    const current = await services.gateway.galleryTransferContext?.();
    if (!current && services.mode !== 'mock') throw showcaseError('GALLERY_CONTEXT_UNAVAILABLE');
    return current;
  }
  function sameIdentity(a: GalleryTransferContext | undefined, b: GalleryTransferContext | undefined) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  async function load(force = false): Promise<void> {
    if (busy.value) return;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      loading.value = true;
      error.value = null;
      try {
        const current = await identity();
        if (
          snapshot.value &&
          !force &&
          sameIdentity(current, context.value) &&
          Date.now() - lastLoad < 60_000
        )
          return;
        if (!sameIdentity(current, context.value)) snapshot.value = null;
        context.value = current;
        receiptKey = `${SHOWCASE_STORAGE_PREFIX}${current?.identity ?? 'mock'}:${current?.gateway ?? 'mock'}`;
        readReceipt();
        const availability = await services.operationAvailability?.get([
          'addShowcaseProducts',
          'removeShowcaseProducts'
        ]);
        allowed.value = {
          add:
            services.mode === 'mock' ||
            availability?.items.some((row) => row.operation === 'addShowcaseProducts' && row.allowed) ===
              true,
          remove:
            services.mode === 'mock' ||
            availability?.items.some((row) => row.operation === 'removeShowcaseProducts' && row.allowed) ===
              true
        };
        const data = await services.gateway.request(
          'getProductShowcase',
          undefined,
          current ? { galleryContext: current } : undefined
        );
        if (!validateProductShowcaseSnapshot(data)) throw showcaseError('SHOWCASE_INCOMPLETE');
        if (!sameIdentity(current, await identity())) throw showcaseError('GALLERY_CONTEXT_CHANGED');
        snapshot.value = data;
        lastLoad = Date.now();
      } catch (cause) {
        error.value = cause;
        snapshot.value = null;
        allowed.value = { add: false, remove: false };
      } finally {
        loading.value = false;
      }
    })();
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  }
  function reason(action: 'add' | 'remove', products: readonly ShowcaseTarget[]): string {
    if (busy.value || unresolved.value) return s('uncertain');
    if (!allowed.value[action]) return s('disabled');
    if (!snapshot.value) return s('incomplete');
    if (products.length < 1 || products.length > 20) return s('select');
    const entries = snapshot.value.entries;
    if (action === 'add') {
      if (
        products.some(
          (product) => product.status !== 'online' || entries.some((row) => row.productId === product.id)
        )
      )
        return s('online');
      if (products.length > snapshot.value.available) return s('full');
    } else if (products.some((product) => !entries.some((row) => row.productId === product.id)))
      return s('missing');
    return '';
  }
  async function mutate(action: 'add' | 'remove', products: readonly ShowcaseTarget[]): Promise<void> {
    if (busy.value) return;
    const expected = context.value;
    const oldSnapshot = snapshot.value;
    await load(true);
    if (!sameIdentity(expected, context.value)) {
      toast.error(s('changed'));
      return;
    }
    const refusal = reason(action, products);
    if (refusal) {
      toast.error(refusal);
      return;
    }
    const windowIds = products.map(
      (product) => oldSnapshot?.entries.find((row) => row.productId === product.id)?.windowId ?? ''
    );
    if (
      action === 'remove' &&
      windowIds.some((id) => !snapshot.value?.entries.some((row) => row.windowId === id))
    ) {
      toast.error(s('changed'));
      return;
    }
    busy.value = true;
    error.value = null;
    try {
      if (!('locks' in navigator)) throw showcaseError('SHOWCASE_LOCKED');
      await navigator.locks.request(SHOWCASE_LOCK, { ifAvailable: true }, async (lock) => {
        if (!lock || localStorage.getItem(receiptKey)) throw showcaseError('SHOWCASE_LOCKED');
        const current = await identity();
        if (!sameIdentity(expected, current)) throw showcaseError('GALLERY_CONTEXT_CHANGED');
        requestId.value = crypto.randomUUID();
        const receipt = JSON.stringify({
          requestId: requestId.value,
          action,
          ids: products.map((row) => row.id)
        });
        localStorage.setItem(receiptKey, receipt); // Must succeed BEFORE a write can be sent.
        readReceipt();
        unresolved.value = true;
        const options = { requestId: requestId.value, ...(current ? { galleryContext: current } : {}) };
        const result =
          action === 'add'
            ? await services.gateway.request(
                'addShowcaseProducts',
                { product_id_list: products.map((row) => row.id) },
                options
              )
            : await services.gateway.request(
                'removeShowcaseProducts',
                { window_id_list: windowIds },
                options
              );
        if (!sameIdentity(expected, await identity())) {
          snapshot.value = null;
          throw showcaseError('GALLERY_CONTEXT_CHANGED');
        }
        if (!validateProductShowcaseMutationResult(result)) throw showcaseError('SHOWCASE_UNCONFIRMED');
        snapshot.value = result.snapshot;
        if (result.outcome === 'confirmed' && result.snapshot) {
          clearReceipt();
          toast.success(s('success'));
        } else toast.warning(s('uncertain'));
      });
    } catch (cause) {
      error.value = cause;
      toast.warning(unresolved.value ? s('uncertain') : s('locked'));
    } finally {
      busy.value = false;
      lastLoad = 0;
    }
  }
  function clearReceipt(): void {
    if (localStorage.getItem(receiptKey) !== receiptValue) throw showcaseError('SHOWCASE_LOCKED');
    localStorage.removeItem(receiptKey);
    unresolved.value = false;
    receiptValue = '';
    pendingIds.value = [];
    pendingAction.value = null;
  }
  async function acknowledgeReceipt(): Promise<void> {
    if (busy.value || !('locks' in navigator)) throw showcaseError('SHOWCASE_LOCKED');
    await navigator.locks.request(SHOWCASE_LOCK, { ifAvailable: true }, async (lock) => {
      if (!lock || !sameIdentity(context.value, await identity())) throw showcaseError('SHOWCASE_LOCKED');
      clearReceipt();
    });
  }
  function invalidate(): void {
    snapshot.value = null;
    allowed.value = { add: false, remove: false };
    lastLoad = 0;
  }
  return {
    snapshot,
    loading,
    error: displayError,
    busy,
    unresolved,
    requestId,
    pendingIds,
    pendingAction,
    load,
    reason,
    mutate,
    acknowledgeReceipt,
    invalidate
  };
}
