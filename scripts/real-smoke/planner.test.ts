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

  it('uses the documented seller role and zero-based order page', () => {
    expect(planSmokeRequest('alibaba.seller.order.list', {}, EMPTY_IDENTIFIERS)).toEqual({
      kind: 'call',
      parameters: {
        param_trade_ecology_order_list_query: { role: 'seller', start_page: 0, page_size: 10 }
      }
    });
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

  it('keeps encrypted and numeric product IDs separate for Schema rendering', () => {
    const identifiers = collectSmokeIdentifiers(
      { products: [{ id: 987654, product_id: 'encrypted-product-id', category_id: 44 }] },
      EMPTY_IDENTIFIERS,
      'alibaba.icbu.product.list'
    );
    expect(identifiers.productId).toBe('encrypted-product-id');
    expect(identifiers.productNumericId).toBe(987654);
    expect(planSmokeRequest('alibaba.icbu.product.schema.render', {}, identifiers)).toEqual({
      kind: 'call',
      parameters: {
        param_product_top_publish_request: { cat_id: 44, language: 'en_US', product_id: 987654 }
      }
    });
    expect(planSmokeRequest('alibaba.icbu.product.schema.render.draft', {}, identifiers)).toEqual({
      kind: 'skip',
      reasonCode: 'MISSING_PREREQUISITE'
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
