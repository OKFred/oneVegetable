import { describe, expect, it } from 'vitest';

import {
  collectSmokeIdentifiers,
  EMPTY_IDENTIFIERS,
  planSmokeRequest,
  responseShape,
  sortSmokeMethods
} from './planner';

describe('real smoke planner', () => {
  it('runs seed methods before dependent detail methods', () => {
    const methods = sortSmokeMethods([
      { method: 'alibaba.icbu.product.get' },
      { method: 'alibaba.seller.order.list' },
      { method: 'alibaba.icbu.product.list' }
    ]);
    expect(methods.map((item) => item.method)).toEqual([
      'alibaba.icbu.product.list',
      'alibaba.seller.order.list',
      'alibaba.icbu.product.get'
    ]);
  });

  it('does not use documentation placeholder IDs when real prerequisites are absent', () => {
    expect(
      planSmokeRequest(
        'alibaba.icbu.product.get',
        { product_id: 'documentation-placeholder' },
        EMPTY_IDENTIFIERS
      )
    ).toEqual({ kind: 'skip', reasonCode: 'MISSING_PREREQUISITE' });
  });

  it('derives only named identifiers and injects them into detail requests', () => {
    const identifiers = collectSmokeIdentifiers(
      { result: { items: [{ product_id: 123, subject: 'private product title' }] } },
      EMPTY_IDENTIFIERS
    );
    expect(identifiers.productId).toBe('123');
    expect(planSmokeRequest('alibaba.icbu.product.get', {}, identifiers)).toEqual({
      kind: 'call',
      parameters: { language: 'ENGLISH', product_id: '123' }
    });
  });

  it('records response structure without primitive values', () => {
    const shape = JSON.stringify(
      responseShape({ buyerEmail: 'buyer@example.com', items: [{ id: 'secret-id', amount: 42 }] })
    );
    expect(shape).not.toContain('buyer@example.com');
    expect(shape).not.toContain('secret-id');
    expect(shape).not.toContain('42');
    expect(shape).toContain('buyerEmail');
    expect(shape).toContain('string');
  });
});
