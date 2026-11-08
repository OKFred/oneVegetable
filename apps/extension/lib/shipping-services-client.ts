import { browser } from 'wxt/browser';
import {
  parseShippingServicesRequest,
  parseShippingConfigurationSummary,
  parseShippingQuoteResult,
  shippingServicesFail as fail,
  type ShippingServicesControl,
  type ShippingServicesRequest
} from '@one-vegetable/core/shipping-services';
import { SHIPPING_PERMISSION_ORIGINS, shippingRecord as record } from './shipping-services-protocol';

export const extensionShippingServices: ShippingServicesControl = {
  async configuration(provider) {
    const data = await call({ action: 'configuration', provider, requestId: crypto.randomUUID() });
    return parseShippingConfigurationSummary(data);
  },
  async saveConfiguration(input) {
    const data = await call({ ...input, action: 'save', requestId: crypto.randomUUID() });
    return parseShippingConfigurationSummary(data);
  },
  async clearConfiguration(provider, expectedRevision) {
    const data = await call({ action: 'clear', provider, expectedRevision, requestId: crypto.randomUUID() });
    if (data !== null) fail('SHIPPING_RESPONSE_INVALID');
  },
  async quote(input) {
    const data = await call({ ...input, action: 'quote' });
    const result = parseShippingQuoteResult(data);
    if (result.requestId !== input.requestId) return fail('SHIPPING_RESPONSE_INVALID');
    return result;
  }
};

async function call(value: ShippingServicesRequest): Promise<unknown> {
  const request = parseShippingServicesRequest(value);
  if (request.action === 'save' || request.action === 'quote') {
    // Request directly in the click gesture, not after awaiting contains or on mount.
    try {
      if (!(await browser.permissions.request({ origins: [...SHIPPING_PERMISSION_ORIGINS] })))
        fail('SHIPPING_PERMISSION_REQUIRED');
    } catch {
      fail('SHIPPING_PERMISSION_REQUIRED');
    }
  }
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
  return response.data;
}
