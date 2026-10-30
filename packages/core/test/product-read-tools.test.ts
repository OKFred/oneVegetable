import { describe, expect, it, vi } from 'vitest';
import fixtures from '../../../mock/data/product-read-tools.json';
import { GatewayException } from '../src/errors';
import { validateCapabilityRequest } from '../src/capability-registry';
import {
  PRODUCT_READ_METHODS,
  ProductReadToolsClient,
  createTranslationReadRequest,
  createShippingCoverageRequest,
  productReadCapabilityAllowed,
  type ShippingCoverageInput,
  type TranslateTextInput
} from '../src/product-read-tools';
import type { GatewayClient } from '../src/types';

const translationInput = fixtures.translationInput as TranslateTextInput;
const shippingInput = fixtures.shippingInput as ShippingCoverageInput;
function setup(data: unknown = fixtures.translation) {
  const context = vi.fn(() => Promise.resolve(structuredClone(fixtures.context)));
  const request = vi.fn((operation: string, payload: Record<string, unknown>) =>
    Promise.resolve(
      operation === 'listShippingTemplates'
        ? structuredClone(fixtures.templates)
        : {
            method: payload.method,
            data: structuredClone(data),
            traceId: 'envelope-trace',
            contractValid: true,
            contractIssues: []
          }
    )
  );
  const gateway = {
    request: request as unknown as GatewayClient['request'],
    galleryTransferContext: context
  };
  return { client: new ProductReadToolsClient(gateway), request, context, gateway };
}
describe('product read tools', () => {
  it('does no work at construction and exposes only allowed capabilities', () => {
    const { request, context } = setup();
    expect(request).not.toHaveBeenCalled();
    expect(context).not.toHaveBeenCalled();
    expect(productReadCapabilityAllowed(PRODUCT_READ_METHODS.translation)).toBe(true);
    expect(productReadCapabilityAllowed(PRODUCT_READ_METHODS.recognize)).toBe(false);
    expect(productReadCapabilityAllowed(PRODUCT_READ_METHODS.recognizeTranslation)).toBe(false);
  });
  it('builds a text-only translation task with the supplied appName and language pair', async () => {
    const result = createTranslationReadRequest(translationInput);
    expect(result.icbu_translate_task_dto).toHaveLength(1);
    expect(result.icbu_translate_task_dto[0]).toMatchObject({
      app_name: translationInput.appName,
      format: 'text',
      trans_engine: 'ALI_TRANS',
      source_text: translationInput.text,
      source_language: translationInput.sourceLanguage,
      target_language: translationInput.targetLanguage,
      field_type: translationInput.fieldType
    });
    expect(await validateCapabilityRequest(PRODUCT_READ_METHODS.translation, result)).toEqual([]);
  });
  it.each([
    { appName: '' },
    { appName: '   ' },
    { text: '' },
    { sourceLanguage: '' },
    { targetLanguage: '<html>' },
    { fieldType: 'query' }
  ])('rejects invalid translation inputs before dispatch: %j', async (change) => {
    const { client, request, context } = setup();
    await expect(
      client.translateText({ ...translationInput, ...change } as TranslateTextInput)
    ).rejects.toMatchObject({ gatewayError: { code: 'REQUEST_CONTRACT_INVALID' } });
    expect(request).not.toHaveBeenCalled();
    expect(context).not.toHaveBeenCalled();
  });
  it('builds the exact shipping DTO without unit conversion or guessed batch quantity', async () => {
    const request = createShippingCoverageRequest(shippingInput);
    expect(request).toEqual(fixtures.shippingRequest);
    expect(await validateCapabilityRequest(PRODUCT_READ_METHODS.coverage, request)).toEqual([]);
    expect(
      createShippingCoverageRequest({ ...shippingInput, saleType: 'batch', batchNum: 10 })
        .country_logistics_cost_status_request.batch_num
    ).toBe(10);
    expect(
      createShippingCoverageRequest({ ...shippingInput, batchNum: 10 }).country_logistics_cost_status_request
    ).not.toHaveProperty('batch_num');
  });
  it.each([
    { shippingTemplateId: '9007199254740993' },
    { shippingTemplateId: '-1' },
    { weightKg: '1kg' },
    { lengthCm: '0' },
    { widthCm: '-2' },
    { heightCm: 'Infinity' },
    { moq: 0 },
    { saleType: 'batch', batchNum: 0 },
    { productType: 3 },
    { language: '<script>' }
  ])('rejects invalid shipping inputs without a call: %j', async (change) => {
    const { client, request } = setup(fixtures.coverage);
    await expect(
      client.getShippingCoverage({ ...shippingInput, ...change } as ShippingCoverageInput)
    ).rejects.toMatchObject({ gatewayError: { code: 'REQUEST_CONTRACT_INVALID' } });
    expect(request).not.toHaveBeenCalled();
  });
  it('keeps translation text literal and uses the item trace ID', async () => {
    const { client, request, context } = setup(fixtures.unsafeTranslation);
    const result = await client.translateText(translationInput);
    expect(result.text).toBe(fixtures.unsafeTranslation.result[0]?.translate_result_text);
    expect(result.traceId).toBe(fixtures.unsafeTranslation.result[0]?.trace_id);
    const payload = {
      method: PRODUCT_READ_METHODS.translation,
      parameters: createTranslationReadRequest(translationInput)
    };
    expect(context).toHaveBeenNthCalledWith(1, 'callCapability', payload);
    expect(context).toHaveBeenNthCalledWith(2, 'callCapability', payload);
    expect(request).toHaveBeenCalledExactlyOnceWith('callCapability', payload, {
      galleryContext: fixtures.context
    });
  });
  it('rejects per-item false even when the response contract is valid', async () => {
    const { client } = setup(fixtures.translationFailure);
    await expect(client.translateText(translationInput)).rejects.toMatchObject({
      gatewayError: { code: 'isv.permission-api-package-limit', traceId: 'denied-trace' }
    });
  });
  it('never treats a partial translation as a successful complete result', async () => {
    const { client } = setup(fixtures.translationPartial);
    await expect(client.translateText(translationInput)).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_READ_PARTIAL_FAILURE', traceId: 'envelope-trace' }
    });
  });
  it('does not interpret missing success flags as success', async () => {
    const data = structuredClone(fixtures.translation);
    delete (data.result[0] as Record<string, unknown>).success;
    const { client } = setup(data);
    await expect(client.translateText(translationInput)).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_READ_RESPONSE_INVALID' }
    });
  });
  it('rejects invalid contract envelopes and preserves their trace', async () => {
    const { client, request } = setup();
    request.mockResolvedValueOnce({
      method: PRODUCT_READ_METHODS.translation,
      data: fixtures.translation,
      traceId: 'invalid-contract',
      contractValid: false,
      contractIssues: []
    });
    await expect(client.translateText(translationInput)).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_READ_RESPONSE_INVALID', traceId: 'invalid-contract' }
    });
  });
  it.each([fixtures.countries, fixtures.countriesWrapped])(
    'normalizes documented country list wrappers',
    async (data) => {
      const { client, request } = setup(data);
      const result = await client.listCountries();
      expect(result.items).toEqual([
        {
          code: 'US',
          name: 'United States',
          continentCode: 'NA',
          continentName: 'North America'
        }
      ]);
      expect(result.traceId).toBe(data.trace_id);
      expect(request.mock.calls[0]?.[1]).toEqual({
        method: PRODUCT_READ_METHODS.countries,
        parameters: { country_request: {} }
      });
    }
  );
  it('retains false and unknown determinacy separately without prices or promises', async () => {
    const { client, request } = setup(fixtures.coverage);
    const result = await client.getShippingCoverage(shippingInput);
    expect(result.items.map((item) => item.freightCertain)).toEqual([true, false, false, null]);
    expect(result.items.map((item) => item.core)).toEqual([true, true, false, false]);
    expect(result.traceId).toBe(fixtures.coverage.trace_id);
    expect(Object.keys(result.items[0] ?? {}).sort()).toEqual(['code', 'core', 'freightCertain', 'name']);
    expect(request.mock.calls[0]?.[1]).toEqual({
      method: PRODUCT_READ_METHODS.coverage,
      parameters: fixtures.shippingRequest
    });
  });
  it('rejects biz_success false with trace even if data is present', async () => {
    const { client } = setup(fixtures.coverageFailure);
    await expect(client.getShippingCoverage(shippingInput)).rejects.toMatchObject({
      gatewayError: { code: 'SYS_ERROR', traceId: fixtures.coverageFailure.trace_id }
    });
  });
  it('loads template names/IDs through the existing operation and operation-specific context', async () => {
    const { client, request, context } = setup();
    expect(await client.listShippingTemplates()).toEqual(fixtures.templates);
    expect(context).toHaveBeenNthCalledWith(1, 'listShippingTemplates', undefined);
    expect(request).toHaveBeenCalledExactlyOnceWith('listShippingTemplates', undefined, {
      galleryContext: fixtures.context
    });
  });
  it('does not fall back or retry after a permission rejection', async () => {
    const { client, request } = setup();
    const denied = new GatewayException(fixtures.gatewayDenial);
    request.mockRejectedValueOnce(denied);
    await expect(client.translateText(translationInput)).rejects.toBe(denied);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('fails closed when operation-specific context is unavailable', async () => {
    const { request } = setup();
    const client = new ProductReadToolsClient({ request: request as unknown as GatewayClient['request'] });
    await expect(client.translateText(translationInput)).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_TOP_AUTHORIZATION_REQUIRED' }
    });
    expect(request).not.toHaveBeenCalled();
  });
  it('prevents dispatch when the identity changes while selecting context', async () => {
    const { gateway, request, context } = setup();
    let boundary = '';
    context.mockImplementationOnce(() => {
      boundary = 'changed';
      return Promise.resolve(fixtures.context);
    });
    const client = new ProductReadToolsClient(gateway, () => boundary);
    await expect(client.translateText(translationInput)).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_CONTEXT_CHANGED' }
    });
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects a response if the selected gateway configuration changes during the read', async () => {
    const { client, context } = setup();
    context
      .mockResolvedValueOnce(fixtures.context)
      .mockResolvedValueOnce({ ...fixtures.context, gateway: 'changed' });
    await expect(client.translateText(translationInput)).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_CONTEXT_CHANGED' }
    });
  });
  it.each(['invalidate', 'dispose'] as const)(
    'discards an in-flight result on %s without rereading',
    async (action) => {
      const { client, request } = setup();
      let resolve!: (value: Awaited<ReturnType<typeof request>>) => void;
      request.mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        })
      );
      const pending = client.translateText(translationInput);
      await vi.waitFor(() => {
        expect(request).toHaveBeenCalledTimes(1);
      });
      client[action]();
      resolve({
        method: PRODUCT_READ_METHODS.translation,
        data: fixtures.translation,
        traceId: 'late',
        contractValid: true,
        contractIssues: []
      });
      await expect(pending).rejects.toMatchObject({ gatewayError: { code: 'PRODUCT_CONTEXT_CHANGED' } });
      expect(request).toHaveBeenCalledTimes(1);
    }
  );
});
