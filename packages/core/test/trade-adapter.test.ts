import { describe, expect, it, vi } from 'vitest';

import type { AlibabaClient } from '../src/alibaba-client';
import { TradeAdapter } from '../src/trade-adapter';

function response(method: string, body: Record<string, unknown>) {
  return {
    method,
    data: { [`${method.replaceAll('.', '_')}_response`]: body }
  };
}

describe('TradeAdapter', () => {
  it('maps one-based UI pagination to the documented zero-based order query', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) =>
      Promise.resolve(
        response(method, {
          result: {
            value: {
              total_count: 1,
              order_list: [
                {
                  trade_id: '24668306501026709',
                  buyer_login_id: 'buyer-login',
                  status: 'paid',
                  total_amount: { amount: '1200.50', currency: 'USD' },
                  create_date: { timestamp: 1_786_400_000_000 },
                  modify_date: { timestamp: 1_786_500_000_000 }
                }
              ]
            }
          }
        })
      )
    );
    const adapter = new TradeAdapter({ call });

    const page = await adapter.list({
      page: 3,
      pageSize: 50,
      status: 'paid',
      buyerLoginId: 'buyer-login',
      createDateStart: '2026-08-01 00:00:00'
    });

    expect(page).toMatchObject({ page: 3, pageSize: 50, total: 1, documentTimeZoneUnverified: true });
    expect(page.items[0]).toMatchObject({
      id: '24668306501026709',
      buyerLoginId: 'buyer-login',
      amount: '1200.50',
      currency: 'USD'
    });
    expect(call).toHaveBeenCalledWith('alibaba.seller.order.list', {
      param_trade_ecology_order_list_query: {
        role: 'seller',
        start_page: 2,
        page_size: 50,
        status: 'paid',
        other_login_id: 'buyer-login',
        create_date_start: { date_str: '2026-08-01 00:00:00' }
      }
    });
  });

  it('aggregates settled fund decimals and tolerates an unavailable logistics request', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) => {
      if (method === 'alibaba.seller.order.logistics.get') {
        return Promise.reject(new Error('permission denied'));
      }
      return Promise.resolve(
        response(method, {
          value: {
            fund_pay_list: [
              {
                pay_status: 'PAID',
                receive_amount: { amount: '0.1', currency: 'USD' }
              },
              {
                pay_status: 'CAPTURED',
                pay_amount: { amount: '0.2', currency: 'USD' }
              },
              {
                pay_status: 'UNPAY',
                pay_amount: { amount: '99', currency: 'USD' }
              }
            ]
          }
        })
      );
    });
    const adapter = new TradeAdapter({ call });
    const order = {
      id: 'ORDER-1',
      buyerLoginId: 'buyer',
      status: 'paid',
      amount: '0.3',
      currency: 'USD',
      createdAt: null,
      modifiedAt: null
    } as const;

    const aggregate = await adapter.getAggregate(order);

    expect(aggregate.fund).toMatchObject({ orderId: 'ORDER-1', paidAmount: '0.3' });
    expect(aggregate.logistics).toBeNull();
    expect(aggregate.availability).toEqual({
      order: 'available',
      fund: 'available',
      logistics: 'unavailable',
      fullDetail: 'jushita-only'
    });
  });

  it('normalizes fulfillment, service charge and TT account responses', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) => {
      if (method === 'alibaba.trade.fulfillment.channel.get') {
        return Promise.resolve(
          response(method, {
            result: {
              value: {
                support_fulfillment_channels: [
                  { name: 'TAO', enable: true },
                  { name: 'TAD', enable: false, message: 'not eligible' }
                ]
              }
            }
          })
        );
      }
      if (method === 'alibaba.trade.service.charge.get') {
        return Promise.resolve(
          response(method, {
            result: {
              servcecharge_list: [
                {
                  ratio: '0.01',
                  max_fee: '100',
                  export_service_type: 'onetouch_service',
                  logistics_type: 'useCaiNiaoLogistics'
                }
              ]
            }
          })
        );
      }
      return Promise.resolve(
        response(method, {
          value: {
            pay_amount: { amount: '2450.50', currency: 'USD' },
            default_tt_account: {
              beneficiary_name: 'Alibaba',
              beneficiary_account_no: '1029200038060',
              beneficiary_bank: 'Citibank'
            },
            guide_content: 'Include the order number.'
          }
        })
      );
    });
    const adapter = new TradeAdapter({ call });

    await expect(adapter.listFulfillmentChannels()).resolves.toEqual([
      { code: 'TAO', name: 'TAO', enabled: true, unavailableReason: null },
      { code: 'TAD', name: 'TAD', enabled: false, unavailableReason: 'not eligible' }
    ]);
    await expect(adapter.getServiceCharge('USD')).resolves.toEqual({
      currency: 'USD',
      items: [
        {
          ratio: '0.01',
          maxFee: '100',
          exportServiceType: 'onetouch_service',
          logisticsType: 'useCaiNiaoLogistics'
        }
      ]
    });
    await expect(adapter.getTtAccount('ORDER-1')).resolves.toMatchObject({
      orderId: 'ORDER-1',
      payableAmount: '2450.50',
      accountNumber: '1029200038060'
    });
  });

  it('turns the official address form into declarative fields and flattens address values', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) => {
      if (method === 'alibaba.trade.address.schema.query') {
        return Promise.resolve(
          response(method, {
            forms: [
              {
                country_code: 'US',
                form_fields: [
                  {
                    field_key: 'contact.mobileNo',
                    field_label: 'Phone number',
                    fill_type: 'input',
                    order: 20,
                    rule: {
                      require_not_null: true,
                      reg_exps: [{ reg_exp: '^\\+?[0-9]+$' }]
                    }
                  }
                ]
              }
            ]
          })
        );
      }
      return Promise.resolve(
        response(method, {
          value: [
            {
              address_id: 120384173001,
              contact_person: 'Alex Morgan',
              contact: { phone_code: '+1', mobile_no: '3534534251' },
              address: { country: { code: 'US' }, city: { name: 'Seattle' } }
            }
          ]
        })
      );
    });
    const adapter = new TradeAdapter({ call });

    const schema = await adapter.getAddressSchema('US');
    const addresses = await adapter.listAddresses('buyer@example.com');

    expect(schema.fields[0]).toMatchObject({
      id: 'contact.mobileNo',
      required: true,
      pattern: '^\\+?[0-9]+$'
    });
    expect(addresses[0]).toMatchObject({
      id: '120384173001',
      label: 'Alex Morgan',
      values: {
        'contact.mobile_no': '3534534251',
        'address.country.code': 'US',
        'address.city.name': 'Seattle'
      }
    });
  });
});
