import type { ErrorObject } from 'ajv';

import { API_CAPABILITIES } from './generated/capabilities';
import { PRODUCT_CAPABILITY_DEFINITIONS } from './generated/product-capabilities';
import { RFQ_CAPABILITY_DEFINITIONS } from './generated/rfq-capabilities';
import { TRADE_CAPABILITY_DEFINITIONS } from './generated/trade-capabilities';
import { LOGISTICS_CAPABILITY_DEFINITIONS } from './generated/logistics-capabilities';
import { INSIGHTS_CAPABILITY_DEFINITIONS } from './generated/insights-capabilities';
import { PHOTO_CAPABILITY_DEFINITIONS } from './generated/photo-capabilities';
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
export type RfqCapabilityMethod = keyof typeof RFQ_CAPABILITY_DEFINITIONS;
export type TradeCapabilityMethod = keyof typeof TRADE_CAPABILITY_DEFINITIONS;
export type LogisticsCapabilityMethod = keyof typeof LOGISTICS_CAPABILITY_DEFINITIONS;
export type InsightsCapabilityMethod = keyof typeof INSIGHTS_CAPABILITY_DEFINITIONS;
export type PhotoCapabilityMethod = keyof typeof PHOTO_CAPABILITY_DEFINITIONS;
export type CapabilityMethod =
  | ProductCapabilityMethod
  | RfqCapabilityMethod
  | TradeCapabilityMethod
  | LogisticsCapabilityMethod
  | InsightsCapabilityMethod
  | PhotoCapabilityMethod;

const productMethods = Object.keys(PRODUCT_CAPABILITY_DEFINITIONS) as ProductCapabilityMethod[];
const rfqMethods = Object.keys(RFQ_CAPABILITY_DEFINITIONS) as RfqCapabilityMethod[];
const tradeMethods = Object.keys(TRADE_CAPABILITY_DEFINITIONS) as TradeCapabilityMethod[];
const logisticsMethods = Object.keys(LOGISTICS_CAPABILITY_DEFINITIONS) as LogisticsCapabilityMethod[];
const insightsMethods = Object.keys(INSIGHTS_CAPABILITY_DEFINITIONS) as InsightsCapabilityMethod[];
const photoMethods = Object.keys(PHOTO_CAPABILITY_DEFINITIONS) as PhotoCapabilityMethod[];
const methods: CapabilityMethod[] = [
  ...productMethods,
  ...rfqMethods,
  ...tradeMethods,
  ...logisticsMethods,
  ...insightsMethods,
  ...photoMethods
];
const validators = validatorExports as unknown as Record<string, unknown>;

function validatorFor(method: string, kind: 'Request' | 'Response'): StandaloneValidator | null {
  const productIndex = productMethods.indexOf(method as ProductCapabilityMethod);
  const rfqIndex = rfqMethods.indexOf(method as RfqCapabilityMethod);
  const tradeIndex = tradeMethods.indexOf(method as TradeCapabilityMethod);
  const logisticsIndex = logisticsMethods.indexOf(method as LogisticsCapabilityMethod);
  const insightsIndex = insightsMethods.indexOf(method as InsightsCapabilityMethod);
  const photoIndex = photoMethods.indexOf(method as PhotoCapabilityMethod);
  const candidate =
    productIndex >= 0
      ? validators[`validateProductCapability${productIndex}${kind}`]
      : rfqIndex >= 0
        ? validators[`validateRfqCapability${rfqIndex}${kind}`]
        : tradeIndex >= 0
          ? validators[`validateTradeCapability${tradeIndex}${kind}`]
          : logisticsIndex >= 0
            ? validators[`validateLogisticsCapability${logisticsIndex}${kind}`]
            : insightsIndex >= 0
              ? validators[`validateInsightsCapability${insightsIndex}${kind}`]
              : validators[`validatePhotoCapability${photoIndex}${kind}`];
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

export function isRfqCapabilityMethod(method: string): method is RfqCapabilityMethod {
  return method in RFQ_CAPABILITY_DEFINITIONS;
}

export function isTradeCapabilityMethod(method: string): method is TradeCapabilityMethod {
  return method in TRADE_CAPABILITY_DEFINITIONS;
}

export function isLogisticsCapabilityMethod(method: string): method is LogisticsCapabilityMethod {
  return method in LOGISTICS_CAPABILITY_DEFINITIONS;
}

export function isInsightsCapabilityMethod(method: string): method is InsightsCapabilityMethod {
  return method in INSIGHTS_CAPABILITY_DEFINITIONS;
}

export function isPhotoCapabilityMethod(method: string): method is PhotoCapabilityMethod {
  return method in PHOTO_CAPABILITY_DEFINITIONS;
}

export function isCapabilityMethod(method: string): method is CapabilityMethod {
  return (
    isProductCapabilityMethod(method) ||
    isRfqCapabilityMethod(method) ||
    isTradeCapabilityMethod(method) ||
    isLogisticsCapabilityMethod(method) ||
    isInsightsCapabilityMethod(method) ||
    isPhotoCapabilityMethod(method)
  );
}

export function getCapabilityDefinition(method: string): CapabilityDefinition | null {
  if (!isCapabilityMethod(method)) return null;
  const definition = isProductCapabilityMethod(method)
    ? PRODUCT_CAPABILITY_DEFINITIONS[method]
    : isRfqCapabilityMethod(method)
      ? RFQ_CAPABILITY_DEFINITIONS[method]
      : isTradeCapabilityMethod(method)
        ? TRADE_CAPABILITY_DEFINITIONS[method]
        : isLogisticsCapabilityMethod(method)
          ? LOGISTICS_CAPABILITY_DEFINITIONS[method]
          : isInsightsCapabilityMethod(method)
            ? INSIGHTS_CAPABILITY_DEFINITIONS[method]
            : PHOTO_CAPABILITY_DEFINITIONS[method];
  return {
    method,
    ...definition
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
