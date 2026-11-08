import type { ShippingServicesRequest } from '@one-vegetable/core/shipping-services';

export const SHIPPING_TEST_API_KEY = 'fixture-only-not-a-real-provider-key';
export const SHIPPING_TEST_ENCRYPTION_KEY = btoa(String.fromCharCode(7).repeat(32))
  .replaceAll('+', '-')
  .replaceAll('/', '_')
  .replace(/=+$/u, '');

export function shippingSave(expectedRevision: number | null = null): ShippingServicesRequest {
  return {
    action: 'save',
    requestId: crypto.randomUUID(),
    provider: 'freightos',
    apiKey: SHIPPING_TEST_API_KEY,
    expectedRevision,
    termsAccepted: true,
    costAcknowledged: true
  };
}

export function shippingQuote(): Extract<ShippingServicesRequest, { action: 'quote' }> {
  return {
    action: 'quote',
    requestId: crypto.randomUUID(),
    provider: 'freightos',
    expectedRevision: 1,
    consent: { dataSharing: true, costAcknowledged: true },
    shipment: {
      origin: { countryCode: 'CN', city: 'Shenzhen', postalCode: '518000', state: 'Guangdong' },
      destination: { countryCode: 'US', city: 'Los Angeles', postalCode: '90001', state: 'CA' },
      mode: 'air',
      packaging: 'boxes',
      quantity: 1,
      weightKg: 20,
      lengthCm: 50,
      widthCm: 40,
      heightCm: 30,
      description: 'Fixture shipment',
      hsCode: '',
      declaredValue: 100,
      currency: 'USD',
      pickupDate: ''
    }
  };
}
