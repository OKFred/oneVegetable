import type { AlibabaClient, AlibabaCallResult } from './alibaba-client';
import { findCapability } from './capability-registry';
import { GatewayException, normalizeGatewayError } from './errors';
import { ProductAdapter } from './product-adapter';
import { productListLanguage } from './preferences';
import { VideoAdapter, safeVideoId } from './video';
import type { VideoAssociationRequest, VideoAssociationVerifyRequest, VideoAssociationResult } from './types';
import {
  validateVideoAssociationRequest,
  validateVideoAssociationVerifyRequest
} from './generated/validators-video-association';

export type { VideoAssociationRequest, VideoAssociationVerifyRequest, VideoAssociationResult } from './types';
export {
  validateVideoAssociationRequest,
  validateVideoAssociationVerifyRequest,
  validateVideoAssociationResult
} from './generated/validators-video-association';

export const VIDEO_ASSOCIATION_METHODS = [
  'alibaba.icbu.video.relation.product.main',
  'alibaba.icbu.video.relation.product.detail'
] as const;
export const VIDEO_ASSOCIATION_OPERATIONS = [
  'associateProductVideo',
  'verifyProductVideoAssociation'
] as const;
export const VIDEO_ASSOCIATION_READBACK_LIMIT = 10;
export const VIDEO_ASSOCIATION_CALL_DELAY_MS = 300;

type Validator = (
  method: string,
  value: unknown
) => Promise<readonly { instancePath: string; keyword: string }[]>;

export interface VideoAssociationOptions {
  /** Explicit upstream policy decision, not a substitute for authorization or user confirmation.
   * Leave false in production until separately accepted. The generic registry stays disabled.
   * The supplied client MUST disable transport retries (AlibabaClient maxAttempts: 1).
   */
  realCallEnabled?: boolean;
  wait?: (ms: number) => Promise<void>;
}

type Receipt = Pick<VideoAssociationResult, 'traceId' | 'code'>;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length ? value : null;
const result = (
  outcome: VideoAssociationResult['outcome'],
  code: string | null = null,
  traceId: string | null = null
): VideoAssociationResult => ({ outcome, traceId, code });
const fail = (code: string, traceId?: string): never => {
  throw new GatewayException({ code, message: code, retryable: false, ...(traceId ? { traceId } : {}) });
};

function responseRoot(response: AlibabaCallResult, method: string): Record<string, unknown> {
  const envelope = record(response.data);
  if (!envelope) return fail('VIDEO_RESPONSE_INVALID', text(response.traceId) ?? undefined);
  const key = `${method.replaceAll('.', '_')}_response`;
  const wrapped = record(envelope[key]);
  const error = record(envelope.error_response);
  const traceId =
    text(response.traceId) ??
    text(wrapped?.request_id) ??
    text(envelope.request_id) ??
    text(error?.request_id);
  if (
    (Object.hasOwn(envelope, key) && !wrapped) ||
    (Object.hasOwn(envelope, 'error_response') &&
      (!error ||
        wrapped ||
        envelope.model !== undefined ||
        envelope.result !== undefined ||
        envelope.success === true ||
        envelope.biz_success === true))
  )
    fail('VIDEO_RESPONSE_INVALID', traceId ?? undefined);
  if (error) {
    throw new GatewayException({
      code:
        typeof error.code === 'string' || typeof error.code === 'number'
          ? String(error.code)
          : 'ALIBABA_ERROR',
      message: 'Alibaba rejected the request',
      retryable: false,
      ...(text(error.sub_code) ? { subCode: String(error.sub_code) } : {}),
      ...(traceId ? { traceId } : {})
    });
  }
  // Do not discard a contradictory outer status while unwrapping a plausible payload.
  if (
    wrapped &&
    ['success', 'biz_success'].some(
      (flag) => Object.hasOwn(envelope, flag) && (envelope[flag] !== true || wrapped.model === false)
    )
  )
    fail('VIDEO_RESPONSE_INVALID', traceId ?? undefined);
  return wrapped ?? envelope;
}

function errorReceipt(error: unknown): Receipt {
  const normalized = normalizeGatewayError(error);
  return { code: normalized.subCode ?? normalized.code, traceId: normalized.traceId ?? null };
}

// Only unmistakable authorization/parameter rejections prove a failed write. Transport,
// timeout, server and malformed-response errors remain ambiguous, even if retryable=false.
function isDefiniteRejection(error: unknown): boolean {
  const normalized = normalizeGatewayError(error);
  return [normalized.code, normalized.subCode].some(isRejectionCode);
}

function isRejectionCode(code: string | undefined): boolean {
  return (
    code !== undefined &&
    ([
      'AUTHENTICATION_FAILED',
      'PERMISSION_DENIED',
      'CAPABILITY_RESTRICTED',
      'REQUEST_CONTRACT_INVALID',
      'RATE_LIMITED',
      '401',
      '403',
      '429',
      '27',
      '29'
    ].includes(code) ||
      /^(?:isv\.(?:invalid-parameter|missing-parameter|permission|access-denied)|isp\.api-permission)/i.test(
        code
      ))
  );
}

/** Dedicated, fail-closed path; never enables the generic capability mutation route. */
export class VideoAssociationAdapter {
  private readonly enabled: boolean;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly video: VideoAdapter;

  constructor(
    private readonly client: Pick<AlibabaClient, 'call'>,
    private readonly validateRequest: Validator,
    private readonly validateResponse: Validator,
    options: VideoAssociationOptions = {}
  ) {
    this.enabled = options.realCallEnabled === true;
    this.wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    // The library tolerates partial metadata for browsing; a write preflight/readback must not.
    this.video = new VideoAdapter(
      { call: (method, payload) => this.read(method, payload) },
      validateRequest,
      validateResponse,
      this.wait
    );
  }

  async associate(request: VideoAssociationRequest): Promise<VideoAssociationResult> {
    if (!validateVideoAssociationRequest(request) || !safeVideoId(request.videoId))
      return result('rejected', 'REQUEST_CONTRACT_INVALID');
    if (!this.enabled) return result('rejected', 'VIDEO_ASSOCIATION_DISABLED');
    // Freeze the validated identifiers across async preflight/readback; do not read a caller's
    // mutable object again after the first await.
    const target = { ...request };
    const method = target.type === 'main' ? VIDEO_ASSOCIATION_METHODS[0] : VIDEO_ASSOCIATION_METHODS[1];
    const payload = { video_id: target.videoId, product_id: target.productId };
    try {
      const capability = findCapability(method);
      if (
        !capability?.enabled ||
        capability.lifecycle !== 'active' ||
        capability.restricted ||
        capability.risk !== 'mutation'
      )
        fail('CAPABILITY_RESTRICTED');
      if ((await this.validateRequest(method, payload)).length) fail('REQUEST_CONTRACT_INVALID');
      await this.preflight(target);
      await this.wait(VIDEO_ASSOCIATION_CALL_DELAY_MS);
    } catch (error) {
      return { outcome: 'rejected', ...errorReceipt(error) };
    }

    let receipt: Receipt = { traceId: null, code: null };
    let validatingReceipt = false;
    try {
      // Exactly one invocation. No retries, no fallback write, no schema mutation.
      const response = await this.client.call(method, payload);
      const root = responseRoot(response, method);
      receipt = { traceId: text(response.traceId) ?? text(root.request_id), code: text(root.msg_code) };
      // A malformed or contradictory rejection must not unlock a caller's unresolved receipt.
      validatingReceipt = true;
      if ((await this.validateResponse(method, root)).length) return { outcome: 'unknown', ...receipt };
      if (root.model === false) {
        const contradictory =
          root.success === true ||
          root.biz_success === true ||
          (target.type === 'main' && root.msg_code === '00000');
        return { outcome: contradictory ? 'unknown' : 'rejected', ...receipt };
      }
      if (root.success === false || root.biz_success === false || isRejectionCode(receipt.code ?? undefined))
        return { outcome: 'unknown', ...receipt };
      if (root.model !== true) return { outcome: 'unknown', ...receipt };
      if (target.type === 'main' && root.msg_code !== '00000') return { outcome: 'unknown', ...receipt };
      // Detail has NO documented success code: model=true is only provisional.
    } catch (error) {
      const failure = errorReceipt(error);
      return {
        // A local validator can throw too; its error is not a provider rejection.
        outcome: !validatingReceipt && isDefiniteRejection(error) ? 'rejected' : 'unknown',
        traceId: receipt.traceId ?? failure.traceId,
        code: receipt.code ?? failure.code
      };
    }
    return this.readback(target, receipt);
  }

  async verify(request: VideoAssociationVerifyRequest): Promise<VideoAssociationResult> {
    if (!validateVideoAssociationVerifyRequest(request) || !safeVideoId(request.videoId))
      return result('unconfirmed', 'REQUEST_CONTRACT_INVALID');
    const target = { ...request };
    try {
      await this.preflight(target);
    } catch (error) {
      const failure = errorReceipt(error);
      // A read failure says nothing about whether an earlier mutation was applied.
      return { outcome: 'unconfirmed', ...failure };
    }
    return this.readback(target, { traceId: null, code: null });
  }

  private async preflight(target: VideoAssociationVerifyRequest): Promise<void> {
    const page = await this.video.list({ page: 1, pageSize: 20, id: target.videoId });
    if (page.issues.some((issue) => issue.endsWith(':invalid-id')))
      fail('VIDEO_RESPONSE_INVALID', page.traceId);
    const matches = page.items.filter((item) => item.id === target.videoId);
    if (matches.length !== 1 || matches[0]?.encryptedId !== target.encryptedVideoId)
      fail('VIDEO_ID_PAIR_MISMATCH', page.traceId);
    await this.wait(VIDEO_ASSOCIATION_CALL_DELAY_MS);
    const product = await new ProductAdapter({
      call: (method, payload) => this.read(method, payload)
    }).getSummary(target.productId, target.language);
    if (product?.id !== target.productId) fail('PRODUCT_NOT_FOUND');
  }

  private async read(method: string, payload: Readonly<Record<string, unknown>>): Promise<AlibabaCallResult> {
    const capability = findCapability(method);
    if (
      !capability?.enabled ||
      capability.lifecycle !== 'active' ||
      capability.restricted ||
      !capability.realCallEnabled ||
      capability.risk !== 'read'
    )
      fail('CAPABILITY_RESTRICTED');
    if ((await this.validateRequest(method, payload)).length) fail('REQUEST_CONTRACT_INVALID');
    const response = await this.client.call(method, payload);
    const root = responseRoot(response, method);
    const traceId = text(response.traceId) ?? text(root.request_id) ?? undefined;
    const nested = record(root.result);
    if (
      [root, nested].some(
        (value) =>
          value &&
          ['success', 'biz_success'].some((flag) => Object.hasOwn(value, flag) && value[flag] !== true)
      )
    )
      fail('VIDEO_PROVIDER_REJECTED', traceId);
    // These two methods have different success codes. Product list/decrypt have none;
    // their validated data and exact identifiers below remain the evidence instead.
    const expectedCode =
      method === 'alibaba.icbu.video.query'
        ? '200'
        : method === 'alibaba.icbu.video.relation.product.list'
          ? '0'
          : null;
    if (expectedCode !== null && nested?.msg_code !== expectedCode) fail('VIDEO_PROVIDER_REJECTED', traceId);
    if ((await this.validateResponse(method, root)).length) fail('VIDEO_RESPONSE_INVALID', traceId);
    return { ...response, method, data: root };
  }

  private async readback(
    target: VideoAssociationVerifyRequest,
    receipt: Receipt
  ): Promise<VideoAssociationResult> {
    let traceId = receipt.traceId;
    try {
      await this.wait(VIDEO_ASSOCIATION_CALL_DELAY_MS);
      const relations = await this.video.related({ videoId: target.encryptedVideoId, type: target.type });
      traceId ??= text(relations.traceId);
      if (relations.issues.length) fail('VIDEO_RESPONSE_INVALID', traceId ?? undefined);
      // Too many candidates is an incomplete verification, not proof of absence or success.
      if (relations.encryptedProductIds.length > VIDEO_ASSOCIATION_READBACK_LIMIT)
        return result('unconfirmed', receipt.code ?? 'VIDEO_READBACK_LIMIT', traceId);
      for (const encryptedProductId of relations.encryptedProductIds) {
        await this.wait(VIDEO_ASSOCIATION_CALL_DELAY_MS);
        const response = await this.read('alibaba.icbu.product.id.decrypt', {
          product_id: encryptedProductId,
          language: productListLanguage(target.language)
        });
        const id = record(response.data)?.id;
        // Preserve decimal text and reject unsafe numeric provider IDs without rounding.
        const productId = typeof id === 'string' && /^[1-9][0-9]*$/.test(id) ? id : safeVideoId(id);
        if (productId === null) fail('VIDEO_RESPONSE_INVALID');
        if (productId === target.productId) return result('confirmed', receipt.code, traceId);
      }
      return result('unconfirmed', receipt.code, traceId);
    } catch (error) {
      // Includes permission failures: stop immediately, never continue decrypting or retry.
      const failure = errorReceipt(error);
      return result('unconfirmed', receipt.code ?? failure.code, traceId ?? failure.traceId);
    }
  }
}
