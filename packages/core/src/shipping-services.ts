import type { components } from './generated/api';
import {
  validateShippingServicesRequest,
  validateShippingProviderConfigurationSummary,
  validateShippingQuoteResult
} from './generated/validators-shipping-services';
import { isRequestId } from './network';
import {
  SHIPPING_PROVIDER_ORIGINS,
  checkShippingConsent,
  shippingServicesFail
} from './shipping-services-protocol';
export {
  SHIPPING_PROVIDER_ORIGINS,
  ShippingServicesError,
  shippingServicesFail
} from './shipping-services-protocol';

export type ShippingProviderId = components['schemas']['ShippingProviderId'];
export type ShippingLocation = components['schemas']['ShippingLocation'];
export type ShippingShipment = components['schemas']['ShippingShipment'];
export type ShippingMode = ShippingShipment['mode'];
export type ShippingProviderConfigurationSummary =
  components['schemas']['ShippingProviderConfigurationSummary'];
export type ShippingProviderConfigurationInput = components['schemas']['ShippingProviderConfigurationInput'];
export type ShippingQuoteRequest = components['schemas']['ShippingQuoteRequest'];
export type ShippingQuoteOption = components['schemas']['ShippingQuoteOption'];
export type ShippingQuoteResult = components['schemas']['ShippingQuoteResult'];
export type ShippingServicesRequest = components['schemas']['ShippingServicesRequest'];

export interface ShippingServicesControl {
  configuration(provider: ShippingProviderId): Promise<ShippingProviderConfigurationSummary>;
  saveConfiguration(input: ShippingProviderConfigurationInput): Promise<ShippingProviderConfigurationSummary>;
  clearConfiguration(provider: ShippingProviderId, expectedRevision: number): Promise<void>;
  quote(input: ShippingQuoteRequest): Promise<ShippingQuoteResult>;
}

export function parseShippingServicesRequest(value: unknown): ShippingServicesRequest {
  if (!validateShippingServicesRequest(value)) shippingServicesFail('SHIPPING_REQUEST_INVALID');
  const request = value as ShippingServicesRequest;
  checkShippingConsent(request);
  if (!isRequestId(request.requestId)) shippingServicesFail('INVALID_REQUEST_ID');
  if (
    'expectedRevision' in request &&
    request.expectedRevision !== null &&
    (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision >= Number.MAX_SAFE_INTEGER)
  )
    shippingServicesFail('SHIPPING_REQUEST_INVALID');
  if (request.action === 'save') {
    const apiKey = request.apiKey.trim();
    if (apiKey.length < 8 || /\s|\p{Cc}/u.test(apiKey)) shippingServicesFail('SHIPPING_CREDENTIAL_INVALID');
    return { ...request, apiKey };
  }
  if (request.action === 'quote') {
    const shipment = request.shipment;
    if (shipment.origin.countryCode !== 'CN') shippingServicesFail('SHIPPING_MAINLAND_ORIGIN_REQUIRED');
    if (shipment.destination.countryCode === 'CN')
      shippingServicesFail('SHIPPING_EXPORT_DESTINATION_REQUIRED');
    if (!['air', 'lcl', 'fcl'].includes(shipment.mode)) shippingServicesFail('SHIPPING_MODE_UNAVAILABLE');
    const container = shipment.packaging.startsWith('container');
    if ((shipment.mode === 'fcl') !== container) shippingServicesFail('SHIPPING_PACKAGING_INVALID');
    const dimensions = [shipment.lengthCm, shipment.widthCm, shipment.heightCm];
    if (
      container ? dimensions.some((v) => v !== 0) : shipment.weightKg <= 0 || dimensions.some((v) => v <= 0)
    )
      shippingServicesFail('SHIPPING_PACKAGING_INVALID');
    for (const location of [shipment.origin, shipment.destination]) {
      if (!location.city.trim() || /\p{Cc}/u.test(location.city + location.state + location.postalCode))
        shippingServicesFail('SHIPPING_REQUEST_INVALID');
      shippingCountryName(location.countryCode);
    }
    if (shipment.pickupDate) {
      const date = new Date(shipment.pickupDate + 'T00:00:00Z');
      if (
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== shipment.pickupDate ||
        shipment.pickupDate < new Date().toISOString().slice(0, 10)
      )
        shippingServicesFail('SHIPPING_PICKUP_DATE_INVALID');
    }
  }
  return request;
}

export function shippingCountryName(code: string): string {
  const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
  if (!name || name === code || code === 'ZZ') shippingServicesFail('SHIPPING_REQUEST_INVALID');
  return name;
}

export function parseShippingConfigurationSummary(value: unknown): ShippingProviderConfigurationSummary {
  if (!validateShippingProviderConfigurationSummary(value)) shippingServicesFail('SHIPPING_RESPONSE_INVALID');
  const summary = value as ShippingProviderConfigurationSummary;
  if (
    (summary.configured && (summary.revision === null || summary.updatedAtUtc === null)) ||
    (summary.revision === null) !== (summary.updatedAtUtc === null)
  )
    shippingServicesFail('SHIPPING_RESPONSE_INVALID');
  return summary;
}

export function parseShippingQuoteResult(value: unknown): ShippingQuoteResult {
  if (!validateShippingQuoteResult(value)) shippingServicesFail('SHIPPING_QUOTE_RESPONSE_INVALID');
  const result = value as ShippingQuoteResult;
  if (
    !isRequestId(result.requestId) ||
    (result.searchUrl !== null && !safeShippingSearchUrl(result.searchUrl))
  )
    shippingServicesFail('SHIPPING_QUOTE_RESPONSE_INVALID');
  return result;
}

export function safeShippingSearchUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.origin === SHIPPING_PROVIDER_ORIGINS.freightos &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith('/results/') &&
      !url.hash
      ? url.href
      : null;
  } catch {
    return null;
  }
}
