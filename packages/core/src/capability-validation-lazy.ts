import { createCapabilityValidation } from './capability-validation-engine';

// Web and Node retain per-domain lazy loading. Do not import this entry from MV3.
const validation = /* @__PURE__ */ createCapabilityValidation((domain) => {
  switch (domain) {
    case 'product':
      return import('./generated/validators-product');
    case 'rfq':
      return import('./generated/validators-rfq');
    case 'trade':
      return import('./generated/validators-trade');
    case 'logistics':
      return import('./generated/validators-logistics');
    case 'insights':
      return import('./generated/validators-insights');
    case 'photo':
      return import('./generated/validators-photo');
    case 'platform':
      return import('./generated/validators-platform');
  }
});

export function validateCapabilityRequest(method: string, value: unknown) {
  return validation.validateCapabilityRequest(method, value);
}

export function validateCapabilityResponse(method: string, value: unknown) {
  return validation.validateCapabilityResponse(method, value);
}
