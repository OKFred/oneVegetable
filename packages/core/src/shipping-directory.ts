import type { ShippingMode } from './shipping-services';

export interface ShippingServiceEntry {
  id: string;
  name: string;
  websiteUrl: string;
  sourceUrl: string;
  modes: readonly ShippingMode[];
  kind: 'carrier' | 'marketplace';
  originCountries: readonly string[];
  coverage: 'documented-mainland-origin' | 'route-check-required';
  checkedOn: string;
  aliases?: readonly string[];
}

/** Discovery links only: country coverage is not a promise to carry a particular shipment. */
export const SHIPPING_SERVICE_DIRECTORY: readonly ShippingServiceEntry[] = [
  {
    id: 'sf',
    name: 'SF International',
    aliases: ['顺丰', '顺丰国际'],
    websiteUrl: 'https://www.sf-express.com/chn/sc/price-query',
    sourceUrl: 'https://www.sf-international.com/cn/sc/support/querySupport/dept',
    modes: ['express', 'parcel', 'air'],
    kind: 'carrier',
    originCountries: ['CN'],
    coverage: 'documented-mainland-origin',
    checkedOn: '2026-11-09'
  },
  {
    id: 'dhl',
    name: 'DHL Express',
    aliases: ['敦豪'],
    websiteUrl: 'https://www.dhl.com/cn-zh/home/get-a-quote.html',
    sourceUrl: 'https://www.dhl.com/cn-zh/home/express/shipping-and-tracking/shipping.html',
    modes: ['express'],
    kind: 'carrier',
    originCountries: ['CN'],
    coverage: 'documented-mainland-origin',
    checkedOn: '2026-11-09'
  },
  {
    id: 'ups',
    name: 'UPS',
    aliases: ['联合包裹'],
    websiteUrl: 'https://www.ups.com/cn/zh/shipping/quote',
    sourceUrl: 'https://www.ups.com/cn/zh/shipping/quote',
    modes: ['express'],
    kind: 'carrier',
    originCountries: ['CN'],
    coverage: 'documented-mainland-origin',
    checkedOn: '2026-11-09'
  },
  {
    id: 'fedex',
    name: 'FedEx',
    aliases: ['联邦快递'],
    websiteUrl: 'https://www.fedex.com/zh-cn/shipping/rates.html',
    sourceUrl: 'https://www.fedex.com/zh-cn/shipping.html',
    modes: ['express', 'air'],
    kind: 'carrier',
    originCountries: ['CN'],
    coverage: 'documented-mainland-origin',
    checkedOn: '2026-11-09'
  },
  {
    id: 'freightos',
    name: 'Freightos',
    websiteUrl: 'https://ship.freightos.com/',
    sourceUrl: 'https://www.freightos.com/shipping-routes/shipping-from-china-to-the-united-states/',
    modes: ['air', 'lcl', 'fcl'],
    kind: 'marketplace',
    originCountries: ['CN'],
    coverage: 'documented-mainland-origin',
    checkedOn: '2026-11-09'
  },
  {
    id: 'maersk',
    name: 'Maersk',
    aliases: ['马士基'],
    websiteUrl: 'https://www.maersk.com/prices-and-quotes',
    sourceUrl: 'https://www.maersk.com/prices-and-quotes',
    modes: ['air', 'lcl', 'fcl'],
    kind: 'carrier',
    originCountries: ['CN'],
    coverage: 'route-check-required',
    checkedOn: '2026-11-09'
  },
  {
    id: 'ups-forwarding',
    name: 'UPS Supply Chain Solutions',
    websiteUrl: 'https://www.ups.com/cn/zh/supplychain/tools',
    sourceUrl: 'https://www.ups.com/cn/zh/supplychain/home',
    modes: ['air', 'lcl', 'fcl'],
    kind: 'carrier',
    originCountries: ['CN'],
    coverage: 'route-check-required',
    checkedOn: '2026-11-09'
  }
];

export function filterChinaShippingServices(
  input: { mode?: ShippingMode; keyword?: string } = {}
): ShippingServiceEntry[] {
  const keyword = input.keyword?.trim().toLowerCase() ?? '';
  return SHIPPING_SERVICE_DIRECTORY.filter(
    (entry) =>
      entry.originCountries.includes('CN') &&
      (!input.mode || entry.modes.includes(input.mode)) &&
      (!keyword ||
        [entry.name, entry.id, ...(entry.aliases ?? [])].some((value) =>
          value.toLowerCase().includes(keyword)
        ))
  );
}
