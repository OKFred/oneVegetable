import { listCapabilities } from './capability-registry';
import { PhotoAdapter } from './photo-adapter';
import { ProductAdapter } from './product-adapter';
import { TradeAdapter } from './trade-adapter';

import type { AlibabaClient } from './alibaba-client';
import type { DashboardSummary } from './types';

const PHOTO_PAGE_SIZE = 100;

export class DashboardAdapter {
  private readonly products: ProductAdapter;
  private readonly photos: PhotoAdapter;
  private readonly trades: TradeAdapter;

  constructor(client: Pick<AlibabaClient, 'call' | 'callWithFile'>) {
    this.products = new ProductAdapter(client);
    this.photos = new PhotoAdapter(client);
    this.trades = new TradeAdapter(client);
  }

  async get(): Promise<DashboardSummary> {
    const [products, photoCount, orders] = await Promise.allSettled([
      this.products.list({ page: 1, pageSize: 1, language: 'en_US' }),
      this.countPhotos(),
      this.trades.list({ page: 1, pageSize: 1 })
    ]);

    return {
      productCount: products.status === 'fulfilled' ? products.value.total : null,
      photoCount: photoCount.status === 'fulfilled' ? photoCount.value : null,
      orderCount: orders.status === 'fulfilled' ? orders.value.total : null,
      enabledCapabilityCount: listCapabilities().filter((item) => item.enabled).length
    };
  }

  private async countPhotos(): Promise<number | null> {
    const result = await this.photos.list({ page: 1, pageSize: PHOTO_PAGE_SIZE });
    if (result.total > result.items.length) return result.total;
    return result.items.length < PHOTO_PAGE_SIZE ? result.items.length : null;
  }
}
