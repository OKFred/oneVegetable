import { describe, expect, it, vi } from 'vitest';

import type { AlibabaClient } from '../src/alibaba-client';
import { RfqAdapter } from '../src/rfq-adapter';

function response(method: string, body: Record<string, unknown>) {
  return {
    method,
    data: { [`${method.replaceAll('.', '_')}_response`]: body }
  };
}

describe('RfqAdapter', () => {
  it('normalizes search and recommendation response shapes', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) => {
      if (method === 'alibaba.icbu.rfq.search') {
        return Promise.resolve(
          response(method, {
            result: {
              result: {
                total: 1,
                request_list: [
                  {
                    unique_rfq_id: 'RFQ-SEARCH-1',
                    subject: 'Solar station',
                    quantity: 50,
                    open_time: 1_786_400_000_000,
                    expirate_time: 1_787_000_000_000
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
            value: {
              pagination: { total_item: 1 },
              rfq_list: [{ rfq_id: 'RFQ-RECOMMEND-1', subject: 'Canvas bags', has_read: true }]
            }
          }
        })
      );
    });
    const adapter = new RfqAdapter({ call });

    const searched = await adapter.list({ page: 2, pageSize: 10, keywords: 'solar' });
    const recommended = await adapter.listRecommended({ page: 1, pageSize: 5 });

    expect(searched).toMatchObject({ total: 1, source: 'search' });
    expect(searched.items[0]).toMatchObject({ id: 'RFQ-SEARCH-1', quantity: 50 });
    expect(recommended.items[0]).toMatchObject({ id: 'RFQ-RECOMMEND-1', recommended: true });
  });

  it('normalizes detail, equity and JSON-string read status', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) => {
      if (method === 'alibaba.icbu.rfqdetail.get') {
        return Promise.resolve(
          response(method, {
            result: {
              result: {
                attachments: [{ file_name: 'spec.pdf', file_url: '//example.com/spec.pdf' }],
                rfq_detail_dto: {
                  rfq_id: 'RFQ-1',
                  subject: 'RFQ detail',
                  payment_terms: 'T/T',
                  destination_port: 'Hamburg'
                }
              }
            }
          })
        );
      }
      if (method === 'alibaba.icbu.rfq.myequity') {
        return Promise.resolve(
          response(method, {
            service_result: {
              value: { equity_count: 8, top_service_count: 2, score: 91, beat_supplier_percent: '80%' }
            }
          })
        );
      }
      return Promise.resolve(response(method, { result: { value: '{"RFQ-1":"true","RFQ-2":"false"}' } }));
    });
    const adapter = new RfqAdapter({ call });

    const detail = await adapter.get('RFQ-1');
    const equity = await adapter.getEquity();
    const read = await adapter.getReadStatus(['RFQ-1', 'RFQ-2']);

    expect(detail.attachments[0]).toEqual({ name: 'spec.pdf', url: 'https://example.com/spec.pdf' });
    expect(equity).toMatchObject({ remainingQuotes: 8, remainingTopQuotes: 2, score: 91 });
    expect(read.statuses).toEqual({ 'RFQ-1': true, 'RFQ-2': false });
  });

  it('maps attachment upload and quotation DTOs without leaking page concerns', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) => {
      if (method === 'alibaba.icbu.annex.upload') {
        return Promise.resolve(response(method, { result: 'fileId:0|fileSavePath:quote.pdf|fileFlag:add' }));
      }
      return Promise.resolve(response(method, { result: { success: true, result: { id: 9001 } } }));
    });
    const adapter = new RfqAdapter({ call });

    const attachment = await adapter.uploadAttachment({
      fileName: 'quote.pdf',
      contentBase64: 'JVBERg==',
      contentType: 'application/pdf',
      byteLength: 4
    });
    const quotation = await adapter.submitQuotation({
      rfqId: 'RFQ-1',
      message: 'We can supply this item.',
      paymentTerms: 'T/T',
      expiresAt: '2026-08-31 00:00:00',
      prices: [
        {
          itemName: 'Solar station',
          unitPrice: '599',
          currency: 'USD',
          quantity: '50',
          quantityUnit: 'Pieces',
          shippingTerms: 'FOB',
          port: 'Shenzhen',
          remark: ''
        }
      ]
    });

    expect(attachment.filesString).toContain('quote.pdf');
    expect(quotation).toEqual({ quotationId: '9001', success: true });
    const lastCall = call.mock.lastCall;
    const parameters = lastCall?.[1];
    const dto = parameters?.dto;
    expect(lastCall?.[0]).toBe('alibaba.icbu.quotation.post');
    expect(typeof dto === 'object' && dto !== null && 'rfq_id' in dto ? dto.rfq_id : null).toBe('RFQ-1');
  });
});
