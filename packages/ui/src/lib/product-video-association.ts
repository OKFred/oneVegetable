import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import type { RequestOf, ResponseOf } from '@one-vegetable/core';
import type { Video } from '@one-vegetable/core/video';
import {
  validateVideoAssociationVerifyRequest,
  validateVideoAssociationResult
} from '@one-vegetable/core/video-association';
import { useServices } from './services';
import { VIDEO_ASSOCIATION_LOCK, VIDEO_ASSOCIATION_PREFIX } from './video-association-storage';

type Request = RequestOf<'verifyProductVideoAssociation'>;
type Result = ResponseOf<'associateProductVideo'>;
export interface VideoAssociationReceipt extends Result {
  version: 1;
  requestId: string;
  request: Request;
  state: Result['outcome'] | 'sending';
  updatedAt: number;
}
export interface VideoAssociationIntent {
  identity: string;
  request: Readonly<Request>;
}
const decimal = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]*$/.test(v);
const token = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 2048 && !/\p{Cc}/u.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
function validRequest(v: unknown): v is Request {
  return validateVideoAssociationVerifyRequest(v);
}
function validResult(v: unknown): v is Result {
  return validateVideoAssociationResult(v);
}
function validReceipt(v: unknown): v is VideoAssociationReceipt {
  return (
    record(v) &&
    v.version === 1 &&
    token(v.requestId) &&
    validRequest(v.request) &&
    validResult({ outcome: v.outcome, traceId: v.traceId, code: v.code }) &&
    (v.state === v.outcome || (v.state === 'sending' && v.outcome === 'unknown')) &&
    Number.isSafeInteger(v.updatedAt)
  );
}
export function associationReceiptBlocks(receipt: VideoAssociationReceipt | null): boolean {
  return !!receipt && !['confirmed', 'rejected'].includes(receipt.state);
}
function readReceipt(key: string): VideoAssociationReceipt | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const v: unknown = JSON.parse(raw);
  if (!validReceipt(v)) throw new Error('receipt');
  return v;
}
function persist(key: string, receipt: VideoAssociationReceipt): void {
  // Allowlist fields: never store video/media data, credentials or full provider responses.
  const value = JSON.stringify({
    version: 1,
    requestId: receipt.requestId,
    request: receipt.request,
    state: receipt.state,
    outcome: receipt.outcome,
    traceId: receipt.traceId,
    code: receipt.code,
    updatedAt: receipt.updatedAt
  });
  localStorage.setItem(key, value);
  if (localStorage.getItem(key) !== value) throw new Error('receipt');
}

export function useProductVideoAssociation(
  target: () => { productId: string; language: Request['language']; blocked: boolean }
) {
  const services = useServices();
  const receipt = shallowRef<VideoAssociationReceipt | null>(null);
  const identity = ref('');
  const allowed = ref(false),
    verifyAllowed = ref(false),
    busy = ref(false),
    loading = ref(false);
  const error = ref<
    '' | 'associationStorage' | 'associationUnavailable' | 'associationUnknown' | 'associationBlocked'
  >('');
  const corrupt = ref(false);
  let generation = 0;
  let disposed = false;
  const unresolved = computed(() => corrupt.value || associationReceiptBlocks(receipt.value));
  const keyFor = (stamp: string, id: string) =>
    VIDEO_ASSOCIATION_PREFIX + JSON.stringify([services.mode, stamp, id]);
  async function context() {
    const value = await services.gateway.galleryTransferContext?.();
    if (!value && services.mode !== 'mock') throw new Error('context');
    return { value, stamp: value ? JSON.stringify([value.identity, value.gateway]) : 'mock' };
  }
  async function availability() {
    const data = await services.operationAvailability?.get([
      'associateProductVideo',
      'verifyProductVideoAssociation'
    ]);
    return {
      // This iteration deliberately has no real-write opt-in in the UI.
      write:
        services.mode === 'mock' &&
        data?.items.some((r) => r.operation === 'associateProductVideo' && r.allowed) === true,
      verify: data?.items.some((r) => r.operation === 'verifyProductVideoAssociation' && r.allowed) === true
    };
  }
  async function load() {
    if (busy.value) return;
    const current = ++generation,
      productId = target().productId;
    allowed.value = verifyAllowed.value = false;
    loading.value = true;
    error.value = '';
    identity.value = '';
    receipt.value = null;
    corrupt.value = false;
    try {
      if (!decimal(productId)) return;
      const c = await context(),
        key = keyFor(c.stamp, productId);
      let saved: VideoAssociationReceipt | null;
      try {
        saved = readReceipt(key);
        if (saved && saved.request.productId !== productId) throw new Error('receipt');
        if (saved?.state === 'sending' && 'locks' in navigator) {
          await navigator.locks.request(VIDEO_ASSOCIATION_LOCK, { ifAvailable: true }, (lock) => {
            if (!lock) return; // Another tab still owns the write.
            saved = readReceipt(key);
            if (saved?.state === 'sending') {
              saved = { ...saved, state: 'unknown', outcome: 'unknown', updatedAt: Date.now() };
              persist(key, saved);
            }
          });
        }
      } catch {
        if (current === generation) corrupt.value = true;
        throw new Error('receipt');
      }
      const beforeDisplay = await context();
      if (current !== generation) return;
      if (beforeDisplay.stamp !== c.stamp) throw new Error('context');
      identity.value = c.stamp;
      receipt.value = saved;
      const decision = await availability().catch(() => ({ write: false, verify: false }));
      const afterAvailability = await context();
      if (current !== generation) return;
      if (afterAvailability.stamp !== c.stamp) throw new Error('context');
      allowed.value = decision.write;
      verifyAllowed.value = decision.verify;
    } catch (cause) {
      if (current === generation) {
        identity.value = '';
        receipt.value = null;
        error.value =
          cause instanceof Error && cause.message === 'receipt'
            ? 'associationStorage'
            : 'associationUnavailable';
      }
    } finally {
      if (current === generation) loading.value = false;
    }
  }
  function prepare(video: Video, type: Request['type']): VideoAssociationIntent | null {
    const request = {
      productId: target().productId,
      videoId: video.id,
      encryptedVideoId: video.encryptedId,
      type,
      language: target().language
    };
    if (
      !allowed.value ||
      busy.value ||
      loading.value ||
      unresolved.value ||
      target().blocked ||
      !identity.value ||
      !validRequest(request)
    )
      return null;
    return Object.freeze({ identity: identity.value, request: Object.freeze(request) });
  }
  async function execute(intent: VideoAssociationIntent | null) {
    if (busy.value || loading.value || !identity.value || corrupt.value) return;
    const verifying = intent === null;
    if (
      (!verifying && (!allowed.value || unresolved.value || target().blocked)) ||
      (verifying && !verifyAllowed.value)
    )
      return;
    const stamp = intent?.identity ?? identity.value,
      productId = target().productId;
    const key = keyFor(stamp, productId),
      current = generation;
    busy.value = true;
    error.value = '';
    let preflightFailed = false;
    try {
      if (!('locks' in navigator)) throw new Error('locked');
      await navigator.locks.request(VIDEO_ASSOCIATION_LOCK, { ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error('locked');
        const c = await context(),
          decision = await availability();
        if (
          c.stamp !== stamp ||
          (await context()).stamp !== stamp ||
          current !== generation ||
          productId !== target().productId
        )
          throw new Error('context');
        const saved = readReceipt(key);
        let sent: VideoAssociationReceipt;
        if (verifying) {
          if (
            !decision.verify ||
            !saved ||
            !associationReceiptBlocks(saved) ||
            saved.request.productId !== productId
          )
            return;
          sent = saved;
        } else {
          if (
            !decision.write ||
            target().blocked ||
            !validRequest(intent.request) ||
            intent.request.productId !== productId ||
            intent.request.language !== target().language ||
            associationReceiptBlocks(saved)
          )
            throw new Error('locked');
          sent = {
            version: 1,
            requestId: crypto.randomUUID(),
            request: { ...intent.request },
            state: 'sending',
            outcome: 'unknown',
            traceId: null,
            code: null,
            updatedAt: Date.now()
          };
          persist(key, sent); // MUST succeed before any mutation request.
        }
        receipt.value = sent;
        const options = {
          requestId: verifying ? crypto.randomUUID() : sent.requestId,
          ...(c.value ? { galleryContext: c.value } : {})
        };
        let next: VideoAssociationReceipt;
        try {
          const result: unknown = verifying
            ? await services.gateway.request('verifyProductVideoAssociation', sent.request, options)
            : await services.gateway.request(
                'associateProductVideo',
                { ...sent.request, confirmed: true },
                options
              );
          if (!validResult(result)) throw new Error('result');
          // A rejected read is not proof that an earlier ambiguous write never happened.
          const outcome = verifying && result.outcome === 'rejected' ? 'unknown' : result.outcome;
          next = {
            ...sent,
            outcome,
            state: outcome,
            traceId: result.traceId?.slice(0, 256) ?? null,
            code: result.code?.slice(0, 256) ?? null,
            updatedAt: Date.now()
          };
          persist(key, next);
        } catch {
          next = { ...sent, state: 'unknown', outcome: 'unknown', updatedAt: Date.now() };
          try {
            persist(key, next);
          } catch {
            /* The durable sending receipt remains blocking. */
          }
          if (current === generation) error.value = 'associationUnknown';
        }
        // Persist to the original account even after navigation, but never display it in a new context.
        if (current === generation) {
          const afterSend = await context();
          if (current !== generation) return;
          if (afterSend.stamp === stamp) receipt.value = next;
          else invalidate();
        }
      });
    } catch {
      if (current === generation) {
        invalidate();
        preflightFailed = true;
      }
    } finally {
      busy.value = false;
      if (current !== generation && !disposed) await load();
      if (preflightFailed && !disposed) error.value = 'associationBlocked';
    }
  }
  function invalidate() {
    generation++;
    identity.value = '';
    allowed.value = verifyAllowed.value = loading.value = false;
    receipt.value = null;
  }
  onScopeDispose(() => {
    disposed = true;
    invalidate();
  });
  return {
    receipt,
    identity,
    allowed,
    verifyAllowed,
    busy,
    loading,
    error,
    unresolved,
    load,
    prepare,
    submit: execute,
    verify: () => execute(null),
    invalidate
  };
}
