export const EXTENSION_SHIPPING_SERVICES_STORAGE_KEY = 'one-vegetable-shipping-services-v1';
export const SHIPPING_PERMISSION_ORIGINS = [`${SHIPPING_PROVIDER_ORIGINS.freightos}/*`];

export type ShippingServicesResponse =
  | { requestId: string; ok: true; data: unknown }
  | { requestId: string; ok: false; error: { code: string; message: string; retryable: false } };

export const shippingRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
import { SHIPPING_PROVIDER_ORIGINS } from '@one-vegetable/core/shipping-services-protocol';
