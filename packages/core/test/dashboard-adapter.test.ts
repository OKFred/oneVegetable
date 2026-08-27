import { describe, expect, it, vi } from 'vitest';

import { DashboardAdapter } from '../src/dashboard-adapter';
import { GatewayException } from '../src/errors';

import type { AlibabaClient } from '../src/alibaba-client';

function wrapped(method: string, body: Record<string, unknown>) {
  return {
    method,
    data: { [`${method.replaceAll('.', '_')}_response`]: body }
  };
}

describe('DashboardAdapter', () => {
  it('reuses domain adapters to read real nested totals', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) => {
      if (method === 'alibaba.icbu.product.list') {
        return Promise.resolve(wrapped(method, { products: [{}], total_item: 23 }));
      }
      if (method === 'alibaba.icbu.photobank.list') {
        return Promise.resolve(
          wrapped(method, { pagination_query_list: { list: [{ id: 'photo-1' }], total: 41 } })
        );
      }
      if (method === 'alibaba.seller.order.list') {
        return Promise.resolve(wrapped(method, { result: { value: { order_list: [{}], total_count: 7 } } }));
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    const result = await new DashboardAdapter({ call, callWithFile: vi.fn() }).get();

    expect(result).toMatchObject({
      productCount: 23,
      photoCount: 41,
      orderCount: 7,
      metricStatuses: {
        productCount: { state: 'available', source: 'gateway', reasonCode: null },
        photoCount: { state: 'available', source: 'gateway', reasonCode: null },
        orderCount: { state: 'available', source: 'gateway', reasonCode: null },
        enabledCapabilityCount: { state: 'available', source: 'catalog', reasonCode: null }
      }
    });
  });

  it('marks the gallery total unavailable when a full page omits the documented total', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `photo-${index + 1}` }));
    const call = vi.fn<AlibabaClient['call']>((method) => {
      if (method === 'alibaba.icbu.product.list') {
        return Promise.resolve(wrapped(method, { products: [], total_item: 0 }));
      }
      if (method === 'alibaba.icbu.photobank.list') {
        return Promise.resolve(
          wrapped(method, {
            pagination_query_list: {
              list: firstPage
            }
          })
        );
      }
      if (method === 'alibaba.seller.order.list') {
        return Promise.resolve(wrapped(method, { result: { value: { order_list: [], total_count: 0 } } }));
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    await expect(new DashboardAdapter({ call, callWithFile: vi.fn() }).get()).resolves.toMatchObject({
      photoCount: null,
      metricStatuses: {
        photoCount: { state: 'unknown', reasonCode: 'TOTAL_NOT_PROVIDED' }
      }
    });
    expect(call).toHaveBeenCalledWith(
      'alibaba.icbu.photobank.list',
      expect.objectContaining({ current_page: 1, page_size: 100 })
    );
  });

  it('keeps available metrics when one provider call fails', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) => {
      if (method === 'alibaba.icbu.product.list') return Promise.reject(new Error('unavailable'));
      if (method === 'alibaba.icbu.photobank.list') {
        return Promise.resolve(wrapped(method, { pagination_query_list: { list: [] } }));
      }
      if (method === 'alibaba.seller.order.list') {
        return Promise.resolve(wrapped(method, { result: { value: { order_list: [], total_count: 4 } } }));
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    await expect(new DashboardAdapter({ call, callWithFile: vi.fn() }).get()).resolves.toMatchObject({
      productCount: null,
      photoCount: 0,
      orderCount: 4,
      metricStatuses: {
        productCount: { state: 'error', reasonCode: 'GATEWAY_ERROR' },
        photoCount: { state: 'available' },
        orderCount: { state: 'available' }
      }
    });
  });

  it('distinguishes account permission denial from provider failures', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) => {
      if (method === 'alibaba.icbu.product.list') {
        return Promise.reject(
          new GatewayException({
            code: '11',
            subCode: 'isv.permission-api-package-limit',
            message: '当前应用无权限',
            retryable: false
          })
        );
      }
      if (method === 'alibaba.icbu.photobank.list') {
        return Promise.resolve(wrapped(method, { pagination_query_list: { list: [] } }));
      }
      if (method === 'alibaba.seller.order.list') {
        return Promise.resolve(wrapped(method, { result: { value: { order_list: [], total_count: 0 } } }));
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    await expect(new DashboardAdapter({ call, callWithFile: vi.fn() }).get()).resolves.toMatchObject({
      productCount: null,
      metricStatuses: {
        productCount: {
          state: 'permission-denied',
          reasonCode: 'isv.permission-api-package-limit'
        }
      }
    });
  });
});
