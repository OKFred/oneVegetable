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
      Promise.resolve(
        response(method, {
          products: [
            {
              id: 123,
              product_id: 'encrypted-product-id',
              subject: 'Real product',
              category_id: 456,
              status: 'approved',
              gmt_modified: '2026-08-20 12:30:00'
            }
          ],
          total_item: 1
        })
      )
    );
    const adapter = new ProductAdapter({ call });

    const result = await adapter.list({ page: 1, pageSize: 20 });

    expect(result.items[0]?.categoryId).toBe(456);
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
});
