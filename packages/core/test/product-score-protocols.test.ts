import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/product-score-protocols.json';
import { ProductAdapter } from '../src/product-adapter';
import { selectAlibabaOperationProtocol } from '../src/alibaba-protocol-routing';
import { createIopBusinessRequest } from '../src/alibaba-iop-business';
import { iopMethodAvailabilityReason } from '../src/alibaba-iop-registry';
import type { AlibabaClient } from '../src/alibaba-client';
const method = 'alibaba.icbu.product.score.get';
const credentials = {
  protocol: 'iop' as const,
  endpoint: 'https://openapi-api.alibaba.com/rest',
  appKey: 'fixture-key',
  appSecret: 'fixture-secret',
  accessToken: 'fixture-token',
  signMethod: 'hmac-sha256' as const
};

describe('product scoring keeps TOP obfuscated IDs separate from IOP plaintext IDs', () => {
  it.each(['top', undefined] as const)(
    'resolves the exact product for %s including legacy unmarked TOP',
    async (protocol) => {
      const call = vi.fn<AlibabaClient['call']>((target) =>
        Promise.resolve({ method: target, data: target === method ? fixture.score : fixture.products })
      );
      const adapter = new ProductAdapter({ call, ...(protocol ? { protocol } : {}) });
      expect(await adapter.getScoreForProduct('410001')).toEqual({
        productId: '410001',
        score: 4.6,
        issues: []
      });
      expect(call.mock.calls).toEqual([
        ['alibaba.icbu.product.list', { id: 410001, language: 'ENGLISH', current_page: 1, page_size: 1 }],
        [method, { product_id: 'opaque-score-fixture' }]
      ]);
    }
  );
  it('does not send a TOP ciphertext or add a list lookup for IOP', async () => {
    const call = vi.fn<AlibabaClient['call']>((target) =>
      Promise.resolve({ method: target, data: fixture.score })
    );
    expect(await new ProductAdapter({ call, protocol: 'iop' }).getScoreForProduct('410001')).toEqual({
      productId: '410001',
      score: 4.6,
      issues: []
    });
    expect(call).toHaveBeenCalledExactlyOnceWith(method, { product_id: '410001' });
  });
  it.each([fixture.missingIdentifier, fixture.wrongProduct, fixture.emptyProducts])(
    'never guesses the cipher or sends the plaintext to TOP if correlation is missing',
    async (response) => {
      const call = vi.fn<AlibabaClient['call']>((target) =>
        Promise.resolve({ method: target, data: response })
      );
      await expect(
        new ProductAdapter({ call, protocol: 'top' }).getScoreForProduct('410001')
      ).rejects.toMatchObject({ gatewayError: { code: 'PRODUCT_SCORE_IDENTIFIER_UNAVAILABLE' } });
      expect(call).toHaveBeenCalledTimes(1);
    }
  );
  it('keeps direct legacy TOP API callers that already supply ciphertext working', async () => {
    const call = vi.fn<AlibabaClient['call']>((target) =>
      Promise.resolve({ method: target, data: fixture.score })
    );
    await new ProductAdapter({ call }).getScoreForProduct('opaque-score-fixture');
    expect(call).toHaveBeenCalledExactlyOnceWith(method, { product_id: 'opaque-score-fixture' });
  });
  it.each(fixture.invalidScores)(
    'does not manufacture a zero score from missing or invalid data',
    async (response) => {
      const call = vi.fn<AlibabaClient['call']>((target) =>
        Promise.resolve({ method: target, data: response })
      );
      await expect(new ProductAdapter({ call }).getScore('opaque-score-fixture')).rejects.toMatchObject({
        gatewayError: { code: 'PRODUCT_SCORE_RESPONSE_INVALID' }
      });
    }
  );
  it('keeps an explicitly returned zero valid', async () => {
    const call = vi.fn<AlibabaClient['call']>((target) =>
      Promise.resolve({ method: target, data: fixture.zero })
    );
    expect((await new ProductAdapter({ call }).getScore('opaque-score-fixture')).score).toBe(0);
  });
  it.each(['top', 'iop'] as const)(
    'preserves the generic TOP contract and plaintext workbench contract, default %s',
    (defaultProtocol) => {
      const both = { top: true, iop: true, defaultProtocol, bindingConfirmed: false };
      expect(
        selectAlibabaOperationProtocol(
          'callCapability',
          { method, parameters: { product_id: 'opaque-score-fixture' } },
          both
        )
      ).toBe('top');
      expect(
        selectAlibabaOperationProtocol(
          'callCapability',
          { method, parameters: { product_id: '410001' } },
          both
        )
      ).toBe('top');
      expect(selectAlibabaOperationProtocol('getProductScore', { productId: '410001' }, both)).toBe('iop');
    }
  );
  it('rejects ciphertext for IOP before network access rather than forwarding or decrypting it', async () => {
    expect(iopMethodAvailabilityReason(method, { product_id: 'opaque-score-fixture' })).toBe(
      'ALIBABA_IOP_PARAMETER_UNSUPPORTED'
    );
    await expect(
      createIopBusinessRequest(credentials, method, { product_id: 'opaque-score-fixture' })
    ).rejects.toMatchObject({ gatewayError: { code: 'ALIBABA_IOP_PARAMETER_UNSUPPORTED' } });
    const request = await createIopBusinessRequest(credentials, method, { product_id: '410001' });
    expect(request.parameters.product_id).toBe('410001');
    expect(request.parameters).not.toHaveProperty('session');
  });
});
