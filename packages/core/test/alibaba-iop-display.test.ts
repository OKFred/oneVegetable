import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/alibaba-auth/iop-product-display.json';
import { createIopBusinessRequest, normalizeIopBusinessResponse } from '../src/alibaba-iop-business';
import { IOP_BUSINESS_ENDPOINT } from '../src/alibaba-iop';
import { ProductAdapter } from '../src/product-adapter';
import { validateProductDisplayInput } from '../src/validation';
import { selectAlibabaOperationProtocol } from '../src/alibaba-protocol-routing';
import { displayRequestForJob, readProductDisplayTargets } from '../src/product-display-identity';
import type { ProductMutationJob } from '../src/product-mutation-job';

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
  it('accepts plain IOP IDs, rejects missing TOP pairs and never switches an explicitly selected protocol', async () => {
    const input = { ...request, protocol: 'iop' as const, encryptedProductIds: [] };
    expect(validateProductDisplayInput(input).valid).toBe(true);
    expect(validateProductDisplayInput({ ...input, protocol: 'top' }).valid).toBe(false);
    expect(validateProductDisplayInput({ ...input, protocol: undefined }).valid).toBe(false);
    expect(
      validateProductDisplayInput({
        ...input,
        productIds: Array.from({ length: 31 }, (_, index) => String(index + 1))
      }).valid
    ).toBe(false);
    const call = vi
      .fn()
      .mockResolvedValue({ method, data: normalizeIopBusinessResponse(fixture, method, credentials) });
    await new ProductAdapter({ call, protocol: 'iop' }).updateDisplay(input);
    expect(call).toHaveBeenCalledWith(method, { product_id_list: [700001], new_display: 'off' });
    call.mockClear();
    await expect(new ProductAdapter({ call }).updateDisplay(input)).rejects.toThrow(
      'ALIBABA_PROTOCOL_ENDPOINT_MISMATCH'
    );
    expect(call).not.toHaveBeenCalled();
    const available = { top: true, iop: false, defaultProtocol: 'top' as const, bindingConfirmed: false };
    expect(() => selectAlibabaOperationProtocol('updateProductDisplay', input, available)).toThrow(
      'ALIBABA_PROTOCOL_ENDPOINT_MISMATCH'
    );
    const job = {
      productId: '700001',
      protocol: 'iop',
      encryptedProductId: null,
      productContext: { identity: 'a'.repeat(64), gateway: 'b'.repeat(64) }
    } as ProductMutationJob;
    expect(displayRequestForJob(job, 'online')).toEqual({ ...input, display: 'online' });
    const { protocol: _protocol, ...legacy } = job;
    expect(() => displayRequestForJob(legacy, 'online')).toThrow();
    const list = vi.fn().mockResolvedValue({ items: [] });
    await expect(readProductDisplayTargets(list, input)).rejects.toThrow();
    expect(list).toHaveBeenCalledExactlyOnceWith({
      productId: '700001',
      page: 1,
      pageSize: 1,
      language: 'en_US'
    });
    list.mockResolvedValue({ items: [{ id: '700001', status: 'online', encryptedId: null }], total: 2 });
    await expect(readProductDisplayTargets(list, input)).rejects.toThrow();
  });
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
  it.each(
    [[], ['fixture-cipher'], ['9007199254740993'], [700001, 700001], '700001,700002'].map(
      (product_id_list) => ({ product_id_list })
    )
  )('does not guess encrypted identities or discard invalid targets %#', async ({ product_id_list }) => {
    await expect(
      createIopBusinessRequest(credentials, method, { product_id_list, new_display: 'off' })
    ).rejects.toThrow();
  });
  it('requires the native failure map, error field and trace instead of HTTP or a guessed success flag', () => {
    for (const result of [
      {},
      { success: true },
      { ...fixture.result, fail_id_map: [] },
      { trace_id: 'fixture', fail_id_map: {} },
      { ...fixture.result, error_code: 'DENIED' },
      { ...fixture.result, fail_id_map: { DENIED: [700001] } },
      { ...fixture.result, success: false }
    ])
      expect(() => normalizeIopBusinessResponse({ ...fixture, result }, method, credentials)).toThrow();
  });
});
