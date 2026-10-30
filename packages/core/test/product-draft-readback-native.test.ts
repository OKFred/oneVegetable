import Ajv from 'ajv/dist/2020';
import { describe, expect, it, vi } from 'vitest';
import { GatewayException } from '../src/errors';
import { AlibabaClient } from '../src/alibaba-client';
import { NetworkManager } from '../src/network';
import { classifyProductMaintenanceError, PRODUCT_MAINTENANCE_METHODS } from '../src/product-maintenance-api';
import fixture from '../../../mock/data/product-draft-readback.json';
import credentialsFixture from '../../../mock/data/node-gateway-credentials.json';
import iopDocs from '../../../docs/alibaba-iop-api-docs.json';
import workbenchDocs from '../../../docs/alibaba-product-workbench-docs.json';
import referenceExamples from '../../../mock/data/product-reference/examples.json';
import workbenchExamples from '../../../mock/data/product-workbench/examples.json';
import { IOP_REFERENCE_METHODS } from '../src/product-reference-methods';
import { getIopMethod } from '../src/alibaba-iop-registry';
import { createIopBusinessRequest, normalizeIopBusinessResponse } from '../src/alibaba-iop-business';
import { selectAlibabaOperationProtocol } from '../src/alibaba-protocol-routing';
import { buildIopReferenceContracts, referencePaths } from '../../../scripts/lib/iop-reference-contract';
import type { GatewayCredentials } from '../src/types';

const method = IOP_REFERENCE_METHODS.getProductStatus;
const credentials: GatewayCredentials = {
  protocol: 'iop',
  endpoint: 'https://openapi-api.alibaba.com/rest',
  signMethod: 'hmac-sha256',
  appKey: credentialsFixture.oauthBundle.application.appKey,
  appSecret: credentialsFixture.oauthBundle.application.appSecret,
  accessToken: credentialsFixture.oauthBundle.oauth.accessToken
};
function ispFailure(value: unknown = fixture.responses.isp, nativeMethod: string = method): GatewayException {
  try {
    normalizeIopBusinessResponse(value, nativeMethod, credentials);
  } catch (error: unknown) {
    if (error instanceof GatewayException) return error;
    throw error;
  }
  throw new Error('ISP_MUST_THROW');
}
describe('strict native ISP upstream envelope', () => {
  it('classifies the observed shape as a static non-retryable upstream failure with safe trace', () => {
    expect(ispFailure().gatewayError).toEqual({
      code: 'ALIBABA_IOP_UPSTREAM_ERROR',
      subCode: 'ISP',
      message: 'ALIBABA_IOP_UPSTREAM_ERROR',
      retryable: false,
      traceId: fixture.responses.isp.request_id
    });
  });
  it('does not expose provider message text, URLs or credential values', () => {
    const body = structuredClone(fixture.responses.isp);
    body.message = [credentials.appKey, credentials.appSecret, credentials.accessToken].join(' ');
    body.request_id = credentials.accessToken;
    const error = ispFailure(body);
    expect(error.gatewayError).toMatchObject({
      code: 'ALIBABA_IOP_UPSTREAM_ERROR',
      message: 'ALIBABA_IOP_UPSTREAM_ERROR',
      retryable: false
    });
    expect(error.gatewayError.traceId).toBeUndefined();
    const serialized = JSON.stringify(error.gatewayError);
    for (const secret of [credentials.appKey, credentials.appSecret, credentials.accessToken])
      expect(serialized).not.toContain(secret);
  });
  it('can use the safe native trace when request_id is absent', () => {
    const body = structuredClone(fixture.responses.isp);
    Reflect.deleteProperty(body, 'request_id');
    expect(ispFailure(body).gatewayError.traceId).toBe(fixture.responses.isp._trace_id_);
  });
  it.each([
    ['type', 'isp'],
    ['message', ''],
    ['message', '   '],
    ['message', null],
    ['message', 1],
    ['code', undefined],
    ['code', '0'],
    ['result', null],
    ['success', false],
    ['data', {}]
  ])('does not expand the ISP exception for unconfirmed field %s %#', (field, value) => {
    const body = structuredClone(fixture.responses.isp);
    Reflect.set(body, field, value);
    expect(ispFailure(body).gatewayError.code).toBe('ALIBABA_IOP_RESPONSE_INVALID');
  });
  it.each([{ code: '0' }, { code: '0', result: {} }, { code: '0', result: { data: { status: 'draft' } } }])(
    'keeps ordinary code0 missing result/success fail-closed %#',
    (body) => {
      expect(ispFailure(body).gatewayError.code).toBe('ALIBABA_IOP_RESPONSE_INVALID');
    }
  );
  it.each([
    { ...fixture.responses.isp, ...fixture.responses.draft },
    { ...fixture.responses.isp, success: true, result: fixture.responses.draft.result }
  ])('never promotes a contradictory ISP envelope to business success %#', (body) => {
    expect(ispFailure(body).gatewayError.code).toBe('ALIBABA_IOP_RESPONSE_INVALID');
  });
  it.each(['setPrice', 'setInventory', 'deleteDraft'] as const)(
    'retains unknown mutation outcome for %s, never explicit permission rejection',
    (operation) => {
      const error = ispFailure(fixture.responses.isp, PRODUCT_MAINTENANCE_METHODS[operation]);
      expect(classifyProductMaintenanceError(operation, error)).toMatchObject({
        status: 'ambiguous',
        reason: 'unknown-outcome',
        errorCode: 'ALIBABA_IOP_UPSTREAM_ERROR'
      });
    }
  );
  it('performs no automatic retry even if a caller requests retries', async () => {
    const send = vi.fn(() => Promise.resolve(Response.json(fixture.responses.isp)));
    const shouldRetry = vi.fn(() => true),
      wait = vi.fn(() => Promise.resolve());
    const client = new AlibabaClient(
      credentials,
      new NetworkManager({
        transport: { send },
        policies: { alibaba: { allowedOrigins: ['https://openapi-api.alibaba.com'] } }
      }),
      { maxAttempts: 3, shouldRetry, wait }
    );
    await expect(client.call(method, { product_id: Number(fixture.draftId) })).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_IOP_UPSTREAM_ERROR', retryable: false }
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(shouldRetry).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
  });
});

describe('native IOP status replay', () => {
  it('registers a native read, never a TOP alias or a new write capability', () => {
    expect(getIopMethod(method)).toMatchObject({
      path: method,
      risk: 'read',
      adapted: true,
      accountVerified: false
    });
    expect(getIopMethod('alibaba.icbu.product.status.get.v2')).toBeUndefined();
  });
  it.each(['top', 'iop'] as const)('selects native IOP regardless of preferred %s', (defaultProtocol) => {
    const payload = { method, parameters: { product_id: Number(fixture.draftId) } };
    expect(
      selectAlibabaOperationProtocol('callCapability', payload, {
        top: true,
        iop: true,
        defaultProtocol,
        bindingConfirmed: false
      })
    ).toBe('iop');
    expect(() =>
      selectAlibabaOperationProtocol('callCapability', payload, {
        top: true,
        iop: false,
        defaultProtocol,
        bindingConfirmed: false
      })
    ).toThrow('ALIBABA_IOP_AUTHORIZATION_REQUIRED');
  });
  it('signs exactly the public status path using only the requested ID', async () => {
    const request = await createIopBusinessRequest(credentials, method, {
      product_id: Number(fixture.draftId)
    });
    expect(request.url).toBe(credentials.endpoint + method);
    expect(request.parameters.product_id).toBe(fixture.draftId);
    expect(request.parameters.sign_method).toBe('sha256');
    expect(request.parameters.sign).toMatch(/^[A-F0-9]{64}$/u);
    expect(request.parameters).not.toHaveProperty('method');
    expect(request.parameters).not.toHaveProperty('session');
  });
  it.each([
    {},
    { sku_id: Number(fixture.draftId) },
    { product_id: 0 },
    { product_id: Number.MAX_SAFE_INTEGER + 1 },
    { product_id: Number(fixture.draftId), language: 'en_US' }
  ])('blocks malformed or expanded native request %#', async (parameters) => {
    await expect(createIopBusinessRequest(credentials, method, parameters)).rejects.toThrow();
  });
  it('preserves explicit native successful data without a synthetic TOP wrapper or ID echo', () => {
    const body = structuredClone(fixture.responses.draft);
    const before = structuredClone(body);
    expect(normalizeIopBusinessResponse(body, method, credentials)).toEqual(before);
    expect(body).toEqual(before);
    expect(body.result.data).not.toHaveProperty('product_id');
  });
  it.each([undefined, false, '401', 1])('rejects missing/nonzero native code %#', (code) => {
    const body = structuredClone(fixture.responses.draft);
    Reflect.set(body, 'code', code);
    expect(() => normalizeIopBusinessResponse(body, method, credentials)).toThrow();
  });
  it.each([undefined, false, 'true', 1])('rejects non-explicit boolean success %#', (success) => {
    const body = structuredClone(fixture.responses.draft);
    Reflect.set(body.result, 'success', success);
    expect(() => normalizeIopBusinessResponse(body, method, credentials)).toThrow();
  });
  it.each([null, [], false, { status: 1 }])('rejects malformed status data %#', (data) => {
    const body = structuredClone(fixture.responses.draft);
    Reflect.set(body.result, 'data', data);
    expect(() => normalizeIopBusinessResponse(body, method, credentials)).toThrow();
  });
  it.each(['deleted', 'online', 'pending', 'failed', 'future-status'])(
    'preserves %s as observed data, not an absence assertion',
    (status) => {
      const body = structuredClone(fixture.responses.draft);
      body.result.data.status = status;
      expect(normalizeIopBusinessResponse(body, method, credentials)).toEqual(body);
    }
  );
  it('rejects contradictory business error codes even alongside success=true', () => {
    const body = structuredClone(fixture.responses.draft);
    body.result.msg_code = 'SYS_ERROR';
    expect(() => normalizeIopBusinessResponse(body, method, credentials)).toThrow();
  });
});
describe('source status contract without code generation', () => {
  it('appends reference index6 and compiles the saved public status document', () => {
    const old = [
      IOP_REFERENCE_METHODS.predictCategory,
      IOP_REFERENCE_METHODS.listCategories,
      IOP_REFERENCE_METHODS.getAttributes,
      IOP_REFERENCE_METHODS.getProduct,
      IOP_REFERENCE_METHODS.listShippingTemplates,
      IOP_REFERENCE_METHODS.searchProducts
    ];
    expect(referencePaths.slice(0, 6)).toEqual(old);
    expect(referencePaths[6]).toBe(method);
    const documents = [...iopDocs.documents, ...workbenchDocs.documents];
    expect(documents.find((doc) => doc.path === method)).toBeDefined();
    const contracts = buildIopReferenceContracts(
      { ...iopDocs, documents },
      { ...referenceExamples, ...workbenchExamples }
    );
    for (const [index, path] of [...old, method].entries())
      expect(contracts.definitions[path]).toMatchObject({
        requestSchema: 'AlibabaProductIopReference' + String(index) + 'Request',
        responseSchema: 'AlibabaProductIopReference' + String(index) + 'Response',
        risk: 'read'
      });
    const request = contracts.schemas.AlibabaProductIopReference6Request;
    const response = contracts.schemas.AlibabaProductIopReference6Response;
    if (!request || !response) throw new Error('STATUS_SOURCE_SCHEMA_REQUIRED');
    const ajv = new Ajv({ strict: false, allowUnionTypes: true, allErrors: true, coerceTypes: false });
    const validateRequest = ajv.compile(request),
      validateResponse = ajv.compile(response);
    expect(validateRequest({ product_id: Number(fixture.draftId) })).toBe(true);
    expect(validateRequest({})).toBe(false);
    expect(
      validateRequest({ product_id: Number(fixture.draftId), sku_id: Number(fixture.otherDraftId) })
    ).toBe(false);
    expect(validateResponse(fixture.responses.draft), JSON.stringify(validateResponse.errors)).toBe(true);
    expect(validateResponse(fixture.responses.isp)).toBe(false);
    const body = structuredClone(fixture.responses.draft);
    Reflect.deleteProperty(body, 'code');
    expect(validateResponse(body)).toBe(false);
    Reflect.set(body, 'code', '0');
    Reflect.deleteProperty(body.result, 'success');
    expect(validateResponse(body)).toBe(false);
  });
});
