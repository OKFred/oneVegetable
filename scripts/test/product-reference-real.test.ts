import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import credentials from '../../mock/data/node-gateway-credentials.json';
import examples from '../../mock/data/product-reference/examples.json';
import {
  REFERENCE_METHODS,
  ReferenceReadGuard,
  businessAccepted,
  createNodeBffSession,
  parseOptions,
  productIdentity,
  readIopBundle,
  referenceRows,
  runReadPlan,
  safeErrorCode,
  safeTraceId,
  sanitizeOwnTitle,
  summarizeReceipt,
  runGatewayAcceptance,
  validatePredictionTitle
} from '../smoke-product-reference-real';
import type {
  EqualityChecks,
  ReadObservation,
  ReferenceOperation,
  ReferenceReader
} from '../smoke-product-reference-real';
import type { NetworkTransport } from '../../packages/core/src/network';

const productId = '880001',
  categoryId = '220001';
const args = [
  '--confirm-readonly',
  '--credential=artifacts/reference-input.json',
  `--product-id=${productId}`,
  '--output=artifacts/reference-receipt.json'
];
const signed = (requestId: string, extra = ''): RequestInit => ({
  method: 'POST',
  headers: { 'X-Request-ID': requestId },
  body: 'app_key=fixture&access_token=fixture&sign=fixture&sign_method=sha256' + extra
});
const url = (operation: ReferenceOperation) =>
  'https://openapi-api.alibaba.com/rest' + REFERENCE_METHODS[operation];

async function integrationProbe(
  override?: (operation: ReferenceOperation, body: unknown) => unknown,
  protocol: 'top' | 'iop' = 'iop',
  predictionTitle?: string
) {
  const requests: { operation: ReferenceOperation; requestId: string | null; parameters: URLSearchParams }[] =
    [];
  let now = 0;
  const guard = new ReferenceReadGuard(
    {
      async send(input, init) {
        const request = new Request(input, init),
          path = new URL(request.url).pathname.slice('/rest'.length);
        const operation = (Object.keys(REFERENCE_METHODS) as ReferenceOperation[]).find(
          (key) => REFERENCE_METHODS[key] === path
        );
        if (!operation) throw new Error('UNEXPECTED_METHOD');
        requests.push({
          operation,
          requestId: request.headers.get('X-Request-ID'),
          parameters: new URLSearchParams(await request.text())
        });
        const body: unknown = {
          ...examples[REFERENCE_METHODS[operation]].response,
          request_id: randomUUID(),
          private_debug: 'https://private.example/media?token=fixture-secret'
        };
        const result = override ? override(operation, body) : body;
        return result instanceof Response ? result : Response.json(result);
      }
    },
    () => now,
    (ms) => {
      now += ms;
      return Promise.resolve();
    }
  );
  const session = await createNodeBffSession(
    {
      protocol,
      appKey: 'fixture-app-key',
      appSecret: 'fixture-app-secret',
      accessToken: 'fixture-access-token',
      endpoint:
        protocol === 'iop' ? 'https://openapi-api.alibaba.com/rest' : 'https://eco.taobao.com/router/rest',
      signMethod: 'hmac-sha256'
    },
    guard
  );
  const external = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_EXTERNAL_NETWORK'));
  const observations: ReadObservation[] = [];
  try {
    const checks = await runGatewayAcceptance(
      session.client,
      guard,
      productId,
      observations,
      ['fixture-app-key', 'fixture-app-secret', 'fixture-access-token'],
      () => Promise.resolve(),
      predictionTitle
    );
    expect(external).not.toHaveBeenCalled();
    return {
      requests,
      observations,
      checks,
      summary: summarizeReceipt(observations, checks),
      network: guard.snapshot()
    };
  } finally {
    external.mockRestore();
    session.close();
  }
}

describe('actual core to authenticated Node BFF to guarded IOP (offline fixtures)', () => {
  it('uses an explicit human descriptor unchanged without changing the product or retrying prediction', async () => {
    const result = await integrationProbe(undefined, 'iop', 'Stemmed Drinking Glass');
    const prediction = result.requests.filter((entry) => entry.operation === 'predictCategory');
    expect(prediction).toHaveLength(1);
    expect(prediction[0]?.parameters.get('title')).toBe('Stemmed Drinking Glass');
    expect(
      result.requests.find((entry) => entry.operation === 'getProduct')?.parameters.get('product_id')
    ).toBe(productId);
    expect(result.network.total).toBe(5);
    expect(JSON.stringify({ ...result.summary, observations: result.observations })).not.toContain('Stemmed');
  }, 30_000);
  it('reports contract-invalid product separately from sending, matching the first redacted failure', async () => {
    const result = await integrationProbe((operation, body) =>
      operation === 'getProduct' ? { code: '0', success: true, product_info: 'invalid-fixture-shape' } : body
    );
    const product = result.observations.find((entry) => entry.operation === 'getProduct');
    expect(product).toMatchObject({
      contractValid: false,
      accepted: false,
      networkRequests: 1,
      rowCount: null,
      errorCode: 'ALIBABA_IOP_RESPONSE_INVALID'
    });
    expect(product?.requestId).toMatch(/^[a-f0-9-]{36}$/u);
    expect(product?.traceId).not.toBeNull();
    expect(result.summary).toMatchObject({
      accepted: false,
      testSummary: { acceptedMethods: 2, skippedMethods: 2 }
    });
    expect(result.network).toEqual({ sent: 3, total: 3, activeSent: 0, blocked: 0 });
    expect(result.observations.reduce((sum, entry) => sum + entry.networkRequests, 0)).toBe(
      result.network.sent
    );
  }, 30_000);
  it('does not retry a 503 or follow a redirect, including a redirect to TOP', async () => {
    for (const response of [
      new Response('private upstream error', { status: 503 }),
      new Response(null, { status: 302, headers: { Location: 'https://eco.taobao.com/router/rest' } })
    ]) {
      const result = await integrationProbe((operation, body) =>
        operation === 'listCategories' ? response : body
      );
      expect(result.requests.filter((entry) => entry.operation === 'listCategories')).toHaveLength(1);
      expect(result.network.total).toBe(5);
      expect(result.summary.accepted).toBe(false);
      expect(result.observations.find((entry) => entry.operation === 'listCategories')?.rowCount).toBeNull();
    }
  }, 30_000);
  it('reads all five APIs using exact product/category IDs, sanitized own title and correlated requestIds', async () => {
    const result = await integrationProbe();
    expect(result.summary).toMatchObject({
      accepted: true,
      dataConsistent: true,
      equalityChecks: {
        productIdExact: true,
        attributeCategoryFromDetail: true,
        predictionCategoryMatchesDetail: true
      }
    });
    expect(result.network).toMatchObject({ total: 5, blocked: 0 });
    expect(result.observations.map((entry) => entry.rowCount)).toEqual([1, 2, 2, 1, 2]);
    expect(new Set(result.requests.map((request) => request.requestId)).size).toBe(5);
    for (const request of result.requests) {
      expect(result.observations.find((entry) => entry.operation === request.operation)?.requestId).toBe(
        request.requestId
      );
      if (request.operation === 'getProduct') expect(request.parameters.get('product_id')).toBe(productId);
      if (request.operation === 'getAttributes')
        expect(request.parameters.get('category_id')).toBe(categoryId);
      if (request.operation === 'predictCategory') {
        expect(request.parameters.get('title')).toBe('Unbranded glass cup');
        expect(request.parameters.has('description')).toBe(false);
        expect(request.parameters.has('image')).toBe(false);
      }
      if (request.operation === 'listCategories')
        expect(request.parameters.has('parent_category_id')).toBe(false);
    }
    const receipt = JSON.stringify({ ...result.summary, observations: result.observations });
    for (const forbidden of [
      'Unbranded',
      'CUP-01',
      'CUP-CLEAR',
      'private.example',
      'fixture-secret',
      'fixture-app-key',
      'fixture-app-secret',
      'fixture-access-token',
      'descriptionHtml',
      'product_info'
    ])
      expect(receipt).not.toContain(forbidden);
  }, 30_000);
  it('does not equate a different category suggestion with rejected API acceptance', async () => {
    const result = await integrationProbe((operation, body) =>
      operation === 'predictCategory'
        ? { code: '0', result: { success: true, data: { category_id: 220002 } } }
        : body
    );
    expect(result.summary).toMatchObject({
      accepted: true,
      equalityChecks: { predictionCategoryMatchesDetail: false }
    });
  }, 30_000);
  it('does not accept missing attribute rows as a proven zero', async () => {
    const result = await integrationProbe((operation, body) =>
      operation === 'getAttributes' ? { code: '0', success: true, data: {} } : body
    );
    expect(result.observations.find((entry) => entry.operation === 'getAttributes')?.rowCount).toBeNull();
    expect(result.summary.dataConsistent).toBe(false);
  }, 30_000);
  it('does not unlock category/prediction reads for a wrong product ID', async () => {
    const result = await integrationProbe((operation, body) => {
      if (operation !== 'getProduct') return body;
      return { code: '0', success: true, product_info: { basic_info: { product_id: 880002 } } };
    });
    expect(result.requests.map((entry) => entry.operation)).toEqual([
      'getProduct',
      'listCategories',
      'listShippingTemplates'
    ]);
    expect(result.summary).toMatchObject({ accepted: false, testSummary: { skippedMethods: 2 } });
  }, 30_000);
  it('rejects native-only methods under TOP before any provider request', async () => {
    const result = await integrationProbe(undefined, 'top');
    expect(result.requests).toEqual([]);
    expect(result.summary.accepted).toBe(false);
    expect(
      result.observations.filter((entry) => entry.status === 'failed').map((entry) => entry.errorCode)
    ).toEqual([
      'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
      'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
      'ALIBABA_IOP_AUTHORIZATION_REQUIRED'
    ]);
  }, 30_000);
});

describe('product reference real acceptance safety (offline)', () => {
  it('accepts only a bounded explicit prediction title, without silent trimming or normalization', () => {
    const title = 'Stemmed Drinking Glass';
    expect(parseOptions([...args, '--prediction-title=' + title]).predictionTitle).toBe(title);
    expect(() => {
      validatePredictionTitle('A'.repeat(160));
    }).not.toThrow();
    for (const invalid of [
      '',
      'A'.repeat(161),
      ' title',
      'title ',
      'Glass\nCup',
      '<b>Glass</b>',
      'https://private.example/a',
      'www.private.example',
      'private@example.com',
      '123456',
      'Glass\u0000Cup'
    ]) {
      expect(() => parseOptions([...args, '--prediction-title=' + invalid])).toThrow(
        'PREDICTION_TITLE_INVALID'
      );
    }
    expect(() => parseOptions([...args, '--prediction-title=Glass', '--prediction-title=Cup'])).toThrow();
  });
  it('uses only a matching product to unlock dependent reads and checks the category echo', async () => {
    const getAttributes = vi
      .fn()
      .mockResolvedValue({ categoryId: '220002', attributes: [], saleAttributes: [] });
    const predictCategory = vi.fn().mockResolvedValue({ categoryId, categoryName: null, categoryPath: null });
    const reader: ReferenceReader = {
      getProduct: vi.fn().mockResolvedValue({ productId, categoryId, title: '<b>Glass cup</b>' }),
      listCategories: vi.fn().mockResolvedValue([]),
      getAttributes,
      predictCategory,
      listShippingTemplates: vi.fn().mockResolvedValue([])
    };
    const skipped = vi.fn();
    const checks = await runReadPlan(
      reader,
      productId,
      async (_operation, read) => ({ value: await read(), accepted: true }),
      skipped
    );
    expect(getAttributes).toHaveBeenCalledWith(categoryId);
    expect(predictCategory).toHaveBeenCalledWith({ title: 'Glass cup' });
    expect(checks).toMatchObject({
      productIdExact: true,
      attributeCategoryFromDetail: false,
      predictionCategoryMatchesDetail: true
    });
    expect(skipped).not.toHaveBeenCalled();
    expect(productIdentity({ productId: 9007199254740992, categoryId, title: 'Glass' }).id).toBeNull();
  });
  it('blocks unarmed traffic, wrong origins/paths/requestIds, token and TOP before transport', async () => {
    const send = vi.fn<NetworkTransport['send']>().mockResolvedValue(Response.json({ code: '0' }));
    const guard = new ReferenceReadGuard({ send }),
      requestId = randomUUID();
    await expect(guard.send(url('getProduct'), signed(requestId))).rejects.toThrow(
      'READ_ONLY_NETWORK_DENIED'
    );
    guard.arm('getProduct', requestId);
    for (const target of [
      'https://eco.taobao.com/router/rest',
      'https://openapi-api.alibaba.com/rest/auth/token/refresh',
      'https://openapi-api.alibaba.com/rest/auth/token/create',
      'https://openapi-api.alibaba.com/rest/alibaba/icbu/product/status/get/v2',
      'https://openapi-api.alibaba.com/rest/alibaba/icbu/product/update/v2',
      url('listCategories'),
      url('getProduct') + '?x=1',
      url('getProduct') + '#fragment'
    ])
      await expect(guard.send(target, signed(requestId))).rejects.toThrow('READ_ONLY_NETWORK_DENIED');
    await expect(guard.send(url('getProduct'), signed(randomUUID()))).rejects.toThrow(
      'READ_ONLY_NETWORK_DENIED'
    );
    expect(send).not.toHaveBeenCalled();
    expect(guard.snapshot().total).toBe(0);
  });
  it('requires signed IOP POST, rejects TOP parameters, and consumes failed attempts without retry', async () => {
    for (const extra of ['&method=top.alias', '&session=top', '&refresh_token=fixture']) {
      const send = vi.fn<NetworkTransport['send']>().mockResolvedValue(Response.json({}));
      const guard = new ReferenceReadGuard({ send }),
        requestId = randomUUID();
      guard.arm('getProduct', requestId);
      await expect(guard.send(url('getProduct'), signed(requestId, extra))).rejects.toThrow(
        'READ_ONLY_NETWORK_DENIED'
      );
      await expect(guard.send(url('getProduct'), signed(requestId))).rejects.toThrow(
        'READ_ONLY_NETWORK_DENIED'
      );
      expect(send).not.toHaveBeenCalled();
    }
    const send = vi.fn<NetworkTransport['send']>().mockRejectedValue(new Error('private provider error'));
    const guard = new ReferenceReadGuard({ send }),
      requestId = randomUUID();
    guard.arm('getProduct', requestId);
    await expect(guard.send(url('getProduct'), signed(requestId))).rejects.toThrow();
    await expect(guard.send(url('getProduct'), signed(requestId))).rejects.toThrow(
      'READ_ONLY_NETWORK_DENIED'
    );
    guard.disarm();
    expect(() => {
      guard.arm('getProduct', randomUUID());
    }).toThrow('READ_GUARD_ARM_DENIED');
    expect(send).toHaveBeenCalledOnce();
    expect(guard.snapshot()).toMatchObject({ sent: 1, total: 1, activeSent: 0 });
  });
  it('forces redirect:error and serial starts at least 350ms apart for all five methods', async () => {
    let now = 1_000;
    const starts: number[] = [];
    const send = vi.fn<NetworkTransport['send']>().mockImplementation((_input, init) => {
      starts.push(now);
      expect(init.redirect).toBe('error');
      return Promise.resolve(Response.json({ code: '0' }));
    });
    const guard = new ReferenceReadGuard(
      { send },
      () => now,
      (ms) => {
        now += ms;
        return Promise.resolve();
      }
    );
    for (const operation of Object.keys(REFERENCE_METHODS) as ReferenceOperation[]) {
      const requestId = randomUUID();
      guard.arm(operation, requestId);
      await guard.send(url(operation), signed(requestId));
      expect(guard.snapshot().activeSent).toBe(1);
      guard.disarm();
      expect(guard.snapshot().activeSent).toBe(0);
    }
    expect(starts).toEqual([1000, 1350, 1700, 2050, 2400]);
    expect(guard.snapshot()).toEqual({ sent: 5, total: 5, activeSent: 0, blocked: 0 });
  });
  it('reserves before awaits so parallel duplicates cannot reach transport', async () => {
    const released = Promise.withResolvers<undefined>();
    const send = vi.fn<NetworkTransport['send']>().mockImplementation(async () => {
      await released.promise;
      return Response.json({ code: '0' });
    });
    const guard = new ReferenceReadGuard({ send }),
      requestId = randomUUID();
    guard.arm('getProduct', requestId);
    const first = guard.send(url('getProduct'), signed(requestId));
    await expect(guard.send(url('getProduct'), signed(requestId))).rejects.toThrow(
      'READ_ONLY_NETWORK_DENIED'
    );
    released.resolve(undefined);
    await first;
    expect(send).toHaveBeenCalledOnce();
  });
  it('sanitizes the own title without persisting it or using private descriptions/media for prediction', () => {
    expect(
      sanitizeOwnTitle(
        '<b>Glass cup</b> https://private.example/a?token=secret contact@example.com 1234567890'
      )
    ).toBe('Glass cup');
    expect(sanitizeOwnTitle('1234567890')).toBeNull();
    expect(sanitizeOwnTitle(undefined)).toBeNull();
    expect(sanitizeOwnTitle('Cup '.repeat(100))?.length).toBeLessThanOrEqual(160);
  });
  it('preserves unknown row counts and separates API acceptance from equality', () => {
    expect(referenceRows({ code: '0', result: { success: true } })).toBeNull();
    expect(referenceRows({ data: [] })).toEqual([]);
    expect(referenceRows({ data: [null] })).toBeNull();
    expect(businessAccepted({ code: '0', result: { success: false } })).toBe(false);
    expect(businessAccepted({ code: '123', success: true })).toBe(false);
    expect(businessAccepted({ data: [] })).toBe(false);
    expect(businessAccepted(examples[REFERENCE_METHODS.getProduct].response)).toBe(true);
    const observations = (Object.keys(REFERENCE_METHODS) as ReferenceOperation[]).map(
      (operation): ReadObservation => ({
        operation,
        method: REFERENCE_METHODS[operation],
        protocol: 'iop',
        requestId: randomUUID(),
        traceId: null,
        contractValid: true,
        accepted: true,
        status: 'accepted',
        rowCount: 1,
        networkRequests: 1,
        errorCode: null
      })
    );
    const checks: EqualityChecks = {
      productIdExact: true,
      attributeCategoryFromDetail: true,
      predictionCategoryMatchesDetail: false
    };
    expect(summarizeReceipt(observations, checks)).toMatchObject({
      accepted: true,
      dataConsistent: true,
      testSummary: { equalitiesFailed: 1 }
    });
    const first = observations[0];
    if (!first) throw new Error('MISSING_TEST_OBSERVATION');
    first.rowCount = null;
    expect(summarizeReceipt(observations, checks)).toMatchObject({
      accepted: true,
      dataConsistent: false,
      testSummary: { unknownRowCounts: 1 }
    });
  });
  it('redacts unknown errors and bounds trace IDs, excluding credentials', () => {
    expect(safeErrorCode(new Error('private title https://private.example/media?token=secret'))).toBe(
      'ERROR_REDACTED'
    );
    expect(safeErrorCode({ gatewayError: { code: 'REQUEST_CONTRACT_INVALID', message: 'private' } })).toBe(
      'REQUEST_CONTRACT_INVALID'
    );
    expect(safeTraceId('https://private.example')).toBeNull();
    expect(safeTraceId('abcdef001122')).toBe('abcdef001122');
    expect(safeTraceId('abcdef001122', ['abcdef'])).toBeNull();
  });
  it('requires four explicit arguments once and rejects unrelated modes and malformed targets', () => {
    expect(parseOptions(args)).toEqual({
      credential: 'artifacts/reference-input.json',
      productId,
      output: 'artifacts/reference-receipt.json'
    });
    for (const input of [
      [],
      args.slice(1),
      [...args, '--confirm-readonly'],
      [...args, '--refresh'],
      [...args, '--credential=other'],
      args.map((item) => (item.startsWith('--product-id=') ? '--product-id=0' : item)),
      args.map((item) => (item.startsWith('--output=') ? '--output=artifacts/reference-input.json' : item))
    ])
      expect(() => parseOptions(input)).toThrow();
    expect(
      parseOptions(
        args.map((item) => (item.startsWith('--product-id=') ? '--product-id=90071992547409931234' : item))
      ).productId
    ).toBe('90071992547409931234');
  });
  it('requires explicit, unexpired IOP authorization, not TOP, legacy, null or expired bundles', () => {
    const bundle = {
      ...credentials.oauthBundle,
      protocol: 'iop',
      oauth: {
        ...credentials.oauthBundle.oauth,
        expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString()
      }
    };
    expect(readIopBundle({ authorization: bundle }).protocol).toBe('iop');
    for (const value of [
      credentials.oauthBundle,
      { ...bundle, protocol: 'top' },
      {},
      { ...bundle, oauth: { ...bundle.oauth, expiresAtUtc: null } },
      { ...bundle, oauth: { ...bundle.oauth, expiresAtUtc: new Date(0).toISOString() } }
    ])
      expect(() => readIopBundle(value)).toThrow();
  });
  it('pins exactly five immutable native full paths, excluding status, token, writes and TOP aliases', () => {
    expect(Object.values(REFERENCE_METHODS).sort()).toEqual(
      [
        '/alibaba/icbu/category/predict/v2',
        '/alibaba/icbu/category/get/v2',
        '/alibaba/icbu/category/attribute/get/v2',
        '/alibaba/icbu/product/get/v2',
        '/alibaba/icbu/product/list/shipping/templates'
      ].sort()
    );
    expect(Object.isFrozen(REFERENCE_METHODS)).toBe(true);
  });
});
