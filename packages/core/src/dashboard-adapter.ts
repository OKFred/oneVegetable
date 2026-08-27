import { listCapabilities } from './capability-registry';
import { GatewayException, normalizeGatewayError } from './errors';
import { PhotoAdapter } from './photo-adapter';
import { ProductAdapter } from './product-adapter';
import { TradeAdapter } from './trade-adapter';

import type { AlibabaClient } from './alibaba-client';
import type { DashboardMetricStatus, DashboardSummary } from './types';

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
    const productMetric = metricFromSettled(products, (value) => value.total);
    const photoMetric = metricFromSettled(photoCount, (value) => value, 'TOTAL_NOT_PROVIDED');
    const orderMetric = metricFromSettled(orders, (value) => value.total);

    return {
      productCount: productMetric.value,
      photoCount: photoMetric.value,
      orderCount: orderMetric.value,
      enabledCapabilityCount: listCapabilities().filter((item) => item.enabled).length,
      metricStatuses: {
        productCount: productMetric.status,
        photoCount: photoMetric.status,
        orderCount: orderMetric.status,
        enabledCapabilityCount: availableStatus('catalog')
      }
    };
  }

  private async countPhotos(): Promise<number | null> {
    const result = await this.photos.list({ page: 1, pageSize: PHOTO_PAGE_SIZE });
    if (result.total > result.items.length) return result.total;
    return result.items.length < PHOTO_PAGE_SIZE ? result.items.length : null;
  }
}

interface DashboardMetricResult {
  value: number | null;
  status: DashboardMetricStatus;
}

function metricFromSettled<T>(
  result: PromiseSettledResult<T>,
  readValue: (value: T) => number | null,
  unknownReasonCode = 'VALUE_NOT_PROVIDED'
): DashboardMetricResult {
  if (result.status === 'rejected') {
    return { value: null, status: errorStatus(result.reason) };
  }
  const value = readValue(result.value);
  return value === null
    ? {
        value: null,
        status: { state: 'unknown', source: 'gateway', reasonCode: unknownReasonCode }
      }
    : { value, status: availableStatus('gateway') };
}

function availableStatus(source: DashboardMetricStatus['source']): DashboardMetricStatus {
  return { state: 'available', source, reasonCode: null };
}

function errorStatus(reason: unknown): DashboardMetricStatus {
  const error = reason instanceof GatewayException ? reason.gatewayError : normalizeGatewayError(reason);
  const reasonCode = error.subCode ?? error.code;
  const permissionMarker = `${error.code} ${error.subCode ?? ''}`.toLowerCase();
  const permissionDenied =
    error.code === 'PERMISSION_DENIED' ||
    error.code === '11' ||
    permissionMarker.includes('permission') ||
    permissionMarker.includes('access-denied');
  return {
    state: permissionDenied ? 'permission-denied' : 'error',
    source: 'gateway',
    reasonCode: reasonCode.slice(0, 160)
  };
}
