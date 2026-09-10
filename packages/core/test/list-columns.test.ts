import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AlibabaClient } from '../src/alibaba-client';
import { ProductAdapter } from '../src/product-adapter';
import { PhotoAdapter } from '../src/photo-adapter';
import { TradeAdapter } from '../src/trade-adapter';
const fixture = JSON.parse(
  readFileSync(new URL('../../../mock/data/list-columns.json', import.meta.url), 'utf8')
) as Record<'product' | 'photo' | 'order', Record<string, unknown>>;
function client(body: Record<string, unknown>) {
  return {
    call: vi.fn<AlibabaClient['call']>((method) => Promise.resolve({ method, data: body })),
    callWithFile: vi.fn<AlibabaClient['callWithFile']>(() =>
      Promise.reject(new Error('Unexpected file upload'))
    )
  };
}
describe('list column fields', () => {
  it('preserves documented product fields including false and wrapped arrays', async () => {
    const page = await new ProductAdapter(client({ products: [fixture.product] })).list({
      page: 1,
      pageSize: 20,
      language: 'en_US'
    });
    expect(page.items[0]).toMatchObject({
      groupId: 7,
      keywords: ['shirt', 'cotton'],
      imageCount: 1,
      watermark: false,
      isRts: false,
      isSpecific: true,
      smartEdit: false,
      model: 'SH-1',
      platformStatus: 'approved',
      createdAt: '2026-09-10T02:00:00.000Z'
    });
  });
  it('does not turn missing fields or invalid creation dates into values', async () => {
    const page = await new ProductAdapter(client({ products: [{ id: 1, gmt_create: 'invalid' }] })).list({
      page: 1,
      pageSize: 20,
      language: 'en_US'
    });
    expect(page.items[0]).toMatchObject({
      groupId: null,
      keywords: null,
      imageCount: null,
      createdAt: null,
      isRts: null
    });
  });
  it('preserves photo owner and original filename without claiming dimensions', async () => {
    const page = await new PhotoAdapter(
      client({ pagination_query_list: { list: [fixture.photo], total: 1 } })
    ).list({ page: 1, pageSize: 20 });
    expect(page.items[0]).toMatchObject({
      originalName: 'original.jpg',
      ownerName: 'Sample owner',
      width: null,
      height: null
    });
  });
  it('does not invent zero-dollar order totals', async () => {
    const page = await new TradeAdapter(
      client({ result: { value: { order_list: [fixture.order], total_count: 1 } } })
    ).list({ page: 1, pageSize: 20 });
    expect(page.items[0]).toMatchObject({ amount: null, currency: null, buyerLoginId: null });
  });
});
