import { describe, expect, it, vi } from 'vitest';

import type { AlibabaClient } from '../src/alibaba-client';
import { InsightsAdapter } from '../src/insights-adapter';

function response(method: string, body: Record<string, unknown>) {
  return {
    method,
    data: { [`${method.replaceAll('.', '_')}_response`]: body }
  };
}

describe('InsightsAdapter', () => {
  it('normalizes the supplier rank time series without inventing a trend direction', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) =>
      Promise.resolve(
        response(method, {
          rank_info_list: {
            rank_info: [
              { stat_date: '2026/08/11', percent: 20.1 },
              { stat_date: '2026/08/12', percent: 18.6 }
            ]
          }
        })
      )
    );
    const adapter = new InsightsAdapter({ call });

    await expect(adapter.getSupplierRank()).resolves.toEqual({
      items: [
        { statDate: '2026/08/11', percent: 20.1 },
        { statDate: '2026/08/12', percent: 18.6 }
      ],
      latestPercent: 18.6
    });
  });

  it('maps one-based UI pagination to the documented zero-based supplier query', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) =>
      Promise.resolve(
        response(method, {
          result: {
            curr_page: 2,
            page_size: 25,
            success: true,
            supplier_id_enc_list: ['supplier-enc-001'],
            total_item: 51
          }
        })
      )
    );
    const adapter = new InsightsAdapter({ call });

    await expect(adapter.listSuppliers({ page: 3, pageSize: 25 })).resolves.toMatchObject({
      supplierIds: ['supplier-enc-001'],
      page: 3,
      pageSize: 25,
      total: 51
    });
    expect(call).toHaveBeenCalledWith('alibaba.procurement.mysupplier.list', {
      current_page: 2,
      page_size: 25,
      type: 'order'
    });
  });

  it('rejects an invalid date range before querying supplier products', async () => {
    const call = vi.fn<AlibabaClient['call']>();
    const adapter = new InsightsAdapter({ call });

    await expect(
      adapter.listSupplierProducts({
        supplierId: 'supplier-enc-001',
        dateStart: '2026-08-12T00:00:00.000Z',
        dateEnd: '2026-08-01T00:00:00.000Z'
      })
    ).rejects.toThrow('dateStart 不能晚于 dateEnd');
    expect(call).not.toHaveBeenCalled();
  });

  it('normalizes long product ids, URLs and nested SKU attributes', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) =>
      Promise.resolve(
        response(method, {
          result: {
            curr_page: 0,
            page_size: 10,
            success: true,
            total_order_count: 1,
            product_list: [
              {
                id: '9223372036854775807',
                subject: 'Portable solar power station',
                description: 'Backup power',
                category: '100003109',
                price_range: '599~699',
                price_unit: 1,
                product_detail_url: 'www.alibaba.com/product-detail/mock.html',
                publish_time: '2026-08-01',
                sku: {
                  attributes: [
                    {
                      attribute_id: 1,
                      attribute_name: 'Color',
                      value_id: 2,
                      value_name: 'Black',
                      sku_custom_image_url: '0',
                      sku_custom_value_name: ''
                    }
                  ]
                }
              }
            ]
          }
        })
      )
    );
    const adapter = new InsightsAdapter({ call });

    const page = await adapter.listSupplierProducts({ supplierId: 'supplier-enc-001' });

    expect(page.items[0]).toMatchObject({
      id: '9223372036854775807',
      categoryId: '100003109',
      productUrl: 'https://www.alibaba.com/product-detail/mock.html',
      attributes: [{ attributeId: '1', valueId: '2', imageUrl: null, customValueName: null }]
    });
    expect(call).toHaveBeenCalledWith('alibaba.procurement.supplier.items.get', {
      product_list_query: {
        page_index: 0,
        page_size: 10,
        seller_account_id: 'supplier-enc-001',
        type: 'order'
      }
    });
  });
});
