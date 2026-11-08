import { browser } from 'wxt/browser';
import {
  checkShippingConsent,
  shippingServicesFail as fail
} from '@one-vegetable/core/shipping-services-protocol';
import type {
  ShippingServicesControl,
  ShippingServicesRequest,
  ShippingProviderConfigurationSummary,
  ShippingQuoteResult
} from '@one-vegetable/core/shipping-services';
import { SHIPPING_PERMISSION_ORIGINS, shippingRecord as record } from './shipping-services-protocol';

export const extensionShippingServices: ShippingServicesControl = {
  configuration(provider) {
    return call({ action: 'configuration', provider, requestId: crypto.randomUUID() });
  },
  saveConfiguration(input) {
    return call({ ...input, action: 'save', requestId: crypto.randomUUID() });
  },
  async clearConfiguration(provider, expectedRevision) {
    await call({ action: 'clear', provider, expectedRevision, requestId: crypto.randomUUID() });
  },
  quote(input) {
    return call({ ...input, action: 'quote' });
  }
};

function call(
  value: Extract<ShippingServicesRequest, { action: 'configuration' | 'save' }>
): Promise<ShippingProviderConfigurationSummary>;
function call(value: Extract<ShippingServicesRequest, { action: 'quote' }>): Promise<ShippingQuoteResult>;
function call(value: Extract<ShippingServicesRequest, { action: 'clear' }>): Promise<null>;
async function call(
  value: ShippingServicesRequest
): Promise<ShippingProviderConfigurationSummary | ShippingQuoteResult | null> {
  checkShippingConsent(value);
  if (value.action === 'save' || value.action === 'quote') {
    // Request directly in the click gesture, not after awaiting contains or on mount.
    try {
      if (!(await browser.permissions.request({ origins: [...SHIPPING_PERMISSION_ORIGINS] })))
        fail('SHIPPING_PERMISSION_REQUIRED');
    } catch {
      fail('SHIPPING_PERMISSION_REQUIRED');
    }
  }
  const { parseShippingServicesRequest, parseShippingConfigurationSummary, parseShippingQuoteResult } =
    await import('@one-vegetable/core/shipping-services');
  const request = parseShippingServicesRequest(value);
  let response: unknown;
  try {
    response = await browser.runtime.sendMessage({ kind: 'shipping-services-request', ...request });
  } catch {
    return fail('SHIPPING_RUNTIME_FAILED');
  }
  if (!record(response) || response.requestId !== request.requestId) return fail('SHIPPING_RESPONSE_INVALID');
  if (response.ok === false) {
    const code =
      record(response.error) &&
      typeof response.error.code === 'string' &&
      /^SHIPPING_[A-Z_]+$/u.test(response.error.code)
        ? response.error.code
        : 'SHIPPING_RUNTIME_FAILED';
    return fail(code);
  }
  if (response.ok !== true || !('data' in response)) return fail('SHIPPING_RESPONSE_INVALID');
  if (request.action === 'clear') {
    if (response.data !== null) fail('SHIPPING_RESPONSE_INVALID');
    return null;
  }
  if (request.action !== 'quote') return parseShippingConfigurationSummary(response.data);
  const result = parseShippingQuoteResult(response.data);
  if (result.requestId !== request.requestId) return fail('SHIPPING_RESPONSE_INVALID');
  return result;
}
