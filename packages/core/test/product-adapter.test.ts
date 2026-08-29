import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { AlibabaClient } from '../src/alibaba-client';
import { ProductAdapter } from '../src/product-adapter';

const schemaJsonFixture = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../mock/data/product-transfer-schema-json-v1.json'),
    'utf8'
  )
) as { products: { schemaJson: unknown }[] };

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
              main_image: {
                images: { string: ['https://sc04.alicdn.com/kf/product-cover.jpg'] }
              },
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
          imageUrl: 'https://sc04.alicdn.com/kf/product-cover.jpg',
          status: 'online'
        }
      ]
    });
    expect(call).toHaveBeenCalledWith(
      'alibaba.icbu.product.list',
      expect.objectContaining({ language: 'CHINESE' })
    );
  });

  it('keeps a modified product in auditing even while display is N', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) =>
      Promise.resolve({
        method,
        data: {
          products: [
            {
              id: 123,
              product_id: 'encrypted-product-id',
              subject: 'Pending product',
              status: 'modified',
              display: 'N'
            }
          ],
          total_item: 1
        }
      })
    );
    const adapter = new ProductAdapter({ call });

    await expect(adapter.list({ page: 1, pageSize: 20 })).resolves.toMatchObject({
      items: [{ id: '123', status: 'auditing' }]
    });
  });

  it('expands documented category child_ids into selectable root categories', async () => {
    const call = vi.fn<AlibabaClient['call']>((method, parameters) => {
      const categoryId = (parameters as { cat_id: number }).cat_id;
      const categories: Record<number, Record<string, unknown>> = {
        0: { category_id: 0, name: '', leaf_category: false, child_ids: { number: [10, 20] } },
        10: { category_id: 10, name: 'Apparel', leaf_category: false, child_ids: { string: ['11'] } },
        20: { category_id: 20, name: 'Bags', leaf_category: true, child_ids: [] }
      };
      return Promise.resolve(response(method, { category: categories[categoryId] ?? {} }));
    });
    const adapter = new ProductAdapter({ call });

    await expect(adapter.listCategories()).resolves.toEqual([
      { id: 10, name: 'Apparel', leaf: false, children: [] },
      { id: 20, name: 'Bags', leaf: true, children: [] }
    ]);
  });

  it('returns the selected category with one loaded child level', async () => {
    const call = vi.fn<AlibabaClient['call']>((method, parameters) => {
      const categoryId = (parameters as { cat_id: number }).cat_id;
      const categories: Record<number, Record<string, unknown>> = {
        10: { category_id: 10, name: 'Apparel', leaf_category: false, child_ids: { number: [11] } },
        11: { category_id: 11, name: 'Dresses', leaf_category: true, child_ids: [] }
      };
      return Promise.resolve(response(method, { category: categories[categoryId] ?? {} }));
    });
    const adapter = new ProductAdapter({ call });

    await expect(adapter.listCategories(10)).resolves.toEqual([
      {
        id: 10,
        name: 'Apparel',
        leaf: false,
        children: [{ id: 11, name: 'Dresses', leaf: true, children: [] }]
      }
    ]);
  });

  it('reuses category records across lazy tree requests', async () => {
    const call = vi.fn<AlibabaClient['call']>((method, parameters) => {
      const categoryId = (parameters as { cat_id: number }).cat_id;
      const categories: Record<number, Record<string, unknown>> = {
        0: { category_id: 0, name: '', leaf_category: false, child_ids: { number: [10] } },
        10: { category_id: 10, name: 'Apparel', leaf_category: false, child_ids: { number: [11] } },
        11: { category_id: 11, name: 'Dresses', leaf_category: true, child_ids: [] }
      };
      return Promise.resolve(response(method, { category: categories[categoryId] ?? {} }));
    });
    const categoryCache = new Map<number, Record<string, unknown>>();
    const adapter = new ProductAdapter({ call }, undefined, categoryCache);

    await adapter.listCategories();
    await adapter.listCategories(10);

    expect(call.mock.calls.filter(([, parameters]) => parameters.cat_id === 10)).toHaveLength(1);
    expect(categoryCache.has(0)).toBe(true);
    expect(categoryCache.has(10)).toBe(true);
    expect(categoryCache.has(11)).toBe(true);
  });

  it('uses the selected language when rendering a platform draft', async () => {
    const call = vi.fn<AlibabaClient['call']>((method, parameters) => {
      expect(parameters).toEqual({
        param_product_top_publish_request: { product_id: 123, language: 'zh_CN' }
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

  it('does not clamp a provider score when the official API omits a maximum', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) =>
      Promise.resolve({ method, data: { result: { final_score: '5.6' } } })
    );
    const adapter = new ProductAdapter({ call });

    await expect(adapter.getScore('encrypted-product-id')).resolves.toMatchObject({ score: 5.6 });
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
    const call = vi.fn<AlibabaClient['call']>((method, parameters) => {
      expect(parameters).toEqual({
        param_product_top_publish_request: {
          cat_id: '456',
          language: 'en_US',
          publish_type: 'default',
          version: 'trade.1.1',
          xml: '<itemSchema />'
        }
      });
      return Promise.resolve(
        response(method, {
          biz_success: true,
          product_id: '1600000000123',
          trace_id: 'mutation-trace'
        })
      );
    });
    const adapter = new ProductAdapter({ call: vi.fn() }, { call });

    await expect(
      adapter.mutate('alibaba.icbu.product.schema.add.draft', {
        categoryId: 456,
        language: 'en_US',
        schemaXml: '<itemSchema />'
      })
    ).resolves.toEqual({ productId: '1600000000123', traceId: 'mutation-trace', success: true });
  });

  it('rejects attempts to overwrite a platform draft before calling Alibaba', async () => {
    const call = vi.fn<AlibabaClient['call']>();
    const adapter = new ProductAdapter({ call: vi.fn() }, { call });

    await expect(
      adapter.saveDraft({
        categoryId: 456,
        language: 'zh_CN',
        productId: '1600000000123',
        schemaXml: '<itemSchema />'
      })
    ).rejects.toMatchObject({ gatewayError: { code: 'ALIBABA_DRAFT_UPDATE_UNSUPPORTED' } });
    expect(call).not.toHaveBeenCalled();
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

  it('updates only the supplied product Schema patch through the documented TOP client', async () => {
    const call = vi.fn<AlibabaClient['call']>((method, parameters) => {
      expect(method).toBe('alibaba.icbu.product.schema.update');
      expect(parameters).toEqual({
        param_product_top_publish_request: {
          cat_id: 456,
          language: 'en_US',
          product_id: 1600000000123,
          xml: '<itemSchema><field id="productTitle"><value>Updated</value></field></itemSchema>'
        }
      });
      return Promise.resolve(
        response(method, {
          biz_success: true,
          product_id: 1600000000123,
          trace_id: 'update-trace'
        })
      );
    });
    const syncCall = vi.fn<AlibabaClient['call']>();
    const adapter = new ProductAdapter({ call }, { call: syncCall });

    await expect(
      adapter.update({
        productId: '1600000000123',
        categoryId: 456,
        language: 'en_US',
        schemaPatchXml: '<itemSchema><field id="productTitle"><value>Updated</value></field></itemSchema>'
      })
    ).resolves.toEqual({ productId: '1600000000123', traceId: 'update-trace', success: true });
    expect(syncCall).not.toHaveBeenCalled();
  });

  it('uses encrypted IDs and on/off values for product display mutations', async () => {
    const call = vi.fn<AlibabaClient['call']>((method, parameters) => {
      expect(method).toBe('alibaba.icbu.product.batch.update.display');
      expect(parameters).toEqual({ product_id_list: 'encrypted-1,encrypted-2', new_display: 'off' });
      return Promise.resolve(response(method, { sub_success: true, trace_id: 'display-trace' }));
    });
    const adapter = new ProductAdapter({ call });

    await expect(
      adapter.updateDisplay({
        productIds: ['1', '2'],
        encryptedProductIds: ['encrypted-1', 'encrypted-2'],
        display: 'offline'
      })
    ).resolves.toEqual({
      encryptedProductIds: ['encrypted-1', 'encrypted-2'],
      display: 'offline',
      traceId: 'display-trace',
      success: true
    });
  });

  it('rejects a product display response without explicit success', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) =>
      Promise.resolve(
        response(method, {
          sub_success: false,
          sub_error_code: 'SERVICE_INTERNAL_ERROR',
          sub_error_msg: 'invalid display value',
          trace_id: 'display-failed'
        })
      )
    );
    const adapter = new ProductAdapter({ call });

    await expect(
      adapter.updateDisplay({
        productIds: ['1'],
        encryptedProductIds: ['encrypted-1'],
        display: 'online'
      })
    ).rejects.toMatchObject({ gatewayError: { code: 'SERVICE_INTERNAL_ERROR', traceId: 'display-failed' } });
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

  it('uses canonical Schema JSON when a render response omits XML', async () => {
    const schemaJson = schemaJsonFixture.products[0]?.schemaJson;
    if (!schemaJson) throw new Error('Missing Schema JSON adapter fixture');
    const call = vi.fn<AlibabaClient['call']>((method) =>
      Promise.resolve(response(method, { schemaJson, biz_success: true }))
    );
    const adapter = new ProductAdapter({ call });

    const rendered = await adapter.renderSchema({
      categoryId: 456,
      language: 'en_US',
      productId: '123'
    });
    expect(rendered.xml).toContain('Schema JSON fallback product');
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

  it('creates a product group only when Alibaba confirms its parent, name and id', async () => {
    const call = vi.fn<AlibabaClient['call']>((method, parameters) => {
      expect(parameters).toEqual({ group_name: 'Smoke child', parent_id: 916243313, extra_context: {} });
      return Promise.resolve(
        response(method, {
          product_group: { group_id: 987654321, group_name: 'Smoke child', parent_id: 916243313 }
        })
      );
    });
    const adapter = new ProductAdapter({ call });

    await expect(adapter.createGroup({ name: 'Smoke child', parentId: 916243313 })).resolves.toEqual({
      id: 987654321,
      name: 'Smoke child',
      children: []
    });
  });
});
