import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/product-draft-readback.json';
import { GatewayException } from '../src/errors';
import {
  PRODUCT_DRAFT_STATUS_METHOD,
  readProductDraftPresence,
  type ProductDraftReadbackInput,
  type ProductDraftReadbackDependencies
} from '../src/product-draft-readback';

function input(): ProductDraftReadbackInput {
  return {
    draftId: fixture.draftId,
    protocol: 'iop',
    context: structuredClone(fixture.context),
    receipt: structuredClone(fixture.receipt) as ProductDraftReadbackInput['receipt']
  };
}
function setup(data: unknown = fixture.responses.draft) {
  let current = { protocol: 'iop' as 'iop' | 'top', context: structuredClone(fixture.context) };
  let clock = fixture.now;
  const call = vi.fn<ProductDraftReadbackDependencies['client']['call']>(() =>
    Promise.resolve({ method: PRODUCT_DRAFT_STATUS_METHOD, data: structuredClone(data) })
  );
  const validateCapabilityRequest = vi.fn(() => Promise.resolve([] as unknown[]));
  const validateCapabilityResponse = vi.fn(() => Promise.resolve([] as unknown[]));
  const dependencies: ProductDraftReadbackDependencies = {
    client: { call },
    getCurrentContext: () => current,
    validateCapabilityRequest,
    validateCapabilityResponse,
    now: () => clock,
    requestId: fixture.requestId
  };
  return {
    call,
    dependencies,
    validateCapabilityRequest,
    validateCapabilityResponse,
    context: (value: typeof current) => {
      current = value;
    },
    time: (value: number) => {
      clock = value;
    }
  };
}
describe('scoped product draft presence readback', () => {
  it('is inert until explicitly invoked, then performs exactly one validated native read', async () => {
    const test = setup();
    expect(test.call).not.toHaveBeenCalled();
    const result = await readProductDraftPresence(input(), test.dependencies);
    expect(result).toEqual({
      draftId: fixture.draftId,
      status: 'present',
      reasonCode: 'DRAFT_PRESENT',
      checkedTimeUtc: fixture.now,
      requestId: fixture.requestId,
      attempts: 1
    });
    expect(test.validateCapabilityRequest).toHaveBeenCalledExactlyOnceWith(PRODUCT_DRAFT_STATUS_METHOD, {
      product_id: Number(fixture.draftId)
    });
    expect(test.call).toHaveBeenCalledExactlyOnceWith(
      PRODUCT_DRAFT_STATUS_METHOD,
      { product_id: Number(fixture.draftId) },
      {
        requestId: fixture.requestId,
        protocol: 'iop',
        context: fixture.context,
        maxAttempts: 1,
        allowRefresh: false,
        allowProtocolFallback: false
      }
    );
    expect(test.validateCapabilityResponse).toHaveBeenCalledExactlyOnceWith(
      PRODUCT_DRAFT_STATUS_METHOD,
      fixture.responses.draft
    );
  });
  it.each(['draft-create', 'draft-list'] as const)(
    'accepts a verified scoped %s receipt, not its age as existence proof',
    async (source) => {
      const value = input();
      value.receipt.source = source;
      expect((await readProductDraftPresence(value, setup().dependencies)).status).toBe('present');
    }
  );
  it.each(['online', 'pending', 'failed', 'deleted', 'unknown', 'DRAFT', '', null, undefined])(
    'keeps non-confirmed status %# unknown, never absent',
    async (status) => {
      const body = structuredClone(fixture.responses.draft);
      Reflect.set(body.result.data, 'status', status);
      const test = setup(body);
      const result = await readProductDraftPresence(input(), test.dependencies);
      expect(result.status).toBe('unknown');
      expect(result.reasonCode).toBe('DRAFT_STATUS_UNCONFIRMED');
      expect(test.call).toHaveBeenCalledTimes(1);
    }
  );
  it.each([undefined, false, 'true', 1])('requires explicit boolean result.success %#', async (success) => {
    const body = structuredClone(fixture.responses.draft);
    Reflect.set(body.result, 'success', success);
    expect((await readProductDraftPresence(input(), setup(body).dependencies)).status).toBe('unknown');
  });
  it.each([undefined, '401', 1, false])('requires explicit successful IOP code %#', async (code) => {
    const body = structuredClone(fixture.responses.draft);
    Reflect.set(body, 'code', code);
    expect((await readProductDraftPresence(input(), setup(body).dependencies)).status).toBe('unknown');
  });
  it.each([
    { code: '0', success: true, data: { status: 'draft' } },
    { code: '0', result: { success: true, data: null } },
    { code: '0', result: { success: true } },
    { code: '0', result: { success: true, data: { status: 'draft' }, msg_code: 'SYS_ERROR' } },
    { code: '0', success: false, result: { success: true, data: { status: 'draft' } } },
    { code: '0', success: 'false', result: { success: true, data: { status: 'draft' } } },
    { code: '0', error_code: 'SYS_ERROR', result: { success: true, data: { status: 'draft' } } },
    { code: '0', error_response: {}, result: { success: true, data: { status: 'draft' } } }
  ])('does not infer existence from aliases, malformed or contradictory payload %#', async (body) => {
    expect((await readProductDraftPresence(input(), setup(body).dependencies)).status).toBe('unknown');
  });
  it.each(['0', '-1', '01', '1e3', ' 1 ', '', '9007199254740993', null, 771901])(
    'rejects unsafe/non-exact ID %# before any client or validator',
    async (draftId) => {
      const value = input();
      Reflect.set(value, 'draftId', draftId);
      const test = setup();
      await expect(readProductDraftPresence(value, test.dependencies)).rejects.toThrow(
        'DRAFT_READ_ID_INVALID'
      );
      expect(test.call).not.toHaveBeenCalled();
      expect(test.validateCapabilityRequest).not.toHaveBeenCalled();
    }
  );
  it.each([
    ['kind', 'product'],
    ['source', 'product-list'],
    ['verified', false],
    ['receiptId', ''],
    ['draftId', fixture.otherDraftId],
    ['protocol', 'top'],
    ['observedTimeUtc', -1],
    ['expiresTimeUtc', null]
  ])('refuses untrusted receipt field %s %# without a lookup', async (field, value) => {
    const valueInput = input();
    Reflect.set(valueInput.receipt, field, value);
    const test = setup();
    expect((await readProductDraftPresence(valueInput, test.dependencies)).status).toBe('unknown');
    expect(test.call).not.toHaveBeenCalled();
  });
  it('binds receipt scope and current scope/protocol independently', async () => {
    const value = input();
    value.receipt.context = structuredClone(fixture.otherContext);
    let test = setup();
    expect((await readProductDraftPresence(value, test.dependencies)).reasonCode).toBe(
      'DRAFT_RECEIPT_INVALID'
    );
    expect(test.call).not.toHaveBeenCalled();
    test = setup();
    test.context({ protocol: 'iop', context: fixture.otherContext });
    expect((await readProductDraftPresence(input(), test.dependencies)).reasonCode).toBe(
      'DRAFT_CONTEXT_CHANGED'
    );
    expect(test.call).not.toHaveBeenCalled();
    test = setup();
    test.context({ protocol: 'top', context: fixture.context });
    expect((await readProductDraftPresence(input(), test.dependencies)).reasonCode).toBe(
      'DRAFT_PROTOCOL_UNSUPPORTED'
    );
    expect(test.call).not.toHaveBeenCalled();
  });
  it.each(['expired', 'future'] as const)('does not read using %s receipt evidence', async (mode) => {
    const value = input();
    if (mode === 'expired') value.receipt.expiresTimeUtc = fixture.now;
    else value.receipt.observedTimeUtc = fixture.now + 1;
    const test = setup();
    expect((await readProductDraftPresence(value, test.dependencies)).reasonCode).toBe(
      'DRAFT_RECEIPT_EXPIRED'
    );
    expect(test.call).not.toHaveBeenCalled();
  });
  it('checks context and expiry after asynchronous request validation, before dispatch', async () => {
    for (const change of ['scope', 'expiry']) {
      const test = setup();
      test.validateCapabilityRequest.mockImplementation(() => {
        if (change === 'scope') test.context({ protocol: 'iop', context: fixture.otherContext });
        else test.time(fixture.receipt.expiresTimeUtc);
        return Promise.resolve([]);
      });
      expect((await readProductDraftPresence(input(), test.dependencies)).status).toBe('unknown');
      expect(test.call).not.toHaveBeenCalled();
    }
  });
  it('discards in-flight success after configuration changes or evidence expiry', async () => {
    for (const change of ['scope', 'expiry']) {
      const test = setup();
      test.call.mockImplementation(() => {
        if (change === 'scope') test.context({ protocol: 'iop', context: fixture.otherContext });
        else test.time(fixture.receipt.expiresTimeUtc);
        return Promise.resolve({ method: PRODUCT_DRAFT_STATUS_METHOD, data: fixture.responses.draft });
      });
      expect((await readProductDraftPresence(input(), test.dependencies)).status).toBe('unknown');
      expect(test.call).toHaveBeenCalledTimes(1);
    }
  });
  it('snapshots scoped input and freezes request parameters across caller mutation', async () => {
    const value = input(),
      test = setup();
    test.validateCapabilityRequest.mockImplementation(() => {
      value.draftId = fixture.otherDraftId;
      value.context.gateway = fixture.otherContext.gateway;
      value.receipt.expiresTimeUtc = fixture.now;
      return Promise.resolve([]);
    });
    const result = await readProductDraftPresence(value, test.dependencies);
    expect(result.draftId).toBe(fixture.draftId);
    expect(test.call.mock.calls[0]?.[1]).toEqual({ product_id: Number(fixture.draftId) });
  });
  it('fails closed when the existing request validator is unavailable, or throws', async () => {
    for (const throws of [false, true]) {
      const test = setup();
      test.validateCapabilityRequest.mockImplementation(() =>
        throws ? Promise.reject(new Error(fixture.note)) : Promise.resolve([{ keyword: 'validator' }])
      );
      expect((await readProductDraftPresence(input(), test.dependencies)).reasonCode).toBe(
        'DRAFT_REQUEST_CONTRACT_INVALID'
      );
      expect(test.call).not.toHaveBeenCalled();
    }
  });
  it('does not accept a validator failure or exception after the sole call', async () => {
    for (const throws of [false, true]) {
      const test = setup();
      test.validateCapabilityResponse.mockImplementation(() =>
        throws ? Promise.reject(new Error(fixture.note)) : Promise.resolve([{ keyword: 'type' }])
      );
      expect((await readProductDraftPresence(input(), test.dependencies)).reasonCode).toBe(
        'DRAFT_RESPONSE_CONTRACT_INVALID'
      );
      expect(test.call).toHaveBeenCalledTimes(1);
    }
  });
  it.each([
    ['isv.permission-api-package-limit', 'DRAFT_READ_PERMISSION_DENIED'],
    ['ETIMEDOUT', 'DRAFT_READ_TIMEOUT'],
    ['ALIBABA_IOP_UPSTREAM_ERROR', 'DRAFT_READ_FAILED'],
    ['B_PRODUCT_NOT_FOUND', 'DRAFT_READ_FAILED']
  ])('maps %s to unknown without retry, raw messages or absence inference', async (code, reason) => {
    const test = setup();
    test.call.mockRejectedValue(new GatewayException({ code, message: fixture.note, retryable: false }));
    const result = await readProductDraftPresence(input(), test.dependencies);
    expect(result).toMatchObject({ status: 'unknown', reasonCode: reason, attempts: 1 });
    expect(JSON.stringify(result)).not.toContain(fixture.note);
    expect(test.call).toHaveBeenCalledTimes(1);
  });
});
