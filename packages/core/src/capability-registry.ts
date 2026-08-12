import type { ErrorObject } from 'ajv';

import { API_CAPABILITIES } from './generated/capabilities';
import { PRODUCT_CAPABILITY_DEFINITIONS } from './generated/product-capabilities';
import * as validatorExports from './generated/validators';

import type {
  ApiCapability,
  CapabilityContractIssue,
  CapabilityDefinition,
  CapabilityRequestMap,
  CapabilityResponseEnvelope,
  CapabilityResponseMap,
  GatewayClient
} from './types';

interface StandaloneValidator {
  (value: unknown): boolean;
  errors?: ErrorObject[] | null;
}

export type ProductCapabilityMethod = keyof typeof PRODUCT_CAPABILITY_DEFINITIONS;

const methods = Object.keys(PRODUCT_CAPABILITY_DEFINITIONS) as ProductCapabilityMethod[];
const validators = validatorExports as unknown as Record<string, unknown>;

function validatorFor(method: string, kind: 'Request' | 'Response'): StandaloneValidator | null {
  const index = methods.indexOf(method as ProductCapabilityMethod);
  if (index < 0) return null;
  const candidate = validators[`validateProductCapability${index}${kind}`];
  return typeof candidate === 'function' ? (candidate as StandaloneValidator) : null;
}

function issuesOf(errors: ErrorObject[] | null | undefined): CapabilityContractIssue[] {
  return (errors ?? []).map((error) => ({
    instancePath: error.instancePath || '/',
    keyword: error.keyword,
    message: error.message ?? '契约校验失败'
  }));
}

export function isProductCapabilityMethod(method: string): method is ProductCapabilityMethod {
  return method in PRODUCT_CAPABILITY_DEFINITIONS;
}

export function getCapabilityDefinition(method: string): CapabilityDefinition | null {
  if (!isProductCapabilityMethod(method)) return null;
  return {
    method,
    ...PRODUCT_CAPABILITY_DEFINITIONS[method]
  } as unknown as CapabilityDefinition;
}

export function listCapabilityDefinitions(): CapabilityDefinition[] {
  return methods.flatMap((method) => {
    const definition = getCapabilityDefinition(method);
    return definition ? [definition] : [];
  });
}

export function validateCapabilityRequest(method: string, parameters: unknown): CapabilityContractIssue[] {
  const validator = validatorFor(method, 'Request');
  if (!validator || validator(parameters)) return [];
  return issuesOf(validator.errors);
}

export function validateCapabilityResponse(method: string, data: unknown): CapabilityContractIssue[] {
  const validator = validatorFor(method, 'Response');
  if (!validator || validator(data)) return [];
  return issuesOf(validator.errors);
}

function articleCapabilities(): ApiCapability[] {
  return listCapabilityDefinitions().flatMap((definition) => {
    if (definition.source !== 'article') return [];
    return [
      {
        method: definition.method,
        domain: 'product',
        chargeLabel: '文章来源（不计入免费目录）',
        auth: 'required',
        jushitaOnly: false,
        restricted: false,
        restrictionReason: null,
        enabled: true,
        docUrl: definition.docUrl,
        checkedAt: definition.checkedAt,
        updatedAt: definition.updatedAt ?? null,
        source: definition.source,
        lifecycle: definition.lifecycle,
        risk: definition.risk,
        verification: definition.verification,
        realCallEnabled: false,
        requestSchema: definition.requestSchema,
        responseSchema: definition.responseSchema
      }
    ];
  });
}

export function listCapabilities(): ApiCapability[] {
  return [...API_CAPABILITIES, ...articleCapabilities()];
}

export function findCapability(method: string): ApiCapability | undefined {
  return listCapabilities().find((capability) => capability.method === method);
}

export async function callCapability<M extends keyof CapabilityRequestMap>(
  client: GatewayClient,
  method: M,
  parameters: CapabilityRequestMap[M]
): Promise<CapabilityResponseEnvelope<CapabilityResponseMap[M]>> {
  const result = await client.request('callCapability', { method, parameters });
  return result as CapabilityResponseEnvelope<CapabilityResponseMap[M]>;
}
