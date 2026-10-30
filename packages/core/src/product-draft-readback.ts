import { GatewayException } from './errors';
import { isProductOperationContext, type ProductOperationContext } from './product-operation-context';
import { IOP_REFERENCE_METHODS } from './product-reference-methods';

/**
 * Public read only: IOP status/get/v2, cid11. TOP has no guessed equivalent.
 * A trusted create/draft-list receipt authorizes one scoped ID lookup, not a deletion.
 * Only explicit successful status=draft becomes present; this module never returns absent.
 */
export const PRODUCT_DRAFT_STATUS_METHOD = IOP_REFERENCE_METHODS.getProductStatus;

export interface ProductDraftReadReceipt {
  kind: 'draft';
  source: 'draft-create' | 'draft-list';
  verified: true;
  receiptId: string;
  draftId: string;
  protocol: 'iop';
  context: ProductOperationContext;
  observedTimeUtc: number;
  expiresTimeUtc: number;
}
export interface ProductDraftReadbackInput {
  draftId: string;
  protocol: 'top' | 'iop';
  context: ProductOperationContext;
  /** Resolve from a trusted repository, never from an arbitrary UI command. */
  receipt: ProductDraftReadReceipt;
}
export interface ProductDraftReadCallOptions {
  requestId: string;
  protocol: 'iop';
  context: ProductOperationContext;
  maxAttempts: 1;
  allowRefresh: false;
  allowProtocolFallback: false;
}
export interface ProductDraftReadbackDependencies {
  /** Must be fixed-credential and one-shot. Do not supply a refreshing/fallback client. */
  client: {
    call(
      method: typeof PRODUCT_DRAFT_STATUS_METHOD,
      parameters: Readonly<{ product_id: number }>,
      options: Readonly<ProductDraftReadCallOptions>
    ): Promise<unknown>;
  };
  getCurrentContext():
    | { protocol: 'top' | 'iop'; context: ProductOperationContext }
    | null
    | Promise<{ protocol: 'top' | 'iop'; context: ProductOperationContext } | null>;
  validateCapabilityRequest(method: string, value: unknown): Promise<readonly unknown[]>;
  validateCapabilityResponse(method: string, value: unknown): Promise<readonly unknown[]>;
  now?: () => number;
  requestId?: string;
}
export type ProductDraftReadbackReason =
  | 'DRAFT_PRESENT'
  | 'DRAFT_RECEIPT_INVALID'
  | 'DRAFT_RECEIPT_EXPIRED'
  | 'DRAFT_PROTOCOL_UNSUPPORTED'
  | 'DRAFT_CONTEXT_CHANGED'
  | 'DRAFT_REQUEST_CONTRACT_INVALID'
  | 'DRAFT_RESPONSE_CONTRACT_INVALID'
  | 'DRAFT_STATUS_UNCONFIRMED'
  | 'DRAFT_READ_PERMISSION_DENIED'
  | 'DRAFT_READ_TIMEOUT'
  | 'DRAFT_READ_FAILED';
export interface ProductDraftReadbackResult {
  /** Request correlation only; not a provider-echoed identity or absence proof. */
  draftId: string;
  status: 'present' | 'unknown';
  reasonCode: ProductDraftReadbackReason;
  checkedTimeUtc: number;
  requestId: string | null;
  attempts: 0 | 1;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function time(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function exactId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]{0,15}$/u.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) > 0
  );
}
function sameContext(a: ProductOperationContext, b: ProductOperationContext): boolean {
  return a.identity === b.identity && a.gateway === b.gateway;
}
function receiptValid(
  receipt: unknown,
  input: ProductDraftReadbackInput
): receipt is ProductDraftReadReceipt {
  return (
    record(receipt) &&
    receipt.kind === 'draft' &&
    receipt.verified === true &&
    ['draft-create', 'draft-list'].includes(String(receipt.source)) &&
    typeof receipt.receiptId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u.test(receipt.receiptId) &&
    receipt.draftId === input.draftId &&
    receipt.protocol === 'iop' &&
    isProductOperationContext(receipt.context) &&
    sameContext(receipt.context, input.context) &&
    time(receipt.observedTimeUtc) &&
    time(receipt.expiresTimeUtc) &&
    receipt.expiresTimeUtc > receipt.observedTimeUtc
  );
}
function failedReadReason(error: unknown): ProductDraftReadbackReason {
  const value = error instanceof GatewayException ? error.gatewayError : record(error) ? error : {};
  const codes = [value.code, value.subCode];
  if (
    codes.some(
      (code) =>
        typeof code === 'string' &&
        [
          'PERMISSION_DENIED',
          'FORBIDDEN',
          'UNAUTHORIZED',
          'AUTH_REQUIRED',
          'isv.permission-api-package-limit',
          'isv.permission-api-package-not-exist'
        ].includes(code)
    )
  )
    return 'DRAFT_READ_PERMISSION_DENIED';
  if (
    codes.some(
      (code) =>
        typeof code === 'string' &&
        ['ETIMEDOUT', 'REQUEST_TIMEOUT', 'TIMEOUT', 'NETWORK_TIMEOUT'].includes(code)
    )
  )
    return 'DRAFT_READ_TIMEOUT';
  return 'DRAFT_READ_FAILED';
}
function explicitFailure(value: Record<string, unknown>): boolean {
  return (
    [value.success, value.biz_success].some((flag) => flag === false || flag === 'false') ||
    value.error_response !== undefined ||
    (value.error_code !== undefined &&
      value.error_code !== null &&
      !['', '0', 0].includes(value.error_code as string | number)) ||
    (value.code !== undefined && value.code !== 0 && value.code !== '0') ||
    (value.msg_code !== undefined &&
      value.msg_code !== null &&
      !['', '0', 0].includes(value.msg_code as string | number))
  );
}

/** Invalid IDs throw a fixed validation error; all uncertain read outcomes return unknown. */
export async function readProductDraftPresence(
  input: ProductDraftReadbackInput,
  dependencies: ProductDraftReadbackDependencies
): Promise<ProductDraftReadbackResult> {
  const now = dependencies.now ?? Date.now;
  const start = now();
  if (!time(start)) throw new Error('DRAFT_READ_CONFIGURATION_INVALID');
  if (!record(input) || !exactId(input.draftId))
    throw new GatewayException({
      code: 'DRAFT_READ_ID_INVALID',
      message: 'DRAFT_READ_ID_INVALID',
      retryable: false
    });
  const result: ProductDraftReadbackResult = {
    draftId: input.draftId,
    status: 'unknown',
    reasonCode: 'DRAFT_RECEIPT_INVALID',
    checkedTimeUtc: start,
    requestId: null,
    attempts: 0
  };
  const finish = (reasonCode: ProductDraftReadbackReason): ProductDraftReadbackResult => {
    result.reasonCode = reasonCode;
    const checked = now();
    result.checkedTimeUtc = time(checked) ? checked : start;
    return result;
  };
  if (input.protocol !== 'iop') return finish('DRAFT_PROTOCOL_UNSUPPORTED');
  if (!isProductOperationContext(input.context) || !receiptValid(input.receipt, input))
    return finish('DRAFT_RECEIPT_INVALID');
  // Snapshot all trusted fields before awaiting validators or caller-supplied dependencies.
  const context = { ...input.context },
    receipt = {
      ...input.receipt,
      context: { ...input.receipt.context }
    };
  const stillFresh = () => {
    const current = now();
    return time(current) && current >= receipt.observedTimeUtc && current < receipt.expiresTimeUtc;
  };
  if (!stillFresh()) return finish('DRAFT_RECEIPT_EXPIRED');
  const draftId = input.draftId;
  const requestId = dependencies.requestId ?? globalThis.crypto.randomUUID();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(requestId))
    throw new Error('DRAFT_READ_CONFIGURATION_INVALID');
  result.requestId = requestId;
  const checkScope = async (): Promise<ProductDraftReadbackReason | null> => {
    const current = await dependencies.getCurrentContext();
    if (current?.protocol !== 'iop') return 'DRAFT_PROTOCOL_UNSUPPORTED';
    if (!isProductOperationContext(current.context) || !sameContext(context, current.context))
      return 'DRAFT_CONTEXT_CHANGED';
    return stillFresh() ? null : 'DRAFT_RECEIPT_EXPIRED';
  };
  let phase: 'scope' | 'request' | 'call' | 'response' = 'scope';
  try {
    let blocked = await checkScope();
    if (blocked) return finish(blocked);
    phase = 'request';
    const parameters = Object.freeze({ product_id: Number(draftId) });
    const requestIssues = await dependencies.validateCapabilityRequest(
      PRODUCT_DRAFT_STATUS_METHOD,
      parameters
    );
    if (!Array.isArray(requestIssues) || requestIssues.length)
      return finish('DRAFT_REQUEST_CONTRACT_INVALID');
    phase = 'scope';
    blocked = await checkScope();
    if (blocked) return finish(blocked);
    phase = 'call';
    result.attempts = 1;
    const call = await dependencies.client.call(PRODUCT_DRAFT_STATUS_METHOD, parameters, {
      requestId,
      protocol: 'iop',
      context: { ...context },
      maxAttempts: 1,
      allowRefresh: false,
      allowProtocolFallback: false
    });
    phase = 'scope';
    blocked = await checkScope();
    if (blocked) return finish(blocked);
    if (!record(call) || call.method !== PRODUCT_DRAFT_STATUS_METHOD)
      return finish('DRAFT_RESPONSE_CONTRACT_INVALID');
    phase = 'response';
    const data: unknown = structuredClone(call.data);
    const responseIssues = await dependencies.validateCapabilityResponse(PRODUCT_DRAFT_STATUS_METHOD, data);
    if (!Array.isArray(responseIssues) || responseIssues.length)
      return finish('DRAFT_RESPONSE_CONTRACT_INVALID');
    phase = 'scope';
    blocked = await checkScope();
    if (blocked) return finish(blocked);
    if (
      !record(data) ||
      (data.code !== 0 && data.code !== '0') ||
      !record(data.result) ||
      data.result.success !== true ||
      !record(data.result.data) ||
      explicitFailure(data) ||
      explicitFailure(data.result) ||
      data.result.data.status !== 'draft'
    )
      return finish('DRAFT_STATUS_UNCONFIRMED');
    result.status = 'present';
    return finish('DRAFT_PRESENT');
  } catch (error: unknown) {
    return finish(
      phase === 'request'
        ? 'DRAFT_REQUEST_CONTRACT_INVALID'
        : phase === 'response'
          ? 'DRAFT_RESPONSE_CONTRACT_INVALID'
          : failedReadReason(error)
    );
  }
}
