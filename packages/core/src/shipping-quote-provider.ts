import { NetworkManager } from './network';
import type { NetworkTransport } from './network';
import {
  parseShippingServicesRequest,
  parseShippingQuoteResult,
  safeShippingSearchUrl,
  shippingCountryName,
  shippingServicesFail
} from './shipping-services';
import type {
  ShippingLocation,
  ShippingQuoteOption,
  ShippingQuoteRequest,
  ShippingQuoteResult
} from './shipping-services';

const ENDPOINT = 'https://ship.freightos.com/api/rate-estimate/v1/search';
const MODES = { air: 'air', lcl: 'LCL', fcl: 'FCL' } as const;

export function freightosQuotePayload(input: ShippingQuoteRequest): Record<string, unknown> {
  const request = parseShippingServicesRequest({ ...input, action: 'quote' });
  if (request.action !== 'quote') return shippingServicesFail('SHIPPING_REQUEST_INVALID');
  const shipment = request.shipment;
  const container = shipment.packaging.startsWith('container');
  const point = (value: ShippingLocation) => ({
    type: 'address',
    countryCode: value.countryCode,
    countryName: shippingCountryName(value.countryCode),
    city: value.city.trim(),
    ...(value.postalCode.trim() ? { postalCode: value.postalCode.trim() } : {}),
    ...(value.state.trim() ? { stateOrProvince: value.state.trim() } : {})
  });
  return {
    shipment: {
      origin: point(shipment.origin),
      destination: point(shipment.destination),
      direction: 'Export',
      transportMode: MODES[shipment.mode as keyof typeof MODES],
      ...(shipment.pickupDate ? { pickupDate: shipment.pickupDate } : {}),
      load: {
        packages: [
          {
            packagingType: shipment.packaging,
            quantity: shipment.quantity,
            ...(shipment.weightKg > 0 ? { weight: { value: shipment.weightKg, unit: 'kg' } } : {}),
            ...(!container
              ? {
                  dimensions: {
                    length: { value: shipment.lengthCm, unit: 'cm' },
                    width: { value: shipment.widthCm, unit: 'cm' },
                    height: { value: shipment.heightCm, unit: 'cm' }
                  }
                }
              : {})
          }
        ],
        ...(shipment.declaredValue > 0
          ? { declaredValue: { value: shipment.declaredValue, currency: shipment.currency } }
          : {})
      }
    },
    pricePreference: {
      currency: shipment.currency,
      includeOriginPortCharges: true,
      includeDestinationPortCharges: true
    }
  };
}

export async function requestShippingQuote(
  input: ShippingQuoteRequest,
  apiKey: string,
  transport?: NetworkTransport
): Promise<ShippingQuoteResult> {
  const payload = freightosQuotePayload(input);
  // The provider accepts only a header key; never attach keys or shipment data to a URL.
  if (apiKey.length < 8 || apiKey.length > 2048 || /\s|\p{Cc}/u.test(apiKey))
    shippingServicesFail('SHIPPING_CREDENTIAL_INVALID');
  const network = new NetworkManager({
    ...(transport ? { transport } : {}),
    policies: {
      'shipping-quote': {
        allowedOrigins: ['https://ship.freightos.com'],
        allowUrl: (url) => url.href === ENDPOINT,
        timeoutMilliseconds: 20_000,
        maxRequestBytes: 65_536,
        maxResponseBytes: 524_288,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error'
      }
    }
  });
  let response;
  try {
    response = await network.request({
      service: 'shipping-quote',
      url: ENDPOINT,
      method: 'POST',
      requestId: input.requestId,
      headers: { apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      maxAttempts: 1
    });
  } catch {
    // A sent quote may consume quota even if its reply never arrives.
    return shippingServicesFail('SHIPPING_QUOTE_OUTCOME_UNKNOWN');
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      shippingServicesFail('SHIPPING_PROVIDER_AUTH_REQUIRED');
    if (response.status === 429) shippingServicesFail('SHIPPING_PROVIDER_RATE_LIMIT');
    if (response.status >= 400 && response.status < 500) shippingServicesFail('SHIPPING_QUOTE_REJECTED');
    shippingServicesFail('SHIPPING_QUOTE_PROVIDER_UNAVAILABLE');
  }
  return parseFreightosQuote(response.data, input);
}

export function parseFreightosQuote(value: unknown, request: ShippingQuoteRequest): ShippingQuoteResult {
  if (
    !record(value) ||
    typeof value.requestId !== 'string' ||
    !value.requestId ||
    value.requestId.length > 128 ||
    !record(value.origin) ||
    !record(value.destination) ||
    !record(value.load) ||
    (value.modes !== undefined && (!Array.isArray(value.modes) || value.modes.length > 30))
  )
    shippingServicesFail('SHIPPING_QUOTE_RESPONSE_INVALID');
  for (const [echo, expected] of [
    [value.origin, request.shipment.origin],
    [value.destination, request.shipment.destination]
  ] as const) {
    if ('countryCode' in echo && echo.countryCode !== expected.countryCode)
      shippingServicesFail('SHIPPING_QUOTE_RESPONSE_INVALID');
  }
  const options: ShippingQuoteOption[] = [];
  const selected = MODES[request.shipment.mode as keyof typeof MODES];
  for (const [index, mode] of (value.modes ?? []).entries()) {
    if (!record(mode) || typeof mode.mode !== 'string' || !/^[a-zA-Z]{1,24}$/.test(mode.mode))
      shippingServicesFail('SHIPPING_QUOTE_RESPONSE_INVALID');
    if (mode.mode.toLowerCase() !== selected.toLowerCase()) continue;
    let amount: string | null = null;
    let currency: string | null = null;
    if (mode.averagePrice !== undefined) {
      if (
        !record(mode.averagePrice) ||
        typeof mode.averagePrice.value !== 'number' ||
        !Number.isFinite(mode.averagePrice.value) ||
        mode.averagePrice.value < 0 ||
        typeof mode.averagePrice.currency !== 'string' ||
        !/^[A-Z]{3}$/.test(mode.averagePrice.currency)
      )
        shippingServicesFail('SHIPPING_QUOTE_RESPONSE_INVALID');
      amount = String(mode.averagePrice.value);
      if (!/^[0-9]+(\.[0-9]+)?$/.test(amount)) shippingServicesFail('SHIPPING_QUOTE_RESPONSE_INVALID');
      currency = mode.averagePrice.currency;
    }
    let transitDaysFrom: number | null = null;
    let transitDaysTo: number | null = null;
    if (mode.averageTransitTime !== undefined) {
      const time = mode.averageTransitTime;
      if (
        !record(time) ||
        time.unit !== 'days' ||
        typeof time.from !== 'number' ||
        typeof time.to !== 'number' ||
        !Number.isFinite(time.from) ||
        !Number.isFinite(time.to) ||
        time.from < 0 ||
        time.to < time.from ||
        time.to > 10_000
      )
        shippingServicesFail('SHIPPING_QUOTE_RESPONSE_INVALID');
      transitDaysFrom = time.from;
      transitDaysTo = time.to;
    }
    options.push({
      id: 'freightos-' + String(index),
      provider: 'freightos',
      kind: 'market-estimate',
      serviceName: 'Freightos',
      mode: mode.mode,
      amount,
      currency,
      transitDaysFrom,
      transitDaysTo
    });
  }
  return parseShippingQuoteResult({
    requestId: request.requestId,
    provider: 'freightos',
    quotedAtUtc: Date.now(),
    options,
    searchUrl: safeShippingSearchUrl(value.searchUrl)
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
