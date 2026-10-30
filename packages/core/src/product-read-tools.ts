import { authorizeCapabilityCall } from './capability-policy';
import { GatewayException } from './errors';
import type { components } from './generated/api';
import type { GatewayClient, OperationId, RequestOf, ResponseOf } from './types';

export const PRODUCT_READ_METHODS = {
  translation: 'alibaba.icbu.text.trans',
  recognize: 'alibaba.icbu.text.recognize',
  recognizeTranslation: 'alibaba.icbu.text.recognize.trans',
  countries: 'alibaba.icbu.product.country.getcountrylist',
  coverage: 'alibaba.icbu.product.logistics.country.getcoststatus'
} as const;

/**
 * Protocol preflight (public documentation, not account acceptance):
 * TOP 67157: token-free translation, but application grant and actual appName required.
 * TOP 67168/67167: restricted by the existing registry; no recognition action is exposed.
 * TOP 58734/58733: authorized country list / freight determinacy, not a money quote.
 * Existing listShippingTemplates supplies names/IDs. No IOP mapping is inferred for
 * these native capabilities. Context routing always uses the actual operation/payload.
 * Docs: https://developer.alibaba.com/docs/api.htm?apiId=67157 (also 58734, 58733).
 */
export interface TranslateTextInput {
  text: string;
  appName: string;
  sourceLanguage: string;
  targetLanguage: string;
  fieldType: 'title' | 'offer';
}
export interface TranslationReadResult {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  traceId: string;
}
export interface ShippingCoverageInput {
  shippingTemplateId: string;
  weightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  saleType: 'normal' | 'batch';
  productType: 1 | 2;
  moq: number;
  batchNum?: number | undefined;
  language?: string | undefined;
}
export interface ShippingCountry {
  code: string;
  name: string;
  continentCode: string | null;
  continentName: string | null;
}
export interface ShippingCoverageCountry {
  code: string;
  name: string;
  core: boolean;
  freightCertain: boolean | null;
}
export interface ProductReadResult<T> {
  items: T[];
  traceId: string;
}
type TranslationRequest = components['schemas']['AlibabaProductAlibabaIcbuTextTransRequest'];
type CoverageRequest =
  components['schemas']['AlibabaFreeApiAlibabaIcbuProductLogisticsCountryGetcoststatusRequest'];

function fail(code: string, traceId?: string): never {
  throw new GatewayException({ code, message: code, retryable: false, ...(traceId ? { traceId } : {}) });
}
function record(value: unknown, traceId?: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('PRODUCT_READ_RESPONSE_INVALID', traceId);
  return value as Record<string, unknown>;
}
function nonempty(value: unknown, traceId?: string): string {
  if (typeof value !== 'string' || !value.trim()) return fail('PRODUCT_READ_RESPONSE_INVALID', traceId);
  return value;
}
function rows(value: unknown, traceId: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) return fail('PRODUCT_READ_RESPONSE_INVALID', traceId);
  return value.map((item) => record(item, traceId));
}
function language(value: string): string {
  const trimmed = value.trim();
  if (!/^[a-z]{2,3}(?:[-_][A-Za-z]{2,4})?$/u.test(trimmed)) return fail('REQUEST_CONTRACT_INVALID');
  return trimmed;
}
function decimal(value: string): string {
  const trimmed = value.trim();
  if (
    !/^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(trimmed) ||
    !Number.isFinite(Number(trimmed)) ||
    Number(trimmed) <= 0
  )
    return fail('REQUEST_CONTRACT_INVALID');
  return trimmed;
}
function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) return fail('REQUEST_CONTRACT_INVALID');
  return value;
}
function safeCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[A-Za-z0-9_.;:-]{1,160}$/u.test(value) ? value : fallback;
}

export function createTranslationReadRequest(input: TranslateTextInput): TranslationRequest {
  if (!input.text.trim() || !input.appName.trim() || !['title', 'offer'].includes(input.fieldType))
    return fail('REQUEST_CONTRACT_INVALID');
  return {
    icbu_translate_task_dto: [
      {
        trans_engine: 'ALI_TRANS',
        app_name: input.appName.trim(),
        source_text: input.text,
        source_language: language(input.sourceLanguage),
        target_language: language(input.targetLanguage),
        field_type: input.fieldType,
        format: 'text'
      }
    ]
  };
}
export function createShippingCoverageRequest(input: ShippingCoverageInput): CoverageRequest {
  const template = input.shippingTemplateId.trim();
  if (
    !/^[1-9]\d*$/u.test(template) ||
    !['normal', 'batch'].includes(input.saleType) ||
    ![1, 2].includes(input.productType) ||
    !Number.isFinite(input.moq) ||
    input.moq <= 0
  )
    return fail('REQUEST_CONTRACT_INVALID');
  return {
    country_logistics_cost_status_request: {
      shipping_template_id: positiveInteger(Number(template)),
      unit_weight: decimal(input.weightKg),
      unit_size: [input.lengthCm, input.widthCm, input.heightCm].map(decimal).join('X'),
      sale_type: input.saleType,
      product_type: input.productType,
      moq: input.moq,
      ...(input.saleType === 'batch' ? { batch_num: positiveInteger(input.batchNum ?? 0) } : {}),
      ...(input.language?.trim() ? { language: language(input.language) } : {})
    }
  };
}
export function productReadCapabilityAllowed(method: string): boolean {
  return authorizeCapabilityCall({ method, parameters: {} }).allowed;
}

/** No timers, cache, writes, credential reads or mock fallback. A caller owns its lifetime. */
export class ProductReadToolsClient {
  private epoch = 0;
  private alive = true;
  constructor(
    private readonly gateway: GatewayClient,
    private readonly boundary: () => string = () => ''
  ) {}
  invalidate(): void {
    this.epoch++;
  }
  dispose(): void {
    this.alive = false;
    this.invalidate();
  }

  private async read<K extends OperationId>(operation: K, payload: RequestOf<K>): Promise<ResponseOf<K>> {
    const epoch = this.epoch;
    const boundary = this.boundary();
    const assertCurrent = () => {
      if (!this.alive || epoch !== this.epoch || boundary !== this.boundary())
        fail('PRODUCT_CONTEXT_CHANGED');
    };
    assertCurrent();
    if (!this.gateway.galleryTransferContext) return fail('ALIBABA_TOP_AUTHORIZATION_REQUIRED');
    const context = await this.gateway.galleryTransferContext(
      operation,
      payload as Readonly<Record<string, unknown>>
    );
    assertCurrent();
    const response = await this.gateway.request(operation, payload, { galleryContext: context });
    assertCurrent();
    const current = await this.gateway.galleryTransferContext(
      operation,
      payload as Readonly<Record<string, unknown>>
    );
    assertCurrent();
    if (context.identity !== current.identity || context.gateway !== current.gateway)
      return fail('PRODUCT_CONTEXT_CHANGED');
    return response;
  }
  private async capability(method: string, parameters: Record<string, unknown>) {
    const policy = authorizeCapabilityCall({ method, parameters });
    if (!policy.allowed) return fail(policy.reasonCode);
    const response = await this.read('callCapability', { method, parameters });
    if (response.method !== method || !response.contractValid)
      return fail('PRODUCT_READ_RESPONSE_INVALID', response.traceId);
    const data = record(response.data, response.traceId);
    const traceId = typeof data.trace_id === 'string' && data.trace_id ? data.trace_id : response.traceId;
    if (data.biz_success === false || data.success === false)
      return fail(safeCode(data.msg_code, 'PRODUCT_READ_BUSINESS_FAILED'), traceId);
    return { data, traceId };
  }

  async translateText(input: TranslateTextInput): Promise<TranslationReadResult> {
    const { data, traceId } = await this.capability(
      PRODUCT_READ_METHODS.translation,
      createTranslationReadRequest(input)
    );
    const result = rows(data.result, traceId);
    const failed = result.find((item) => item.success === false);
    if (failed) {
      const error =
        failed.error_code && typeof failed.error_code === 'object' ? record(failed.error_code) : {};
      const itemTrace = typeof failed.trace_id === 'string' ? failed.trace_id : traceId;
      return fail(
        result.some((item) => item.success === true)
          ? 'PRODUCT_READ_PARTIAL_FAILURE'
          : safeCode(error.code, 'PRODUCT_READ_BUSINESS_FAILED'),
        itemTrace
      );
    }
    if (result.length !== 1 || result[0]?.success !== true)
      return fail('PRODUCT_READ_RESPONSE_INVALID', traceId);
    const item = result[0];
    if (
      (item.source_language !== undefined && item.source_language !== input.sourceLanguage.trim()) ||
      (item.target_language !== undefined && item.target_language !== input.targetLanguage.trim())
    )
      return fail('PRODUCT_READ_RESPONSE_INVALID', traceId);
    return {
      text: nonempty(item.translate_result_text, traceId),
      sourceLanguage: input.sourceLanguage.trim(),
      targetLanguage: input.targetLanguage.trim(),
      traceId: typeof item.trace_id === 'string' && item.trace_id ? item.trace_id : traceId
    };
  }

  async listCountries(resultLanguage?: string): Promise<ProductReadResult<ShippingCountry>> {
    const { data, traceId } = await this.capability(PRODUCT_READ_METHODS.countries, {
      country_request: resultLanguage?.trim() ? { language: language(resultLanguage) } : {}
    });
    if (data.biz_success !== true) return fail('PRODUCT_READ_RESPONSE_INVALID', traceId);
    const continents = rows(
      Array.isArray(data.data) ? data.data : record(data.data, traceId).continent_d_t_o,
      traceId
    );
    return {
      traceId,
      items: continents.flatMap((continent) => {
        const list = continent.country_list;
        const countries = rows(Array.isArray(list) ? list : record(list, traceId).country_d_t_o, traceId);
        return countries.map((country) => ({
          code: nonempty(country.country_code, traceId),
          name: nonempty(country.country_name, traceId),
          continentCode: typeof continent.continent_code === 'string' ? continent.continent_code : null,
          continentName: typeof continent.continent_name === 'string' ? continent.continent_name : null
        }));
      })
    };
  }

  async listShippingTemplates() {
    // Existing operation's documented TOP template names/IDs; do not invent an IOP call.
    const result = await this.read('listShippingTemplates', undefined);
    return result.map((item) => ({ id: nonempty(item.id), name: nonempty(item.name) }));
  }

  async getShippingCoverage(
    input: ShippingCoverageInput
  ): Promise<ProductReadResult<ShippingCoverageCountry>> {
    const { data, traceId } = await this.capability(
      PRODUCT_READ_METHODS.coverage,
      createShippingCoverageRequest(input)
    );
    if (data.biz_success !== true) return fail('PRODUCT_READ_RESPONSE_INVALID', traceId);
    const value = record(data.data, traceId);
    if (
      value.core_country_logistics_cost_list === undefined &&
      value.non_core_country_logistics_cost_list === undefined
    )
      return fail('PRODUCT_READ_RESPONSE_INVALID', traceId);
    const groups = [
      [true, value.core_country_logistics_cost_list ?? []],
      [false, value.non_core_country_logistics_cost_list ?? []]
    ] as const;
    return {
      traceId,
      items: groups.flatMap(([core, list]) =>
        rows(list, traceId).map((country) => {
          const flag = country.is_freight_cost_certain;
          if (
            flag !== undefined &&
            flag !== null &&
            ![true, false, 'true', 'false'].includes(flag as boolean | string)
          )
            return fail('PRODUCT_READ_RESPONSE_INVALID', traceId);
          return {
            code: nonempty(country.country_code, traceId),
            name: nonempty(country.country_name, traceId),
            core,
            freightCertain: flag === undefined || flag === null ? null : flag === true || flag === 'true'
          };
        })
      )
    };
  }
}
