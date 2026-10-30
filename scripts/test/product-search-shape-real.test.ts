import { describe, expect, it, vi } from 'vitest';
import credentialsFixture from '../../mock/data/node-gateway-credentials.json';
import lookupFixture from '../../mock/data/product-lookup.json';
import referenceFixture from '../../mock/data/product-reference/examples.json';
import {
  main,
  parseSearchDiagnosticOptions,
  runSearchShapeDiagnostic,
  searchPayloadShape
} from '../diagnose-product-search-shape-real';

const args = [
  '--confirm-readonly',
  '--iop-credential=artifacts/fixture.json',
  '--model-number=' + lookupFixture.queries.modelNumber,
  '--output=artifacts/new-shape.json'
];
describe('single-search readonly shape diagnostic', () => {
  it('requires opt-in and an exact bounded model; refuses duplicate or expanded methods', () => {
    expect(parseSearchDiagnosticOptions(args).modelNumber).toBe(lookupFixture.queries.modelNumber);
    for (const invalid of [
      args.slice(1),
      [...args, '--method=write'],
      args.map((arg) => (arg.startsWith('--model-number=') ? '--model-number=*' : arg)),
      args.map((arg) => (arg.startsWith('--model-number=') ? '--output=artifacts/duplicate.json' : arg))
    ])
      expect(() => parseSearchDiagnosticOptions(invalid)).toThrow();
  });
  it('describes only public keys/types, never values or arbitrary business-named keys', () => {
    const secret = credentialsFixture.oauthBundle.application.appSecret;
    const shape = searchPayloadShape({
      success: true,
      product_info: [
        {
          basic_info: { title: secret, model_number: lookupFixture.queries.modelNumber },
          arbitraryBusinessName: secret
        }
      ]
    });
    expect(shape).toContainEqual({ path: '/product_info/*/basic_info/title', type: 'string' });
    for (const forbidden of [secret, lookupFixture.queries.modelNumber, 'arbitraryBusinessName'])
      expect(JSON.stringify(shape)).not.toContain(forbidden);
    expect(searchPayloadShape(null)).toEqual([{ path: '', type: 'null' }]);
  });
  it('runs exactly one guarded search, diagnoses an invalid scalar and stores only safe metadata', async () => {
    const external = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('OFFLINE_NETWORK_DENIED'));
    const app = credentialsFixture.oauthBundle.application;
    const price = structuredClone(
      referenceFixture['/alibaba/icbu/product/get/v2'].response.product_info.trade_info.price
    );
    const tier = price.tiered_price[0];
    if (!tier) throw new Error('MISSING_FIXTURE_PRICE');
    Reflect.set(tier, 'price', false);
    const send = vi.fn((input: RequestInfo | URL, init: RequestInit) => {
      const request = new Request(input, init);
      expect(new URL(request.url).pathname).toBe('/rest/alibaba/icbu/product/search/v2');
      expect(init.redirect).toBe('error');
      return Promise.resolve(
        Response.json({
          code: '0',
          success: true,
          product_info: [{ trade_info: { price } }],
          page: { ...lookupFixture.response.page, page_size: 1 }
        })
      );
    });
    const saved: unknown[] = [];
    try {
      const report = await runSearchShapeDiagnostic(
        lookupFixture.queries.modelNumber,
        {
          protocol: 'iop',
          appKey: app.appKey,
          appSecret: app.appSecret,
          accessToken: credentialsFixture.oauthBundle.oauth.accessToken,
          endpoint: 'https://openapi-api.alibaba.com/rest',
          signMethod: 'hmac-sha256'
        },
        { send },
        (report) => {
          saved.push(structuredClone(report));
          return Promise.resolve();
        }
      );
      expect(send).toHaveBeenCalledTimes(1);
      expect(external).not.toHaveBeenCalled();
      expect(report.networkRequests).toBe(1);
      expect(report.errorCode).toBe('RESPONSE_CONTRACT_INVALID');
      expect(report.contractIssues).toEqual([
        {
          instancePath: '/product_info/*/trade_info/price/tiered_price/*/price',
          keyword: 'type'
        }
      ]);
      expect(report.shape).toContainEqual({
        path: '/product_info/*/trade_info/price/tiered_price/*/price',
        type: 'boolean'
      });
      expect(saved).toHaveLength(2);
      for (const forbidden of [
        app.appSecret,
        app.appKey,
        lookupFixture.queries.modelNumber,
        credentialsFixture.oauthBundle.oauth.accessToken,
        'must be string',
        'model_number'
      ])
        expect(JSON.stringify(saved)).not.toContain(forbidden);
    } finally {
      external.mockRestore();
    }
  });
  it('rejects a non-artifact report before reading any credential file', async () => {
    await expect(
      main(args.map((arg) => (arg.startsWith('--output=') ? '--output=mock/report.json' : arg)))
    ).rejects.toThrow('NEW_IGNORED_RECEIPT_REQUIRED');
  });
});
