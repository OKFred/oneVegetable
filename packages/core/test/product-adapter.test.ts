import { describe, expect, it, vi } from 'vitest';

import type { AlibabaClient } from '../src/alibaba-client';
import { ProductAdapter } from '../src/product-adapter';

function response(method: string, body: Record<string, unknown>) {
  return {
    method,
    data: { [`${method.replaceAll('.', '_')}_response`]: body }
  };
}

describe('ProductAdapter', () => {
  it('keeps the documented category id on product summaries', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) =>
      Promise.resolve({
        method,
        data: {
          products: [
            {
              id: 123,
              product_id: 'encrypted-product-id',
              subject: 'Real product',
              category_id: 456,
              display: 'Y',
              gmt_modified: '2026-08-20 12:30:00'
            }
          ],
          total_item: 37
        }
      })
    );
    const adapter = new ProductAdapter({ call });

    const result = await adapter.list({ page: 1, pageSize: 20, language: 'zh_CN' });

    expect(result).toMatchObject({
      total: 37,
      items: [
        {
          id: '123',
          encryptedId: 'encrypted-product-id',
          categoryId: 456,
          status: 'online'
        }
      ]
    });
    expect(call).toHaveBeenCalledWith(
      'alibaba.icbu.product.list',
      expect.objectContaining({ language: 'CHINESE' })
    );
  });

  it('uses the selected language when rendering a platform draft', async () => {
    const call = vi.fn<AlibabaClient['call']>((method, parameters) => {
      expect(parameters).toEqual({
        param_product_top_publish_request: { product_id: '123', language: 'zh_CN' }
      });
      return Promise.resolve({ method, data: { data: '<itemSchema />' } });
    });
    const adapter = new ProductAdapter({ call });

    await expect(adapter.get('123', true, 'zh_CN')).resolves.toMatchObject({
      id: '123',
      language: 'zh_CN',
      schemaXml: '<itemSchema />'
    });
  });

  it('uses the encrypted product id and reads the real nested score response', async () => {
    const call = vi.fn<AlibabaClient['call']>((method, parameters) => {
      expect(parameters).toEqual({ product_id: 'encrypted-product-id' });
      return Promise.resolve({
        method,
        data: { result: { boutique_tag: 1, final_score: '4.6' } }
      });
    });
    const adapter = new ProductAdapter({ call });

    await expect(adapter.getScore('encrypted-product-id')).resolves.toEqual({
      productId: 'encrypted-product-id',
      score: 4.6,
      issues: []
    });
  });

  it('renders an existing product with its documented numeric id and category', async () => {
    const call = vi.fn<AlibabaClient['call']>((method, parameters) => {
      expect(method).toBe('alibaba.icbu.product.schema.render');
      expect(parameters).toEqual({
        param_product_top_publish_request: {
          cat_id: 456,
          language: 'en_US',
          product_id: 123
        }
      });
      return Promise.resolve({ method, data: { biz_success: true, data: '<itemSchema />' } });
    });
    const adapter = new ProductAdapter({ call });

    await expect(
      adapter.renderSchema({ categoryId: 456, language: 'en_US', productId: '123' })
    ).resolves.toEqual({
      xml: '<itemSchema />',
      categoryId: 456,
      language: 'en_US',
      market: 'wholesale'
    });
  });

  it('accepts a product mutation only with explicit biz_success and product_id', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) =>
      Promise.resolve(
        response(method, {
          biz_success: true,
          product_id: '1600000000123',
          trace_id: 'mutation-trace'
        })
      )
    );
    const adapter = new ProductAdapter({ call });

    await expect(
      adapter.mutate('alibaba.icbu.product.schema.add.draft', {
        categoryId: 456,
        language: 'en_US',
        schemaXml: '<itemSchema />'
      })
    ).resolves.toEqual({ productId: '1600000000123', traceId: 'mutation-trace', success: true });
  });

  it('does not infer mutation success when Alibaba omits confirmation fields', async () => {
    const missingSuccess = new ProductAdapter({
      call: vi.fn<AlibabaClient['call']>((method) =>
        Promise.resolve(response(method, { product_id: '1600000000123', trace_id: 'missing-success' }))
      )
    });
    const missingProductId = new ProductAdapter({
      call: vi.fn<AlibabaClient['call']>((method) =>
        Promise.resolve(response(method, { biz_success: true, trace_id: 'missing-product' }))
      )
    });
    const request = { categoryId: 456, language: 'en_US' as const, schemaXml: '<itemSchema />' };

    await expect(
      missingSuccess.mutate('alibaba.icbu.product.schema.add.draft', request)
    ).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_PRODUCT_MUTATION_UNCONFIRMED', traceId: 'missing-success' }
    });
    await expect(
      missingProductId.mutate('alibaba.icbu.product.schema.add.draft', request)
    ).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_PRODUCT_ID_MISSING', traceId: 'missing-product' }
    });
  });

  it('rejects an unsafe plaintext product id before calling Alibaba', async () => {
    const call = vi.fn<AlibabaClient['call']>();
    const adapter = new ProductAdapter({ call });

    await expect(
      adapter.renderSchema({ categoryId: 456, language: 'en_US', productId: '9007199254740992' })
    ).rejects.toThrow('商品明文 ID 必须是安全范围内的正整数');
    expect(call).not.toHaveBeenCalled();
  });

  it('returns a structured provider error when render has no XML', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) =>
      Promise.resolve({
        method,
        data: {
          biz_success: false,
          msg_code: 'PUB_BIZCHECK_PRODUCT_IN_AUDITING',
          message: 'Product is under review',
          trace_id: 'render-trace'
        }
      })
    );
    const adapter = new ProductAdapter({ call });

    await expect(
      adapter.renderSchema({ categoryId: 456, language: 'en_US', productId: '123' })
    ).rejects.toMatchObject({
      gatewayError: {
        code: 'PUB_BIZCHECK_PRODUCT_IN_AUDITING',
        traceId: 'render-trace',
        retryable: false
      }
    });
  });

  it('uses cat_id 0 for the documented top-level category query', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) =>
      Promise.resolve(
        response(method, {
          category: {
            category_id: 100,
            name: 'Root category',
            leaf_category: false
          }
        })
      )
    );
    const adapter = new ProductAdapter({ call });

    await expect(adapter.listCategories()).resolves.toEqual([
      { id: 100, name: 'Root category', leaf: false, children: [] }
    ]);
    expect(call).toHaveBeenCalledWith('alibaba.icbu.category.get.new', { cat_id: 0 });
  });

  it('passes an explicit parent category id when traversing the tree', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) => Promise.resolve(response(method, {})));
    const adapter = new ProductAdapter({ call });

    await adapter.listCategories(123);

    expect(call).toHaveBeenCalledWith('alibaba.icbu.category.get.new', { cat_id: 123 });
  });

  it('uses group_id -1 for the documented top-level product group query', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) =>
      Promise.resolve(
        response(method, {
          product_group: [{ group_id: 456, group_name: 'Best sellers' }]
        })
      )
    );
    const adapter = new ProductAdapter({ call });

    await expect(adapter.listGroups()).resolves.toEqual([{ id: 456, name: 'Best sellers', children: [] }]);
    expect(call).toHaveBeenCalledWith('alibaba.icbu.product.group.get', { group_id: -1 });
  });

  it('loads child group names lazily from documented children IDs', async () => {
    const call = vi.fn<AlibabaClient['call']>((method, parameters) => {
      const groupId = (parameters as { group_id: number }).group_id;
      if (groupId === 456) {
        return Promise.resolve(
          response(method, {
            product_group: {
              group_id: 456,
              group_name: 'Best sellers',
              children_id_list: { number: [788, 789] }
            }
          })
        );
      }
      return Promise.resolve(
        response(method, {
          product_group: {
            group_id: groupId,
            group_name: groupId === 788 ? 'Portable power' : 'Solar products'
          }
        })
      );
    });
    const adapter = new ProductAdapter({ call });

    await expect(adapter.listGroups(456)).resolves.toEqual([
      { id: 788, name: 'Portable power', children: [] },
      { id: 789, name: 'Solar products', children: [] }
    ]);
    expect(call).toHaveBeenCalledWith('alibaba.icbu.product.group.get', { group_id: 456 });
    expect(call).toHaveBeenCalledWith('alibaba.icbu.product.group.get', { group_id: 788 });
    expect(call).toHaveBeenCalledWith('alibaba.icbu.product.group.get', { group_id: 789 });
  });
});
