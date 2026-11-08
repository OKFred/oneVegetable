export const SHIPPING_PROVIDER_ORIGINS = { freightos: 'https://ship.freightos.com' } as const;

export class ShippingServicesError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function shippingServicesFail(code: string): never {
  throw new ShippingServicesError(code);
}

/** Cheap consent checks stay synchronous so Chrome can request permission in the click gesture. */
export function checkShippingConsent(request: {
  provider: string;
  action: string;
  termsAccepted?: boolean;
  costAcknowledged?: boolean;
  consent?: { dataSharing: boolean; costAcknowledged: boolean };
}): void {
  if (request.provider !== 'freightos') shippingServicesFail('SHIPPING_REQUEST_INVALID');
  if (
    (request.action === 'save' && (!request.termsAccepted || !request.costAcknowledged)) ||
    (request.action === 'quote' && (!request.consent?.dataSharing || !request.consent.costAcknowledged))
  )
    shippingServicesFail('SHIPPING_CONSENT_REQUIRED');
}
