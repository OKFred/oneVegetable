import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/alibaba-auth/iop-product-display.json';
import { createIopBusinessRequest, normalizeIopBusinessResponse } from '../src/alibaba-iop-business';
import { IOP_BUSINESS_ENDPOINT } from '../src/alibaba-iop';
import { ProductAdapter } from '../src/product-adapter';

const credentials = {
  protocol: 'iop' as const,
  endpoint: IOP_BUSINESS_ENDPOINT,
  appKey: 'fixture-key',
  appSecret: 'fixture-secret',
  accessToken: 'fixture-token',
  signMethod: 'hmac-sha256' as const
};
const method = 'alibaba.icbu.product.batch.update.display';
const request = {
  productIds: ['700001'],
  encryptedProductIds: ['fixture-cipher'],
  display: 'offline' as const
};
describe('native IOP display adapter', () => {
  it('uses paired plain IDs only for IOP, leaving historical TOP transport unchanged', async () => {
    const data = normalizeIopBusinessResponse(fixture, method, credentials);
    const call = vi.fn().mockResolvedValue({ method, data });
    const native = new ProductAdapter({ call, protocol: 'iop' });
    expect(await native.updateDisplay(request)).toMatchObject({
      success: true,
      display: 'offline',
      encryptedProductIds: ['fixture-cipher']
    });
    expect(call).toHaveBeenLastCalledWith(method, { product_id_list: [700001], new_display: 'off' });
    await new ProductAdapter({ call }).updateDisplay(request);
    expect(call).toHaveBeenLastCalledWith(method, { product_id_list: 'fixture-cipher', new_display: 'off' });
    await expect(native.updateDisplay({ ...request, productIds: [] })).rejects.toThrow(
      'REQUEST_CONTRACT_INVALID'
    );
    const signed = await createIopBusinessRequest(credentials, method, {
      product_id_list: [700001],
      new_display: 'off'
    });
    expect(JSON.parse(signed.parameters.product_id_list ?? 'null') as unknown).toEqual([700001]);
  });
  it.each([[], ['fixture-cipher'], ['9007199254740993'], [700001, 700001], '700001,700002'])(
    'does not guess encrypted identities or discard invalid targets %#',
    async (product_id_list) => {
      await expect(
        createIopBusinessRequest(credentials, method, { product_id_list, new_display: 'off' })
      ).rejects.toThrow();
    }
  );
  it('requires the native failure map, error field and trace instead of HTTP or a guessed success flag', () => {
    for (const result of [
      {},
      { success: true },
      { ...fixture.result, fail_id_map: [] },
      { trace_id: 'fixture', fail_id_map: {} },
      { ...fixture.result, trace_id: '' },
      { ...fixture.result, error_code: 'DENIED' },
      { ...fixture.result, fail_id_map: { DENIED: [700001] } },
      { ...fixture.result, success: false }
    ])
      expect(() => normalizeIopBusinessResponse({ ...fixture, result }, method, credentials)).toThrow();
  });
});
