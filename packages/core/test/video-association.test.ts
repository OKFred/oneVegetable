import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/video/association-core.json';
import videoFixture from '../../../mock/data/video/top.json';
import videoDocs from '../../../docs/alibaba-video-api-docs.json';
import {
  VideoAssociationAdapter,
  VIDEO_ASSOCIATION_METHODS,
  VIDEO_ASSOCIATION_READBACK_LIMIT,
  validateVideoAssociationRequest,
  validateVideoAssociationVerifyRequest,
  validateVideoAssociationResult
} from '../src/video-association';
import type {
  VideoAssociationOptions,
  VideoAssociationRequest,
  VideoAssociationVerifyRequest
} from '../src/video-association';
import { validateCapabilityRequest, validateCapabilityResponse } from '../src/capability-validation-worker';
import { findCapability, getCapabilityDefinition } from '../src/capability-registry';
import { GatewayException } from '../src/errors';
import { isOperationId } from '../src/operation-id';

const query = 'alibaba.icbu.video.query';
const productList = 'alibaba.icbu.product.list';
const related = 'alibaba.icbu.video.relation.product.list';
const decrypt = 'alibaba.icbu.product.id.decrypt';
const main = VIDEO_ASSOCIATION_METHODS[0];
const detail = VIDEO_ASSOCIATION_METHODS[1];
const request = (): VideoAssociationRequest => structuredClone(fixture.request) as VideoAssociationRequest;
const verification = (): VideoAssociationVerifyRequest => {
  const { confirmed: _confirmed, ...target } = request();
  return target;
};

function setup(options: VideoAssociationOptions = { realCallEnabled: true }) {
  const responses: Record<string, unknown> = {
    [query]: structuredClone(videoFixture.query),
    [productList]: structuredClone(fixture.products),
    [related]: structuredClone(videoFixture.relations),
    [decrypt]: structuredClone(videoFixture.decrypt),
    [main]: structuredClone(fixture.main),
    [detail]: structuredClone(fixture.detail)
  };
  const events: string[] = [];
  const call = vi.fn((method: string, _payload: Readonly<Record<string, unknown>>) => {
    events.push(method);
    const data = responses[method];
    if (data instanceof Error) return Promise.reject(data);
    return Promise.resolve({ method, data });
  });
  const wait = vi.fn((ms: number) => {
    events.push(`wait:${ms}`);
    return Promise.resolve();
  });
  return {
    responses,
    call,
    wait,
    events,
    adapter: new VideoAssociationAdapter({ call }, validateCapabilityRequest, validateCapabilityResponse, {
      ...options,
      wait
    })
  };
}

const permission = () =>
  new GatewayException({
    code: '27',
    subCode: 'isv.permission-api-package-limit',
    message: 'Not permitted',
    traceId: 'permission-trace',
    retryable: false
  });

describe('product video association contract', () => {
  it('exports strict, separately sliced request/result validators and operation IDs', () => {
    expect(validateVideoAssociationRequest(request())).toBe(true);
    expect(validateVideoAssociationVerifyRequest(verification())).toBe(true);
    expect(validateVideoAssociationVerifyRequest(request())).toBe(false);
    expect(isOperationId('associateProductVideo')).toBe(true);
    expect(isOperationId('verifyProductVideoAssociation')).toBe(true);
    for (const outcome of ['confirmed', 'unconfirmed', 'rejected', 'unknown'])
      expect(validateVideoAssociationResult({ outcome, traceId: null, code: null })).toBe(true);
    expect(validateVideoAssociationResult({ outcome: 'success', traceId: '', code: '' })).toBe(false);
  });

  it.each(VIDEO_ASSOCIATION_METHODS)('keeps %s documented, typed, and real-disabled', async (method) => {
    expect(findCapability(method)).toMatchObject({
      enabled: true,
      realCallEnabled: false,
      verification: 'documented',
      risk: 'mutation',
      checkedAt: '2026-09-21'
    });
    const definition = getCapabilityDefinition(method);
    expect(definition).toMatchObject({
      realCallEnabled: false,
      verification: 'documented',
      risk: 'mutation'
    });
    expect(await validateCapabilityRequest(method, definition?.requestExample)).toEqual([]);
    expect(await validateCapabilityResponse(method, definition?.responseExample)).toEqual([]);
    expect(await validateCapabilityRequest(method, { video_id: 900001, product_id: '900003' })).not.toEqual(
      []
    );
    expect(await validateCapabilityRequest(method, { video_id: '900001' })).not.toEqual([]);
    expect(await validateCapabilityResponse(method, { model: 'true', msg_code: '00000' })).not.toEqual([]);
  });

  it('records the INVALID detail sample override without inventing success evidence', () => {
    const doc = videoDocs.definitions.find((item) => item.method === detail);
    expect(doc?.responseExampleOverride?.reason).toContain('INVALID JSON');
    expect(doc?.responseExampleOverride?.originalSample).toContain('"model":结果');
    expect(doc?.responseExample).toEqual({ model: false, msg_code: 'code', msg_info: 'info' });
  });
});

describe('fail-closed video mutation', () => {
  it('defaults to zero network calls and ignores non-boolean enabling values', async () => {
    const call = vi.fn();
    const adapter = new VideoAssociationAdapter(
      { call },
      validateCapabilityRequest,
      validateCapabilityResponse
    );
    expect(await adapter.associate(request())).toEqual({
      outcome: 'rejected',
      traceId: null,
      code: 'VIDEO_ASSOCIATION_DISABLED'
    });
    expect(call).not.toHaveBeenCalled();
    for (const enabled of [false, 'true', 1, undefined]) {
      const test = setup({ realCallEnabled: enabled as boolean });
      expect((await test.adapter.associate(request())).outcome).toBe('rejected');
      expect(test.call).not.toHaveBeenCalled();
    }
  });

  it.each([
    { confirmed: false },
    { confirmed: 'true' },
    { confirmed: undefined },
    { productId: '0' },
    { productId: '01' },
    { productId: 900003 },
    { productId: '9e5' },
    { videoId: 'opaque' },
    { videoId: 900001 },
    { videoId: '9007199254740993' },
    { encryptedVideoId: '' },
    { encryptedVideoId: '   ' },
    { encryptedVideoId: 'x'.repeat(257) },
    { type: 'videoId' },
    { language: 'ENGLISH' },
    { realCallEnabled: true }
  ])('rejects malformed requests before network: %j', async (change) => {
    const test = setup();
    const value = { ...request(), ...change } as unknown as VideoAssociationRequest;
    expect(await test.adapter.associate(value)).toEqual({
      outcome: 'rejected',
      traceId: null,
      code: 'REQUEST_CONTRACT_INVALID'
    });
    expect(test.call).not.toHaveBeenCalled();
  });

  it('rejects null/undefined input without throwing or networking', async () => {
    const test = setup();
    for (const value of [null, undefined]) {
      expect((await test.adapter.associate(value as unknown as VideoAssociationRequest)).outcome).toBe(
        'rejected'
      );
      expect((await test.adapter.verify(value as unknown as VideoAssociationVerifyRequest)).outcome).toBe(
        'unconfirmed'
      );
    }
    expect(test.call).not.toHaveBeenCalled();
  });

  it('does not truncate or round an oversized decimal product ID', async () => {
    const test = setup();
    expect((await test.adapter.associate({ ...request(), productId: '9007199254740993' })).outcome).toBe(
      'rejected'
    );
    expect(test.call.mock.calls.map(([method]) => method)).toEqual([query]);
  });

  it.each(['other-encrypted-id', 'encrypted-example '])(
    'requires the exact plain/encrypted pair: %s',
    async (encryptedVideoId) => {
      const test = setup();
      expect(await test.adapter.associate({ ...request(), encryptedVideoId })).toMatchObject({
        outcome: 'rejected',
        code: 'VIDEO_ID_PAIR_MISMATCH'
      });
      expect(test.call.mock.calls.map(([method]) => method)).toEqual([query]);
      expect(test.call.mock.calls[0]?.[1]).toEqual({ current_page: 1, page_size: 20, id: 900001 });
    }
  );

  it.each(['absent', 'duplicate', 'other-id'])('rejects %s video lookup results', async (kind) => {
    const test = setup();
    const value = structuredClone(videoFixture.query);
    if (kind === 'absent') value.result.model.list = [];
    if (kind === 'duplicate') value.result.model.list.push(...structuredClone(value.result.model.list));
    if (kind === 'other-id')
      value.result.model.list = value.result.model.list.map((row) => ({ ...row, id: 900002 }));
    test.responses[query] = value;
    expect((await test.adapter.associate(request())).code).toBe('VIDEO_ID_PAIR_MISMATCH');
    expect(test.call).toHaveBeenCalledTimes(1);
  });

  it.each([{ products: [] }, { products: [{ id: 900004, subject: 'Other product', status: 'approved' }] }])(
    'requires an exact product match',
    async ({ products }) => {
      const test = setup();
      test.responses[productList] = { ...fixture.products, products };
      expect((await test.adapter.associate(request())).code).toBe('PRODUCT_NOT_FOUND');
      expect(test.call.mock.calls.map(([method]) => method)).toEqual([query, productList]);
      expect(test.call.mock.calls[1]?.[1]).toEqual({
        id: 900003,
        current_page: 1,
        page_size: 1,
        language: 'ENGLISH'
      });
    }
  );

  it.each([query, productList])('stops on preflight permission denial at %s', async (method) => {
    const test = setup();
    test.responses[method] = permission();
    expect(await test.adapter.associate(request())).toMatchObject({
      outcome: 'rejected',
      code: 'isv.permission-api-package-limit'
    });
    expect(
      test.call.mock.calls.some(([called]) => VIDEO_ASSOCIATION_METHODS.includes(called as typeof main))
    ).toBe(false);
  });

  it('validates the write contract before any preflight', async () => {
    const call = vi.fn();
    const adapter = new VideoAssociationAdapter(
      { call },
      () => Promise.resolve([{ instancePath: '/', keyword: 'required' }]),
      validateCapabilityResponse,
      { realCallEnabled: true }
    );
    expect((await adapter.associate(request())).code).toBe('REQUEST_CONTRACT_INVALID');
    expect(call).not.toHaveBeenCalled();
  });
});

describe('mutation receipts and readback', () => {
  it('sends one string-ID mutation and confirms only from exact decrypted readback', async () => {
    const test = setup();
    expect(await test.adapter.associate(request())).toEqual({
      outcome: 'confirmed',
      traceId: 'mock-main-write',
      code: '00000'
    });
    expect(test.call.mock.calls.map(([method]) => method)).toEqual([
      query,
      productList,
      main,
      related,
      decrypt
    ]);
    expect(test.call.mock.calls[2]?.[1]).toEqual({ video_id: '900001', product_id: '900003' });
    expect(test.call.mock.calls[3]?.[1]).toEqual({ video_id: 'encrypted-example', type: 'videoId' });
    expect(test.events).toEqual([
      query,
      'wait:300',
      productList,
      'wait:300',
      main,
      'wait:300',
      related,
      'wait:300',
      decrypt
    ]);
  });

  it('freezes all validated IDs, type and language during preflight', async () => {
    const test = setup();
    const target = request();
    const pending = test.adapter.associate(target);
    Object.assign(target, {
      productId: '100',
      videoId: '200',
      encryptedVideoId: 'changed',
      type: 'detail',
      language: 'zh_CN',
      confirmed: false
    });
    expect((await pending).outcome).toBe('confirmed');
    expect(test.call.mock.calls[2]).toEqual([main, { video_id: '900001', product_id: '900003' }]);
    expect(test.call.mock.calls[4]?.[1]).toEqual({ product_id: 'encrypted-product', language: 'ENGLISH' });
  });

  it.each([
    [{ model: false, msg_code: '00000' }, 'unknown'],
    [{ model: true, msg_code: '0' }, 'unknown'],
    [{ model: true, msg_code: '200' }, 'unknown'],
    [{ model: true, msg_code: 0 }, 'unknown'],
    [{ model: 'true', msg_code: '00000' }, 'unknown'],
    [{ model: true }, 'unknown'],
    [{ msg_code: '00000' }, 'unknown'],
    [{ model: true, msg_code: '00000', success: false }, 'unknown']
  ])('never treats malformed/non-strict main responses as success: %j', async (response, outcome) => {
    const test = setup();
    test.responses[main] = response;
    expect((await test.adapter.associate(request())).outcome).toBe(outcome);
    expect(test.call.mock.calls.map(([method]) => method)).toEqual([query, productList, main]);
  });

  it.each(['main', 'detail'] as const)(
    'keeps contradictory or malformed %s rejections unknown',
    async (type) => {
      const method = type === 'main' ? main : detail;
      for (const response of [
        { model: false, success: true },
        { model: false, biz_success: true },
        { model: false, msg_code: 0 },
        { model: false, msg_info: {} },
        { model: false, success: 'false' },
        { model: true, success: false },
        { model: true, biz_success: false }
      ]) {
        const test = setup();
        test.responses[method] = { ...response, request_id: 'conflicting-write' };
        expect(await test.adapter.associate({ ...request(), type })).toMatchObject({
          outcome: 'unknown',
          traceId: 'conflicting-write'
        });
        expect(test.call.mock.calls.map(([called]) => called)).toEqual([query, productList, method]);
      }
    }
  );

  it.each(['main', 'detail'] as const)(
    'retains a valid explicit %s rejection without readback',
    async (type) => {
      const test = setup();
      const method = type === 'main' ? main : detail;
      test.responses[method] = fixture.rejected;
      expect(await test.adapter.associate({ ...request(), type })).toEqual({
        outcome: 'rejected',
        traceId: 'mock-rejected',
        code: 'MOCK_REJECTED'
      });
      expect(test.call.mock.calls.map(([called]) => called)).toEqual([query, productList, method]);
    }
  );

  it('does not let a simultaneous error envelope prove rejection of a success payload', async () => {
    const test = setup();
    test.responses[main] = {
      ...fixture.permission,
      alibaba_icbu_video_relation_product_main_response: fixture.main
    };
    expect((await test.adapter.associate(request())).outcome).toBe('unknown');
    expect(test.call.mock.calls.map(([method]) => method)).toEqual([query, productList, main]);
  });

  it('does not classify a local response-validator exception as an upstream write rejection', async () => {
    const test = setup();
    const adapter = new VideoAssociationAdapter(
      { call: test.call },
      validateCapabilityRequest,
      (method, value) => {
        if (method === main) return Promise.reject(permission());
        return validateCapabilityResponse(method, value);
      },
      { realCallEnabled: true, wait: test.wait }
    );
    expect(await adapter.associate(request())).toEqual({
      outcome: 'unknown',
      traceId: 'mock-main-write',
      code: '00000'
    });
    expect(test.call.mock.calls.map(([method]) => method)).toEqual([query, productList, main]);
  });

  it.each([
    { success: false, alibaba_icbu_video_relation_product_main_response: fixture.main },
    { biz_success: false, alibaba_icbu_video_relation_product_main_response: fixture.main },
    { success: true, alibaba_icbu_video_relation_product_main_response: fixture.rejected }
  ])('does not discard conflicting outer write flags: %j', async (response) => {
    const test = setup();
    test.responses[main] = response;
    expect((await test.adapter.associate(request())).outcome).toBe('unknown');
    expect(test.call.mock.calls.map(([method]) => method)).toEqual([query, productList, main]);
  });

  it('never resends an ambiguous write during repeated unsuccessful manual verification', async () => {
    const test = setup();
    test.responses[main] = { model: false, msg_code: '00000' };
    expect((await test.adapter.associate(request())).outcome).toBe('unknown');
    test.responses[query] = permission();
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await test.adapter.verify(verification())).outcome).toBe('unconfirmed');
    }
    expect(test.call.mock.calls.filter(([method]) => method === main)).toHaveLength(1);
    expect(test.call.mock.calls.some(([method]) => method === detail)).toBe(false);
  });

  it.each(['TIMEOUT', 'NETWORK_ERROR', 'UPSTREAM_UNAVAILABLE', 'INVALID_JSON_RESPONSE', 'ABORTED'])(
    'returns unknown for ambiguous %s without retry/readback',
    async (code) => {
      const test = setup();
      test.responses[main] = new GatewayException({
        code,
        message: code,
        retryable: true,
        traceId: 'ambiguous-trace'
      });
      expect(await test.adapter.associate(request())).toEqual({
        outcome: 'unknown',
        traceId: 'ambiguous-trace',
        code
      });
      expect(test.call.mock.calls.map(([method]) => method)).toEqual([query, productList, main]);
    }
  );

  it('stops on an unambiguous TOP permission error and preserves its receipt', async () => {
    const test = setup();
    test.responses[main] = fixture.permission;
    expect(await test.adapter.associate(request())).toEqual({
      outcome: 'rejected',
      traceId: 'mock-permission',
      code: 'isv.permission-api-package-limit'
    });
    expect(test.call).toHaveBeenCalledTimes(3);
  });

  it('unwraps TOP method envelopes and preserves transport trace IDs', async () => {
    const test = setup();
    test.responses[main] = { alibaba_icbu_video_relation_product_main_response: fixture.main };
    expect((await test.adapter.associate(request())).traceId).toBe('mock-main-write');
  });

  it.each(['code', '00000', '0', '200', undefined])(
    'does not infer detail success from code %s',
    async (code) => {
      const test = setup();
      test.responses[detail] = {
        model: true,
        ...(code ? { msg_code: code } : {}),
        request_id: 'detail-receipt'
      };
      test.responses[related] = videoFixture.emptyRelations;
      expect(await test.adapter.associate({ ...request(), type: 'detail' })).toEqual({
        outcome: 'unconfirmed',
        traceId: 'detail-receipt',
        code: code ?? null
      });
      expect(test.call.mock.calls[3]?.[1]).toEqual({ video_id: 'encrypted-example', type: 'detailVideoId' });
    }
  );

  it('confirms detail only via readback, with locale preserved', async () => {
    const test = setup();
    expect(await test.adapter.associate({ ...request(), type: 'detail', language: 'zh_CN' })).toEqual({
      outcome: 'confirmed',
      traceId: 'mock-detail-write',
      code: 'code'
    });
    expect(test.call.mock.calls[1]?.[1]).toMatchObject({ language: 'CHINESE' });
    expect(test.call.mock.calls[4]?.[1]).toEqual({ product_id: 'encrypted-product', language: 'CHINESE' });
  });

  it('stops on detail permission errors even when a contradictory true model is returned', async () => {
    const test = setup();
    test.responses[detail] = { model: true, msg_code: 'isv.permission-api-package-limit' };
    expect(await test.adapter.associate({ ...request(), type: 'detail' })).toMatchObject({
      outcome: 'unknown',
      code: 'isv.permission-api-package-limit'
    });
    expect(test.call.mock.calls.map(([method]) => method)).toEqual([query, productList, detail]);
  });

  it.each([related, decrypt])('preserves the write receipt when readback fails at %s', async (method) => {
    const test = setup();
    test.responses[method] = permission();
    expect(await test.adapter.associate(request())).toEqual({
      outcome: 'unconfirmed',
      traceId: 'mock-main-write',
      code: '00000'
    });
    expect(test.call.mock.calls.at(-1)?.[0]).toBe(method);
  });

  it.each([videoFixture.emptyRelations, { result: { msg_code: '0' } }])(
    'never confirms missing or empty relations',
    async (response) => {
      const test = setup();
      test.responses[related] = response;
      expect((await test.adapter.associate(request())).outcome).toBe('unconfirmed');
      expect(test.call.mock.calls.some(([method]) => method === decrypt)).toBe(false);
    }
  );

  it.each([{ id: 900004 }, { id: 9007199254740992 }, {}, { id: '900003broken' }])(
    'never confirms mismatched or unsafe decrypted IDs: %j',
    async (response) => {
      const test = setup();
      test.responses[decrypt] = response;
      expect((await test.adapter.associate(request())).outcome).toBe('unconfirmed');
    }
  );
});

describe('bounded read-only verification', () => {
  it.each([productList, decrypt])(
    'does not accept a matching %s ID alongside a failed outer status',
    async (method) => {
      const test = setup();
      test.responses[method] = {
        success: false,
        [`${method.replaceAll('.', '_')}_response`]: test.responses[method]
      };
      expect((await test.adapter.verify(verification())).outcome).toBe('unconfirmed');
      expect(test.call.mock.calls.at(-1)?.[0]).toBe(method);
      expect(test.call.mock.calls.some(([called]) => called === main || called === detail)).toBe(false);
    }
  );

  it('accepts valid method envelopes without inventing success flags for product reads', async () => {
    const test = setup();
    for (const method of [query, productList, related, decrypt]) {
      test.responses[method] = { [`${method.replaceAll('.', '_')}_response`]: test.responses[method] };
    }
    expect((await test.adapter.verify(verification())).outcome).toBe('confirmed');
    expect(test.call.mock.calls.map(([method]) => method)).toEqual([query, productList, related, decrypt]);
  });

  it.each([
    ['missing code', { result: { model: videoFixture.query.result.model } }],
    ['wrong method code', { result: { ...videoFixture.query.result, msg_code: '0' } }],
    ['malformed metadata', { result: { ...videoFixture.query.result, msg_info: 123 } }],
    ['nested failure', { result: { ...videoFixture.query.result, biz_success: false } }],
    ['outer failure', { success: false, alibaba_icbu_video_query_response: videoFixture.query }],
    [
      'partial IDs',
      {
        result: {
          ...videoFixture.query.result,
          model: {
            ...videoFixture.query.result.model,
            list: [...videoFixture.query.result.model.list, { id: 900002 }]
          }
        }
      }
    ]
  ])('fails closed on video preflight %s before any write', async (_name, response) => {
    for (const verifying of [false, true]) {
      const test = setup();
      test.responses[query] = response;
      const value = verifying
        ? await test.adapter.verify(verification())
        : await test.adapter.associate(request());
      expect(value.outcome).toBe(verifying ? 'unconfirmed' : 'rejected');
      expect(test.call.mock.calls.map(([method]) => method)).toEqual([query]);
    }
  });

  it.each([
    ['missing code', { result: { model: videoFixture.relations.result.model } }],
    ['wrong method code', { result: { ...videoFixture.relations.result, msg_code: '200' } }],
    ['nested failure', { result: { ...videoFixture.relations.result, biz_success: false } }],
    ['malformed metadata', { result: { ...videoFixture.relations.result, msg_info: 123 } }],
    ['partial IDs', { result: { msg_code: '0', model: [{ product_id: 'encrypted-product' }, {}] } }],
    [
      'blank ID',
      { result: { msg_code: '0', model: [{ product_id: 'encrypted-product' }, { product_id: ' ' }] } }
    ],
    [
      'outer failure',
      { success: false, alibaba_icbu_video_relation_product_list_response: videoFixture.relations }
    ]
  ])('never confirms an incomplete or failed relation read: %s', async (_name, response) => {
    for (const verifying of [false, true]) {
      const test = setup();
      test.responses[related] = response;
      const value = verifying
        ? await test.adapter.verify(verification())
        : await test.adapter.associate(request());
      expect(value).toMatchObject({ outcome: 'unconfirmed' });
      if (!verifying) expect(value).toMatchObject({ traceId: 'mock-main-write', code: '00000' });
      expect(test.call.mock.calls.at(-1)?.[0]).toBe(related);
      expect(test.call.mock.calls.some(([method]) => method === decrypt)).toBe(false);
    }
  });

  it('works while mutation is disabled and never invokes any write/schema/full-shop query', async () => {
    const test = setup({ realCallEnabled: false });
    expect(await test.adapter.verify(verification())).toEqual({
      outcome: 'confirmed',
      traceId: 'mock-relations',
      code: null
    });
    expect(test.call.mock.calls.map(([method]) => method)).toEqual([query, productList, related, decrypt]);
    expect(test.call.mock.calls[0]?.[1]).toMatchObject({ id: 900001 });
    expect(test.call.mock.calls[1]?.[1]).toMatchObject({ id: 900003, page_size: 1 });
  });

  it('rejects a verifier carrying confirmed without making any call', async () => {
    const test = setup();
    expect(await test.adapter.verify(request())).toMatchObject({
      outcome: 'unconfirmed',
      code: 'REQUEST_CONTRACT_INVALID'
    });
    expect(test.call).not.toHaveBeenCalled();
  });

  it.each(['invalid', 'id-pair', 'missing-product', 'permission'])(
    'never marks a past write rejected after verifier failure: %s',
    async (kind) => {
      const test = setup();
      const target = verification();
      if (kind === 'invalid') target.productId = 'invalid';
      if (kind === 'id-pair') target.encryptedVideoId = 'wrong-pair';
      if (kind === 'missing-product') test.responses[productList] = { products: [] };
      if (kind === 'permission') test.responses[query] = permission();
      expect((await test.adapter.verify(target)).outcome).toBe('unconfirmed');
      expect(test.call.mock.calls.some(([method]) => method === main || method === detail)).toBe(false);
    }
  );

  it('does not claim confirmation when the candidate set exceeds the budget', async () => {
    const test = setup();
    test.responses[related] = {
      result: {
        msg_code: '0',
        model: Array.from({ length: VIDEO_ASSOCIATION_READBACK_LIMIT + 1 }, (_, index) => ({
          product_id: `mock-encrypted-${index}`
        }))
      }
    };
    expect(await test.adapter.verify(verification())).toEqual({
      outcome: 'unconfirmed',
      traceId: null,
      code: 'VIDEO_READBACK_LIMIT'
    });
    expect(test.call).toHaveBeenCalledTimes(3);
  });

  it('decrypts at most ten distinct candidates sequentially with 300ms gaps', async () => {
    const test = setup();
    test.responses[related] = {
      result: {
        msg_code: '0',
        model: Array.from({ length: 10 }, (_, index) => ({ product_id: `mock-encrypted-${index}` }))
      }
    };
    test.responses[decrypt] = { id: 900004 };
    expect((await test.adapter.verify(verification())).outcome).toBe('unconfirmed');
    expect(test.call.mock.calls.filter(([method]) => method === decrypt)).toHaveLength(10);
    expect(test.events.slice(5)).toEqual(Array.from({ length: 10 }, () => ['wait:300', decrypt]).flat());
  });

  it('stops immediately on the first decrypt permission error', async () => {
    const test = setup();
    test.responses[related] = {
      result: { msg_code: '0', model: [{ product_id: 'first' }, { product_id: 'second' }] }
    };
    test.responses[decrypt] = permission();
    expect((await test.adapter.verify(verification())).outcome).toBe('unconfirmed');
    expect(test.call.mock.calls.filter(([method]) => method === decrypt)).toHaveLength(1);
  });

  it('deduplicates encrypted IDs, stops after the first exact match, and never decrypts display IDs', async () => {
    const test = setup();
    test.responses[related] = {
      result: {
        msg_code: '0',
        model: [{ product_id: 'first' }, { product_id: 'first' }, { product_id: 'second' }]
      }
    };
    expect((await test.adapter.verify(verification())).outcome).toBe('confirmed');
    expect(test.call.mock.calls.filter(([method]) => method === decrypt)).toEqual([
      [decrypt, { product_id: 'first', language: 'ENGLISH' }]
    ]);
  });
});
