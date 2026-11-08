import type {
  ShippingProviderConfigurationInput,
  ShippingQuoteRequest,
  ShippingQuoteResult
} from '@one-vegetable/core/shipping-services';

export const shippingConfiguration: ShippingProviderConfigurationInput = {
  provider: 'freightos',
  apiKey: 'fixture-freightos-key-not-live',
  expectedRevision: null,
  termsAccepted: true,
  costAcknowledged: true
};

export function shippingQuote(): ShippingQuoteRequest {
  return {
    requestId: crypto.randomUUID(),
    provider: 'freightos',
    expectedRevision: 1,
    consent: { dataSharing: true, costAcknowledged: true },
    shipment: {
      origin: { countryCode: 'CN', city: 'Shenzhen-private-fixture', postalCode: '518000', state: '' },
      destination: {
        countryCode: 'US',
        city: 'Los-Angeles-private-fixture',
        postalCode: '90001',
        state: 'CA'
      },
      mode: 'air',
      packaging: 'boxes',
      quantity: 1,
      weightKg: 10,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
      description: '',
      hsCode: '',
      declaredValue: 0,
      currency: 'USD',
      pickupDate: ''
    }
  };
}

export const freightosResponse = {
  requestId: 'fixture-upstream-id',
  origin: { countryCode: 'CN' },
  destination: { countryCode: 'US' },
  load: {},
  modes: [{ mode: 'air', averagePrice: { value: 123.45, currency: 'USD' } }],
  searchUrl: 'https://ship.freightos.com/results/fixture',
  rawPrivateField: 'fixture-raw-provider-value'
};

export function shippingQuoteResult(requestId: string): ShippingQuoteResult {
  return {
    requestId,
    provider: 'freightos',
    quotedAtUtc: Date.now(),
    options: [
      {
        id: 'freightos-0',
        provider: 'freightos',
        kind: 'market-estimate',
        serviceName: 'Freightos',
        mode: 'air',
        amount: '123.45',
        currency: 'USD',
        transitDaysFrom: null,
        transitDaysTo: null
      }
    ],
    searchUrl: freightosResponse.searchUrl
  };
}
