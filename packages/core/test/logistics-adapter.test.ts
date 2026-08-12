import { describe, expect, it, vi } from 'vitest';

import type { AlibabaClient } from '../src/alibaba-client';
import { LogisticsAdapter } from '../src/logistics-adapter';
import type { LogisticsQuoteRequest } from '../src/types';

function response(method: string, body: Record<string, unknown>) {
  return {
    method,
    data: { [`${method.replaceAll('.', '_')}_response`]: body }
  };
}

function quoteRequest(): LogisticsQuoteRequest {
  return {
    originZipCode: '518000',
    destinationCountryCode: 'US',
    destinationZipCode: '07005',
    warehouseCode: 'ASP_YH_SZJC',
    productCode: 'EX_ASP_ePacket',
    cargo: [
      {
        nameCn: '无线耳机',
        nameEn: 'Wireless headphones',
        hsCode: '85183000',
        quantity: '10',
        unit: 'pcs',
        declarationValue: '18.50',
        currency: 'USD',
        purpose: '消费电子',
        material: '塑料和电子元件',
        productTypeCodes: ['battery']
      }
    ],
    packages: [
      {
        quantity: '1',
        lengthCm: '40',
        widthCm: '30',
        heightCm: '25',
        weightKg: '6.5',
        type: 'box'
      }
    ],
    consignor: {
      countryCode: 'CN',
      provinceCode: '330000',
      cityCode: '330100',
      divisionCode: '330108',
      streetCode: null,
      address1: '阿里西溪园区',
      address2: null,
      zipCode: '518000',
      contact: {
        contactPerson: 'Mock Seller',
        mobileNo: '13800000000',
        email: 'seller@example.com',
        companyName: 'Mock Supplier Ltd.'
      }
    },
    consignee: {
      countryCode: 'US',
      provinceCode: 'NJ',
      cityCode: 'ABSECON',
      divisionCode: null,
      streetCode: null,
      address1: '700 New Road',
      address2: null,
      zipCode: '07005',
      contact: {
        contactPerson: 'Mock Buyer',
        mobileNo: '12025550123',
        email: 'buyer@example.com',
        companyName: 'Mock Buyer LLC'
      }
    },
    customs: {
      declarationAmount: '185',
      declarationCurrency: 'USD',
      needCustomsClearance: true,
      vatType: null,
      vatNumber: null,
      taxpayerId: null,
      eoriNumber: null
    },
    needPickup: false,
    supplyChainBizId: '1001',
    tradeBizId: '24668306501026709',
    tradePlatform: 'ICBU'
  };
}

describe('LogisticsAdapter', () => {
  it('rejects an invalid quote before the Alibaba client can be called', async () => {
    const call = vi.fn<AlibabaClient['call']>();
    const adapter = new LogisticsAdapter({ call });
    const request = quoteRequest();
    request.packages = [];

    await expect(adapter.calculateQuote(request)).rejects.toThrow('物流试算参数不合法');
    expect(call).not.toHaveBeenCalled();
  });

  it('maps a typed quote request to the documented nested charge payload', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) =>
      Promise.resolve(
        response(method, {
          result: {
            success: true,
            values: {
              express_quote_item_list: [{ sales_amount: { amount: '109.20', currency: 'CNY' } }]
            }
          }
        })
      )
    );
    const adapter = new LogisticsAdapter({ call });

    await expect(adapter.calculateQuote(quoteRequest())).resolves.toMatchObject({
      options: [
        {
          productCode: 'EX_ASP_ePacket',
          totalAmount: '109.20',
          currency: 'CNY',
          warehouseCode: 'ASP_YH_SZJC'
        }
      ],
      issues: []
    });
    const firstCall = call.mock.calls[0];
    expect(firstCall?.[0]).toBe('alibaba.onetouch.logistics.express.charge.calculate');
    expect(firstCall?.[1]).toMatchObject({
      paramn_query: {
        destination_country_code: 'US',
        supply_chain_biz_id: '1001',
        package_list: [{ length: '40', width: '30', height: '25', weight: '6.5' }]
      }
    });
  });

  it('selects the official address method and parameter shape for every level', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) =>
      Promise.resolve(response(method, { result: { values: [{ area_id: '330100', name: '杭州市' }] } }))
    );
    const adapter = new LogisticsAdapter({ call });

    await adapter.listAddressNodes({ level: 'province', countryCode: 'CN' });
    await adapter.listAddressNodes({ level: 'city', parentId: '330000' });
    await adapter.listAddressNodes({ level: 'division', parentId: '330100' });
    await adapter.listAddressNodes({ level: 'street', searchText: '仓前' });

    expect(call.mock.calls).toEqual([
      ['alibaba.onetouch.logistics.express.address.province.list', { param_query: { country_code: 'CN' } }],
      ['alibaba.onetouch.logistics.express.address.city.list', { param_query: { province_id: 330000 } }],
      [
        'alibaba.onetouch.logistics.express.address.division.list',
        { param_query: { city_id: 330100, with_children: false } }
      ],
      ['alibaba.onetouch.logistics.express.address.street.list', { param_query: { search_text: '仓前' } }]
    ]);
  });

  it('normalizes order paging and preserves a Base64 label separately from URLs', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) => {
      if (method.endsWith('order.list.query')) {
        return Promise.resolve(
          response(method, {
            result: {
              data: {
                total: 1,
                data_list: [
                  {
                    order_number: 'ALS00201756002',
                    order_status: 'created',
                    freight_amount: '109.20',
                    freight_currency: 'CNY'
                  }
                ]
              }
            }
          })
        );
      }
      return Promise.resolve(
        response(method, {
          result: {
            data: {
              order_number: 'ALS00201756002',
              order_status: 'created',
              freight_amount: '109.20',
              freight_currency: 'CNY',
              bar_code: 'JVBERi0xLjQK',
              tracking_number: 'TRACK-001'
            }
          }
        })
      );
    });
    const adapter = new LogisticsAdapter({ call });

    await expect(adapter.listOrders({ page: 2, pageSize: 25 })).resolves.toMatchObject({
      page: 2,
      pageSize: 25,
      total: 1,
      items: [{ orderNumber: 'ALS00201756002', freightAmount: '109.20' }]
    });
    await expect(adapter.getOrder('ALS00201756002')).resolves.toMatchObject({
      labelUrl: null,
      labelBase64: 'JVBERi0xLjQK',
      trackingNumber: 'TRACK-001'
    });
  });

  it('requires the confirmed product to match the latest quote before creating an order', async () => {
    const call = vi.fn<AlibabaClient['call']>();
    const adapter = new LogisticsAdapter({ call });

    await expect(
      adapter.createOrder({ quoteRequest: quoteRequest(), confirmedProductCode: 'ANOTHER_PRODUCT' })
    ).rejects.toThrow('确认的物流产品与最近试算产品不一致');
    expect(call).not.toHaveBeenCalled();
  });
});
