import type { ErrorObject } from 'ajv';
import { PRODUCT_CAPABILITY_DEFINITIONS } from './generated/product-capabilities';
import { RFQ_CAPABILITY_DEFINITIONS } from './generated/rfq-capabilities';
import { TRADE_CAPABILITY_DEFINITIONS } from './generated/trade-capabilities';
import { LOGISTICS_CAPABILITY_DEFINITIONS } from './generated/logistics-capabilities';
import { INSIGHTS_CAPABILITY_DEFINITIONS } from './generated/insights-capabilities';
import { PHOTO_CAPABILITY_DEFINITIONS } from './generated/photo-capabilities';
import { PLATFORM_CAPABILITY_DEFINITIONS } from './generated/platform-capabilities';
import type { CapabilityContractIssue } from './types';

export type CapabilityValidatorDomain =
  'product' | 'rfq' | 'trade' | 'logistics' | 'insights' | 'photo' | 'platform';
export type CapabilityValidatorModule = Readonly<Record<string, unknown>>;
interface StandaloneValidator {
  (value: unknown): boolean;
  errors?: ErrorObject[] | null;
}

const domains = [
  ['product', 'Product', PRODUCT_CAPABILITY_DEFINITIONS],
  ['rfq', 'Rfq', RFQ_CAPABILITY_DEFINITIONS],
  ['trade', 'Trade', TRADE_CAPABILITY_DEFINITIONS],
  ['logistics', 'Logistics', LOGISTICS_CAPABILITY_DEFINITIONS],
  ['insights', 'Insights', INSIGHTS_CAPABILITY_DEFINITIONS],
  ['photo', 'Photo', PHOTO_CAPABILITY_DEFINITIONS],
  ['platform', 'Platform', PLATFORM_CAPABILITY_DEFINITIONS]
] as const;

// Generation and lookup use the same definition insertion order for export IDs.
const references = new Map<string, { domain: CapabilityValidatorDomain; name: string }>(
  domains.flatMap(([domain, prefix, definitions]) =>
    Object.keys(definitions).map(
      (method, index) => [method, { domain, name: `validate${prefix}Capability${index}` }] as const
    )
  )
);

export function createCapabilityValidation(
  load: (domain: CapabilityValidatorDomain) => CapabilityValidatorModule | Promise<CapabilityValidatorModule>
) {
  async function validate(
    method: string,
    kind: 'Request' | 'Response',
    value: unknown
  ): Promise<CapabilityContractIssue[]> {
    const reference = references.get(method);
    const candidate = reference ? (await load(reference.domain))[`${reference.name}${kind}`] : undefined;
    // A missing validator is not evidence of a valid contract. Fail closed.
    if (typeof candidate !== 'function')
      return [{ instancePath: '/', keyword: 'validator', message: 'Capability validator unavailable' }];
    const validator = candidate as StandaloneValidator;
    if (validator(value)) return [];
    const issues = (validator.errors ?? []).map((error) => ({
      instancePath: error.instancePath || '/',
      keyword: error.keyword,
      message: error.message ?? '契约校验失败'
    }));
    return issues.length
      ? issues
      : [{ instancePath: '/', keyword: 'validator', message: 'Capability contract invalid' }];
  }
  return {
    validateCapabilityRequest: (method: string, value: unknown) => validate(method, 'Request', value),
    validateCapabilityResponse: (method: string, value: unknown) => validate(method, 'Response', value)
  };
}
