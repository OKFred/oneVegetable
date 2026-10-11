import { describe, expect, it } from 'vitest';
import { summarizeIopProductRead } from './iop-product-read';
import fixture from '../../mock/data/alibaba-auth/iop-token-responses.json';

describe('IOP product read evidence', () => {
  it('requires explicit success, safe identifiers and a consistent count without retaining records', () => {
    expect(summarizeIopProductRead(fixture.productRead)).toEqual({ itemCount: 1, totalItems: 1 });
    expect(summarizeIopProductRead({ code: 0, result: { products: [], total_item: 0 } })).toEqual({
      itemCount: 0,
      totalItems: 0
    });
  });
  it.each([
    { result: { products: [], total_item: 0 } },
    { code: '0', result: { products: [] } },
    { code: '0', result: { products: [], total_item: 1 } },
    { code: '0', result: { products: [{ id: Number.MAX_SAFE_INTEGER + 1 }], total_item: 1 } },
    { code: '0', result: { products: [{ id: '1' }], total_item: -1 } },
    fixture.invalidAppKey
  ])('does not turn incomplete, unsafe or failed responses into a successful empty result', (value) => {
    expect(summarizeIopProductRead(value)).toBeNull();
  });
});
