import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import fixtures from '../../../mock/data/order-fulfillment/examples.json';
import failures from '../../../mock/data/order-fulfillment/failures.json';
import scoreFixture from '../../../mock/data/product-score-protocols.json';
import { AlibabaClient } from '../src/alibaba-client';
import { IOP_BUSINESS_ENDPOINT, signIopRequest } from '../src/alibaba-iop';
import { createIopBusinessRequest, normalizeIopBusinessResponse } from '../src/alibaba-iop-business';
import { getIopMethod } from '../src/alibaba-iop-registry';
import {
  selectAlibabaOperationProtocol,
  type AlibabaProtocolAvailability
} from '../src/alibaba-protocol-routing';
import { executeCapabilityCall } from '../src/capability-call';
import { authorizeCapabilityCall, capabilityCallRisk } from '../src/capability-policy';
import { findCapability, getCapabilityDefinition } from '../src/capability-registry';
import { validateCapabilityRequest, validateCapabilityResponse } from '../src/capability-validation-worker';
import { NetworkManager, type NetworkTransport } from '../src/network';
import {
  FULFILLMENT_READ_METHODS as methods,
  ORDER_ATTACHMENT_METHOD,
  type FulfillmentReadMethod
} from '../src/order-fulfillment-methods';
import { parseFulfillmentReadResponse } from '../src/order-fulfillment-read';
import type { CapabilityCallResult, GatewayCredentials } from '../src/types';
import {
  FULFILLMENT_SMOKE_PATHS,
  FulfillmentSmokeGuard,
  runOrderFulfillmentSmoke,
  parseFulfillmentSmokeOptions,
  numericSourceId,
  classifyFulfillmentSmokeError,
  fulfillmentFailureShape
} from '../../../scripts/smoke-order-fulfillment-real';

const reads = Object.values(methods);
const nativeMethods = [...reads, ORDER_ATTACHMENT_METHOD] as const;
const topOnly: AlibabaProtocolAvailability = {
  top: true,
  iop: false,
  defaultProtocol: 'top',
  bindingConfirmed: false
};
const modes = [
  { name: 'IOP only', available: { ...topOnly, top: false, iop: true, defaultProtocol: 'iop' } },
  { name: 'both, TOP default', available: { ...topOnly, iop: true } },
  { name: 'both, IOP default', available: { ...topOnly, iop: true, defaultProtocol: 'iop' } }
] satisfies { name: string; available: AlibabaProtocolAvailability }[];
const iopOnly = modes[0];
const pairedTop = modes[1];
assert(iopOnly && pairedTop);
// Test-only credentials. The injected transport never opens a real socket.
const legacyTop: GatewayCredentials = {
  appKey: 'fixture-top-key',
  appSecret: 'fixture-top-secret',
  accessToken: 'fixture-top-token',
  endpoint: 'https://eco.taobao.com/router/rest',
  signMethod: 'hmac'
};
const iop: GatewayCredentials = {
  protocol: 'iop',
  appKey: 'fixture-iop-key',
  appSecret: 'fixture-iop-secret',
  accessToken: 'fixture-iop-token',
  endpoint: IOP_BUSINESS_ENDPOINT,
  signMethod: 'hmac-sha256'
};
const validation = { validateCapabilityRequest, validateCapabilityResponse };
function harness(response: unknown, status = 200) {
  const send = vi.fn<NetworkTransport['send']>(() => Promise.resolve(Response.json(response, { status })));
  const wait = vi.fn((_milliseconds: number) => Promise.resolve());
  const shouldRetry = vi.fn(() => true);
  const network = new NetworkManager({
    transport: { send },
    policies: {
      alibaba: { allowedOrigins: [new URL(legacyTop.endpoint).origin, new URL(iop.endpoint).origin] }
    }
  });
  const clients = {
    top: new AlibabaClient(legacyTop, network, { maxAttempts: 3, shouldRetry, wait }),
    iop: new AlibabaClient(iop, network, { maxAttempts: 3, shouldRetry, wait })
  };
  const dispatch = async (
    available: AlibabaProtocolAvailability,
    method: string,
    parameters: Record<string, unknown>
  ): Promise<CapabilityCallResult> => {
    const payload = { method, parameters };
    const protocol = selectAlibabaOperationProtocol('callCapability', payload, available);
    return (await executeCapabilityCall(
      clients[protocol],
      payload,
      validation,
      'fixture-trace'
    )) as CapabilityCallResult;
  };
  return { send, wait, shouldRetry, clients, dispatch };
}
function sentRequest(send: ReturnType<typeof harness>['send']) {
  const call = send.mock.calls[0];
  assert(call);
  const [url, init] = call;
  assert(url instanceof URL);
  assert(init.body instanceof URLSearchParams);
  return { url: url.href, body: init.body };
}
const cases = modes.flatMap(({ name, available }) =>
  reads.map((method) => [name, available, method] as const)
);

describe('fulfillment real registry and protocol execution chain', () => {
  it.each(nativeMethods)('keeps real metadata separate from unverified account evidence: %s', (method) => {
    const upload = method === ORDER_ATTACHMENT_METHOD;
    expect(getIopMethod(method)).toMatchObject({
      path: method,
      risk: upload ? 'mutation' : 'read',
      adapted: true,
      accountVerified: upload
    });
    for (const definition of [findCapability(method), getCapabilityDefinition(method)])
      expect(definition).toMatchObject({
        risk: upload ? 'mutation' : 'read',
        realCallEnabled: !upload,
        verification: 'documented'
      });
    expect(capabilityCallRisk(method)).toBe(upload ? 'mutation' : 'read');
    expect(authorizeCapabilityCall({ method, parameters: fixtures.methods[method].request })).toMatchObject({
      allowed: !upload,
      reasonCode: upload ? 'REAL_MUTATION_DISABLED' : 'CAPABILITY_ALLOWED'
    });
  });
  it.each(nativeMethods)('requires IOP before dispatch for a TOP-only native method: %s', (method) => {
    const payload = { method, parameters: fixtures.methods[method].request };
    expect(() => selectAlibabaOperationProtocol('callCapability', payload, topOnly)).toThrow(
      expect.objectContaining({
        gatewayError: expect.objectContaining({ code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED' }) as unknown
      })
    );
  });
  it.each(reads)('does not touch network when only TOP exists: %s', async (method) => {
    const { dispatch, send } = harness(fixtures.methods[method].response);
    await expect(dispatch(topOnly, method, fixtures.methods[method].request)).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED' }
    });
    expect(send).not.toHaveBeenCalled();
  });
  it.each(cases)('%s executes only one native IOP method: %s %s', async (_name, available, method) => {
    const example = fixtures.methods[method];
    const { dispatch, send, wait } = harness(example.response);
    expect(await validateCapabilityRequest(method, example.request)).toEqual([]);
    expect(await validateCapabilityResponse(method, example.response)).toEqual([]);
    const result = await dispatch(available, method, example.request);
    expect(result).toMatchObject({
      method,
      traceId: example.response.request_id,
      contractValid: true,
      data: example.response
    });
    expect(parseFulfillmentReadResponse(method, result.data, result.traceId).data).toEqual(example.response);
    expect(send).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    const sent = sentRequest(send);
    expect(sent.url).toBe(IOP_BUSINESS_ENDPOINT + method);
    const parameters = Object.fromEntries(sent.body);
    expect(parameters.sign).toBe(await signIopRequest(method, parameters, iop.appSecret));
    expect(parameters).toMatchObject({
      app_key: iop.appKey,
      access_token: iop.accessToken,
      sign_method: 'sha256'
    });
    for (const key of ['method', 'session', 'v', 'format']) expect(sent.body.has(key)).toBe(false);
    for (const [key, value] of Object.entries(example.request))
      expect(sent.body.get(key)).toBe(typeof value === 'object' ? JSON.stringify(value) : String(value));
    expect(Object.keys(parameters).sort()).toEqual(
      [
        ...Object.keys(example.request),
        'app_key',
        'access_token',
        'timestamp',
        'sign_method',
        'simplify',
        'sign'
      ].sort()
    );
  });
  it.each(reads)('signs the exact path and retains the native response tree: %s', async (method) => {
    const example = fixtures.methods[method];
    const signed = await createIopBusinessRequest(iop, method, example.request, 1800000000000);
    expect(signed.url).toBe(IOP_BUSINESS_ENDPOINT + method);
    expect(signed.parameters.timestamp).toBe('1800000000000');
    expect(signed.parameters.sign).toBe(await signIopRequest(method, signed.parameters, iop.appSecret));
    expect(normalizeIopBusinessResponse(example.response, method, iop, signed.parameters)).toBe(
      example.response
    );
  });
  it.each([
    [methods.warehouses, { product_id: '1', page_size: 10 }],
    [methods.ggsWarehouses, { product_id: '1', page_size: 10 }],
    [methods.basicFreight, { product_id: '1', destination_country: 'US', quantity: 1.5 }],
    [
      methods.advancedFreight,
      {
        e_company_id: 'fixture-company',
        destination_country: 'US',
        logistics_product_list: [{ product_id: '1', quantity: 1, sku_id: 9007199254740992 }]
      }
    ],
    [methods.tracking, { trade_id: 'opaque-order-id' }]
  ] satisfies [FulfillmentReadMethod, Record<string, unknown>][])(
    'rejects invalid %s parameters at both contract and native builder before network',
    async (method, parameters) => {
      const { dispatch, send } = harness(fixtures.methods[method].response);
      expect((await validateCapabilityRequest(method, parameters)).length).toBeGreaterThan(0);
      await expect(createIopBusinessRequest(iop, method, parameters)).rejects.toMatchObject({
        gatewayError: { code: 'REQUEST_CONTRACT_INVALID' }
      });
      await expect(dispatch(iopOnly.available, method, parameters)).rejects.toMatchObject({
        gatewayError: { code: 'REQUEST_CONTRACT_INVALID' }
      });
      expect(send).not.toHaveBeenCalled();
    }
  );
  it.each(reads)('blocks injected transport parameters before dispatch: %s', async (method) => {
    const parameters = { ...fixtures.methods[method].request, session: 'forbidden' };
    const { dispatch, send } = harness(fixtures.methods[method].response);
    expect(authorizeCapabilityCall({ method, parameters })).toMatchObject({
      allowed: false,
      reasonCode: 'CAPABILITY_TRANSPORT_PARAMETER_FORBIDDEN'
    });
    await expect(dispatch(iopOnly.available, method, parameters)).rejects.toMatchObject({
      gatewayError: { code: 'CAPABILITY_TRANSPORT_PARAMETER_FORBIDDEN' }
    });
    expect(send).not.toHaveBeenCalled();
  });
  it.each(cases)('%s keeps %s outer errors on IOP without retry: %s', async (_name, available, method) => {
    const { dispatch, send, wait, shouldRetry } = harness(failures.outer);
    await expect(dispatch(available, method, fixtures.methods[method].request)).rejects.toMatchObject({
      gatewayError: {
        code: 'ALIBABA_IOP_API_REJECTED',
        subCode: failures.outer.code,
        traceId: failures.outer.request_id
      }
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(sentRequest(send).url).toBe(IOP_BUSINESS_ENDPOINT + method);
    expect(wait).not.toHaveBeenCalled();
    expect(shouldRetry).not.toHaveBeenCalled();
  });
  it.each(modes)(
    '$name never reduces nested GGS failure to a successful empty list',
    async ({ available }) => {
      const { dispatch, send } = harness(failures.ggs);
      const result = await dispatch(
        available,
        methods.ggsWarehouses,
        fixtures.methods[methods.ggsWarehouses].request
      );
      expect(result.data).toEqual(failures.ggs);
      expect(() => parseFulfillmentReadResponse(methods.ggsWarehouses, result.data, result.traceId)).toThrow(
        expect.objectContaining({
          gatewayError: expect.objectContaining({ code: '403', traceId: 'ggs-denied' }) as unknown
        })
      );
      expect(send).toHaveBeenCalledTimes(1);
      expect(sentRequest(send).url).toBe(IOP_BUSINESS_ENDPOINT + methods.ggsWarehouses);
    }
  );
  it.each(reads)(
    'reports malformed successful %s payloads as contract drift without fallback',
    async (method) => {
      const { dispatch, send } = harness({ code: '0', request_id: 'drift' });
      const result = await dispatch(pairedTop.available, method, fixtures.methods[method].request);
      expect(result.contractValid).toBe(false);
      expect(result.contractIssues.length).toBeGreaterThan(0);
      expect(() => parseFulfillmentReadResponse(method, result.data, result.traceId)).toThrow();
      expect(send).toHaveBeenCalledTimes(1);
      expect(sentRequest(send).url).toBe(IOP_BUSINESS_ENDPOINT + method);
    }
  );
  it.each(['http', 'network'] as const)(
    'never retries IOP %s failures even when caller permits TOP retries',
    async (kind) => {
      const { dispatch, send, wait } = harness({}, 503);
      if (kind === 'network')
        send.mockRejectedValueOnce(
          new TypeError('Synthetic fetch failed', {
            cause: { code: 'ETIMEDOUT' }
          })
        );
      await expect(
        dispatch(pairedTop.available, methods.tracking, fixtures.methods[methods.tracking].request)
      ).rejects.toMatchObject({
        gatewayError: { code: kind === 'http' ? 'UPSTREAM_UNAVAILABLE' : 'NETWORK_ERROR' }
      });
      expect(send).toHaveBeenCalledTimes(1);
      expect(sentRequest(send).url).toBe(IOP_BUSINESS_ENDPOINT + methods.tracking);
      expect(wait).not.toHaveBeenCalled();
    }
  );
  it.each([{ name: 'TOP only', available: topOnly }, ...modes])(
    '$name always disables attachment mutation in the generic executor',
    async ({ available }) => {
      const { clients, send } = harness(fixtures.methods[ORDER_ATTACHMENT_METHOD].response);
      for (const protocol of ['top', 'iop'] as const) {
        if (!available[protocol]) continue;
        for (const parameters of [fixtures.methods[ORDER_ATTACHMENT_METHOD].request, {}]) {
          await expect(
            executeCapabilityCall(
              clients[protocol],
              {
                method: ORDER_ATTACHMENT_METHOD,
                parameters
              },
              validation
            )
          ).rejects.toMatchObject({ gatewayError: { code: 'REAL_MUTATION_DISABLED' } });
        }
      }
      expect(send).not.toHaveBeenCalled();
    }
  );
  it.each([{ name: 'TOP only', available: topOnly }, ...modes.filter(({ available }) => available.top)])(
    '$name preserves legacy unmarked TOP ciphertext requests',
    async ({ available }) => {
      const method = 'alibaba.icbu.product.score.get';
      const parameters = { product_id: 'opaque-score-fixture' };
      const response = { ...scoreFixture.score, request_id: 'legacy-top-trace' };
      const { clients, dispatch, send } = harness({ alibaba_icbu_product_score_get_response: response });
      expect(legacyTop).not.toHaveProperty('protocol');
      expect(clients.top.protocol).toBe('top');
      expect(selectAlibabaOperationProtocol('callCapability', { method, parameters }, available)).toBe('top');
      expect(authorizeCapabilityCall({ method, parameters }).allowed).toBe(true);
      const result = await dispatch(available, method, parameters);
      expect(result).toMatchObject({ method, traceId: 'legacy-top-trace', data: response });
      expect(send).toHaveBeenCalledTimes(1);
      const sent = sentRequest(send);
      expect(sent.url).toBe(legacyTop.endpoint);
      expect(sent.body.get('method')).toBe(method);
      expect(sent.body.get('session')).toBe(legacyTop.accessToken);
      expect(sent.body.get('product_id')).toBe(parameters.product_id);
      expect(sent.body.has('access_token')).toBe(false);
    }
  );
});

function smokeHarness(overrides: Record<string, unknown> = {}) {
  const product = {
    code: '0',
    request_id: 'private-provider-trace',
    result: {
      products: [
        {
          id: '9007199254740993123',
          subject: 'PRIVATE_SUBJECT',
          category_id: 123,
          display: 'online',
          gmt_modified: '2026-01-01 12:00:00'
        }
      ],
      total_item: 1,
      current_page: 1,
      page_size: 1
    }
  };
  const map: Record<string, unknown> = {
    '/alibaba/icbu/product/list': product,
    '/alibaba/order/list#seller': {
      code: '0',
      value: {
        order_list: [
          { trade_id: '9007199254740993124', trade_status: 'PAID', other_login_id: 'PRIVATE_LOGIN' }
        ],
        total_count: 1
      }
    },
    '/alibaba/order/list#buyer': {
      code: '0',
      value: {
        order_list: [
          { trade_id: '9007199254740993125', trade_status: 'PAID', other_login_id: 'PRIVATE_LOGIN' }
        ],
        total_count: 1
      }
    },
    ...Object.fromEntries(reads.map((method) => [method, fixtures.methods[method].response])),
    ...overrides
  };
  const sent: { method: string; parameters: URLSearchParams }[] = [];
  const send = vi.fn<NetworkTransport['send']>(async (input, init) => {
    const request = new Request(input, init);
    const method = new URL(request.url).pathname.slice('/rest'.length);
    const parameters = new URLSearchParams(await request.text());
    sent.push({ method, parameters });
    const key = method === '/alibaba/order/list' ? method + '#' + (parameters.get('role') ?? '') : method;
    assert(Object.hasOwn(map, key), 'Unexpected synthetic provider path');
    return Response.json(map[key]);
  });
  const wait = vi.fn((_milliseconds: number) => Promise.resolve());
  return { guard: new FulfillmentSmokeGuard({ send }, wait), send, sent, wait };
}
function smokeWireRequest(requestId: string, url = IOP_BUSINESS_ENDPOINT + methods.warehouses) {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      'X-Request-ID': requestId
    },
    body: new URLSearchParams({
      product_id: '1',
      app_key: 'fixture',
      access_token: 'fixture',
      timestamp: '1',
      sign_method: 'sha256',
      simplify: 'true',
      sign: 'fixture'
    })
  });
}
describe('fulfillment smoke is read-only and import-safe', () => {
  it.each([
    [methods.warehouses, { code: '0', response: {}, request_id: 'missing-warehouse-trace' }],
    [methods.tracking, { code: '0', request_id: 'missing-tracking-trace' }]
  ] satisfies [FulfillmentReadMethod, Record<string, unknown>][])(
    'never fabricates an empty result for the observed missing-data %s response',
    async (method, data) => {
      expect((await validateCapabilityResponse(method, data)).length).toBeGreaterThan(0);
      expect(() => parseFulfillmentReadResponse(method, data)).toThrow('FULFILLMENT_READ_RESPONSE_INVALID');
      const { guard, sent } = smokeHarness({ [method]: data });
      const receipt = await runOrderFulfillmentSmoke(iop, guard);
      const observations = receipt.observations.filter((row) => row.method === method);
      expect(observations.length).toBe(method === methods.tracking ? 2 : 1);
      for (const row of observations) {
        expect(row).toMatchObject({ status: 'contract-drift', count: null });
        expect(row.errorCode).toContain('FULFILLMENT_READ_RESPONSE_INVALID');
        expect(row.shape['$.code']).toBe('string:0');
        expect(row.shape['$.tracking_list']).toBeUndefined();
        if (method === methods.warehouses) {
          expect(row.shape['$.response']).toBe('object');
          expect(row.shape['$.response.records']).toBeUndefined();
        }
      }
      expect(sent.filter((row) => row.method === method)).toHaveLength(observations.length);
      expect(receipt.counts.requests).toBe(8);
    }
  );
  it.each([4015, '4015', 408, '408', 403, '403'])(
    'keeps coded ISP %s failures classified by the preserved code, not by guessed permissions',
    async (code) => {
      const { guard, sent, wait } = smokeHarness({
        [methods.basicFreight]: {
          code,
          type: 'ISP',
          message: 'PRIVATE_PLATFORM_MESSAGE',
          request_id: 'private-provider-request'
        }
      });
      const receipt = await runOrderFulfillmentSmoke(iop, guard);
      const observation = receipt.observations.find((row) => row.method === methods.basicFreight);
      assert(observation);
      expect(observation.status).toBe(String(code) === '403' ? 'permission-denied' : 'platform-error');
      expect(observation.count).toBeNull();
      expect(observation.errorCode).toContain('ALIBABA_IOP_API_REJECTED');
      expect(observation.errorCode).toContain(String(code));
      expect(observation.shape).toMatchObject({
        '$.code': typeof code + ':' + String(code),
        '$.type': 'string:ISP',
        '$.message': 'string'
      });
      expect(sent.filter((row) => row.method === methods.basicFreight)).toHaveLength(1);
      expect(receipt.counts.requests).toBe(8);
      expect(wait).toHaveBeenCalledTimes(8);
      expect(JSON.stringify(receipt)).not.toContain('PRIVATE_PLATFORM_MESSAGE');
      expect(JSON.stringify(receipt)).not.toContain('private-provider-request');
    }
  );
  it('records only bounded failure types, lengths, success flags and stable code/type atoms', () => {
    const shape = fulfillmentFailureShape({
      code: '0',
      sub_code: 'isv.permission-api-package-limit',
      msg_code: 403,
      type: 'ISV',
      message: 'PRIVATE_MESSAGE',
      request_id: 'PRIVATE_REQUEST_ID',
      result: {
        success: false,
        biz_success: true,
        active: true,
        unknownFlag: 'false',
        rows: [{ warehouse_id: '9007199254740993123', name: 'PRIVATE_WAREHOUSE', address: 'PRIVATE_ADDRESS' }]
      }
    });
    expect(shape).toMatchObject({
      $: 'object',
      '$.code': 'string:0',
      '$.sub_code': 'string:isv.permission-api-package-limit',
      '$.msg_code': 'number:403',
      '$.type': 'string:ISV',
      '$.message': 'string',
      '$.request_id': 'string',
      '$.result.success': 'boolean:false',
      '$.result.biz_success': 'boolean:true',
      '$.result.active': 'boolean',
      '$.result.unknownFlag': 'string',
      '$.result.rows': 'array:1',
      '$.result.rows[0].warehouse_id': 'string'
    });
    for (const value of [
      'PRIVATE_MESSAGE',
      'PRIVATE_REQUEST_ID',
      'PRIVATE_WAREHOUSE',
      'PRIVATE_ADDRESS',
      '9007199254740993123'
    ])
      expect(JSON.stringify(shape)).not.toContain(value);
    expect(
      fulfillmentFailureShape(
        { type: 'PRIVATE_NAME', code: '9007199254740993123', msg_code: iop.accessToken },
        [iop.accessToken]
      )
    ).toMatchObject({
      '$.type': 'string',
      '$.code': 'string',
      '$.msg_code': 'string'
    });
  });
  it('caps depth at four and paths at one hundred, excluding identifier-like business IDs', () => {
    const source: Record<string, unknown> = {
      rows: Array.from({ length: 200 }, () => ({ label: 'PRIVATE_LABEL' })),
      type: 'ISP',
      code: 'isv.InvalidApi',
      a: { b: { c: { d: { e: 'PRIVATE_DEEP' } } } },
      '9007199254740993123': 'PRIVATE_MAP',
      'warehouse/PRIVATE_KEY': 'PRIVATE_MAP',
      WH_9007199254740993123: 'PRIVATE_MAP'
    };
    const limited = fulfillmentFailureShape(source);
    expect(Object.keys(limited)).toHaveLength(100);
    expect(limited['$.type']).toBe('string:ISP');
    expect(limited['$.code']).toBe('string:isv.InvalidApi');
    const deep = fulfillmentFailureShape({ a: { b: { c: { d: { e: 'PRIVATE_DEEP' } } } } });
    expect(deep['$.a.b.c.d']).toBe('object');
    expect(Object.hasOwn(deep, '$.a.b.c.d.e')).toBe(false);
    const invalidKeys = fulfillmentFailureShape({
      '9007199254740993123': 'PRIVATE_MAP',
      'warehouse/PRIVATE_KEY': 'PRIVATE_MAP',
      WH_9007199254740993123: 'PRIVATE_MAP',
      valid_key: 'PRIVATE_MAP'
    });
    expect(invalidKeys).toEqual({ $: 'object', '$.valid_key': 'string' });
    expect(JSON.stringify(limited)).not.toContain('PRIVATE_');
  });
  it('adds redacted failure shape and classifies root paid/permission errors without raw values', async () => {
    const { guard } = smokeHarness({
      [methods.warehouses]: {
        code: '0',
        response: {
          total: 1,
          current_page: 1,
          page_size: 20,
          records: [{ name: 'PRIVATE_WAREHOUSE', address: 'PRIVATE_ADDRESS', warehouse_id: 'PRIVATE_ID' }]
        }
      },
      [methods.ggsWarehouses]: {
        type: 'ISV',
        code: 'isv.ChargeableApi',
        message: 'PRIVATE_BILLING_MESSAGE',
        sub_code: 'PaymentRequired'
      }
    });
    const receipt = await runOrderFulfillmentSmoke(iop, guard);
    expect(receipt.observations.find((row) => row.method === methods.warehouses)).toMatchObject({
      status: 'contract-drift',
      shape: {
        '$.response.records': 'array:1',
        '$.response.records[0].warehouse_id': 'string'
      }
    });
    expect(receipt.observations.find((row) => row.method === methods.ggsWarehouses)).toMatchObject({
      status: 'permission-denied',
      shape: {
        '$.type': 'string:ISV',
        '$.code': 'string:isv.ChargeableApi',
        '$.sub_code': 'string:PaymentRequired',
        '$.message': 'string'
      }
    });
    const report = JSON.stringify(receipt);
    for (const value of [
      'PRIVATE_WAREHOUSE',
      'PRIVATE_ADDRESS',
      'PRIVATE_ID',
      'PRIVATE_BILLING_MESSAGE',
      iop.appKey,
      iop.appSecret,
      iop.accessToken
    ])
      expect(report).not.toContain(value);
    expect(guard.source).toBeUndefined();
  });
  it('requires explicit confirmation and exact credential/receipt options', () => {
    expect(
      parseFulfillmentSmokeOptions([
        '--confirm-readonly',
        '--credential=.codex/fixture.json',
        '--receipt=artifacts/new.json'
      ])
    ).toEqual({ credential: '.codex/fixture.json', receipt: 'artifacts/new.json' });
    for (const args of [
      ['--credential=x', '--receipt=y'],
      ['--confirm-readonly', '--credential=x', '--receipt=y', '--refresh'],
      ['--confirm-readonly', '--credential=x', '--credential=y'],
      ['--confirm-readonly', '--credential=x', '--receipt=x']
    ])
      expect(() => parseFulfillmentSmokeOptions(args)).toThrow();
  });
  it('preserves raw decimal IDs without decoding, coercing or accepting rounded numbers', () => {
    for (const id of ['9007199254740993123', 123]) expect(numericSourceId(id)).toBe(id);
    for (const id of ['opaque-order', '0001', ' 1', '1e5', 9007199254740992, 1.5, null])
      expect(numericSourceId(id)).toBeNull();
  });
  it('runs the actual guarded gateway and ReadClient with only synthetic credentials', async () => {
    const { guard, sent, wait } = smokeHarness();
    const snapshots: string[] = [];
    const receipt = await runOrderFulfillmentSmoke(iop, guard, (value) => {
      snapshots.push(JSON.stringify(value));
      return Promise.resolve();
    });
    expect(receipt.counts.requests).toBe(8);
    expect(receipt.counts.passed).toBe(8);
    expect(receipt.counts['missing-prerequisite']).toBe(1);
    expect(receipt.observations.find((row) => row.method === methods.advancedFreight)).toMatchObject({
      status: 'missing-prerequisite',
      requestId: null,
      errorCode: 'VALID_COMPANY_ID_AND_SKU_CONTEXT_REQUIRED'
    });
    expect(wait.mock.calls).toEqual(Array.from({ length: 8 }, () => [350]));
    expect(sent.every(({ method }) => (FULFILLMENT_SMOKE_PATHS as readonly string[]).includes(method))).toBe(
      true
    );
    expect(
      sent
        .filter(({ method }) => method === methods.tracking)
        .map(({ parameters }) => parameters.get('trade_id'))
    ).toEqual(['9007199254740993124', '9007199254740993125']);
    expect(sent.find(({ method }) => method === methods.basicFreight)?.parameters.get('product_id')).toBe(
      '9007199254740993123'
    );
    const report = snapshots.join('\n');
    for (const secret of [
      iop.appKey,
      iop.appSecret,
      iop.accessToken,
      'PRIVATE_SUBJECT',
      'PRIVATE_LOGIN',
      '9007199254740993123',
      '9007199254740993124',
      '9007199254740993125',
      'private-provider-trace',
      'app_key',
      'access_token',
      'parameters'
    ])
      expect(report).not.toContain(secret);
    expect(guard.source).toBeUndefined();
  });
  it('does not turn opaque order IDs into numeric tracking parameters', async () => {
    const { guard, sent } = smokeHarness({
      '/alibaba/order/list#buyer': {
        code: '0',
        value: {
          order_list: [{ trade_id: 'opaque-order-123', trade_status: 'PAID' }],
          total_count: 1
        }
      }
    });
    const receipt = await runOrderFulfillmentSmoke(iop, guard);
    expect(receipt.counts.requests).toBe(7);
    expect(
      receipt.observations.filter((row) => row.method === methods.tracking).map((row) => row.status)
    ).toEqual(['passed', 'missing-prerequisite']);
    expect(sent.filter(({ method }) => method === methods.tracking)).toHaveLength(1);
    expect(JSON.stringify(receipt)).not.toContain('opaque-order-123');
  });
  it('distinguishes permission denial and blocks dependent product calls', async () => {
    const { guard, sent } = smokeHarness({ '/alibaba/icbu/product/list': failures.outer });
    const receipt = await runOrderFulfillmentSmoke(iop, guard);
    expect(receipt.observations[0]).toMatchObject({ status: 'permission-denied', count: null });
    for (const method of [methods.warehouses, methods.ggsWarehouses, methods.basicFreight])
      expect(sent.some((row) => row.method === method)).toBe(false);
    expect(receipt.counts['missing-prerequisite']).toBe(4);
  });
  it('distinguishes a real empty source from missing discovery payloads', async () => {
    const overrides = {
      '/alibaba/icbu/product/list': { code: '0', result: { products: [], total_item: 0 } },
      '/alibaba/order/list#seller': { code: '0', value: { order_list: [], total_count: 0 } },
      '/alibaba/order/list#buyer': { code: '0', value: { order_list: [], total_count: 0 } }
    };
    const empty = await runOrderFulfillmentSmoke(iop, smokeHarness(overrides).guard);
    expect(empty.counts).toMatchObject({ requests: 3, 'valid-empty': 3, 'missing-prerequisite': 6 });
    const drift = await runOrderFulfillmentSmoke(
      iop,
      smokeHarness({
        ...overrides,
        '/alibaba/icbu/product/list': { code: '0', result: {} }
      }).guard
    );
    expect(drift.observations[0]).toMatchObject({ status: 'contract-drift', count: null });
  });
  it('classifies nested permission failures and malformed payloads without calling them empty', async () => {
    const { guard } = smokeHarness({
      [methods.ggsWarehouses]: failures.ggs,
      [methods.basicFreight]: { code: '0', value: null }
    });
    const receipt = await runOrderFulfillmentSmoke(iop, guard);
    expect(receipt.observations.find((row) => row.method === methods.ggsWarehouses)).toMatchObject({
      status: 'permission-denied',
      count: null
    });
    expect(receipt.observations.find((row) => row.method === methods.basicFreight)).toMatchObject({
      status: 'contract-drift',
      count: null
    });
    expect(
      classifyFulfillmentSmokeError(new Error(iop.accessToken), [iop.accessToken]).errorCode
    ).not.toContain(iop.accessToken);
  });
  it.each([
    'https://eco.taobao.com/router/rest',
    IOP_BUSINESS_ENDPOINT + '/auth/token/refresh',
    IOP_BUSINESS_ENDPOINT + ORDER_ATTACHMENT_METHOD,
    IOP_BUSINESS_ENDPOINT + '/alibaba/order/get',
    IOP_BUSINESS_ENDPOINT + methods.warehouses + '?extra=1'
  ])('hard-denies out-of-plan URL %s without touching transport', async (url) => {
    const send = vi.fn<NetworkTransport['send']>();
    const guard = new FulfillmentSmokeGuard({ send }, () => Promise.resolve());
    const requestId = randomUUID();
    guard.arm(methods.warehouses, { product_id: '1' }, requestId);
    await expect(guard.send(smokeWireRequest(requestId, url), {})).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it('permits only one on-wire attempt per arm, including simultaneous calls', async () => {
    const send = vi.fn<NetworkTransport['send']>(() =>
      Promise.resolve(Response.json({ code: '0', value: [] }))
    );
    const guard = new FulfillmentSmokeGuard({ send }, () => Promise.resolve());
    const requestId = randomUUID();
    guard.arm(methods.warehouses, { product_id: '1' }, requestId);
    const results = await Promise.allSettled([
      guard.send(smokeWireRequest(requestId), {}),
      guard.send(smokeWireRequest(requestId), {})
    ]);
    expect(results.map((row) => row.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('hard-stops at ten requests without a retry or an eleventh transport send', async () => {
    const send = vi.fn<NetworkTransport['send']>(() =>
      Promise.resolve(Response.json({ code: '0', value: [] }))
    );
    const wait = vi.fn((_milliseconds: number) => Promise.resolve());
    const guard = new FulfillmentSmokeGuard({ send }, wait);
    for (let index = 0; index < 10; index++) {
      const requestId = randomUUID();
      guard.arm(methods.warehouses, { product_id: '1' }, requestId);
      await guard.send(smokeWireRequest(requestId), {});
      guard.disarm();
    }
    const requestId = randomUUID();
    guard.arm(methods.warehouses, { product_id: '1' }, requestId);
    await expect(guard.send(smokeWireRequest(requestId), {})).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(10);
    expect(wait).toHaveBeenCalledTimes(10);
  });
  it('never starts the runner with TOP or legacy unmarked credentials', async () => {
    const { guard, send } = smokeHarness();
    await expect(runOrderFulfillmentSmoke(legacyTop, guard)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
