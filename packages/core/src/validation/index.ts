import type { ErrorObject } from 'ajv';
import localize from 'ajv-i18n';

import {
  validateCapabilityCallRequest,
  validateLogisticsOrderDraft,
  validateLogisticsQuoteRequest,
  validateOperationAvailabilityRequest,
  validateProductDisplayRequest,
  validateProductGroupCreateRequest,
  validateProductDescriptionTemplateCreateRequest,
  validateProductDescriptionTemplateListRequest,
  validateProductDescriptionTemplateStatusRequest,
  validateProductDescriptionTemplateUpdateRequest,
  validateProductMutationJobGetRequest,
  validateProductMutationJobListRequest,
  validateProductMutationJobRefreshRequest,
  validateProductSchemaRenderRequest,
  validateProductSchemaRequest,
  validateProductSchemaUpdateRequest,
  validateSchemaPublishRequest
} from '../generated/validators-core';

import type {
  CapabilityCallRequest,
  LogisticsOrderDraft,
  LogisticsQuoteRequest,
  ProductDisplayRequest,
  ProductGroupCreateRequest,
  ProductSchemaRequest,
  ProductSchemaRenderRequest,
  ProductSchemaUpdateRequest,
  SchemaPublishRequest
} from '../types';
import type {
  ProductDescriptionTemplateCreateRequest,
  ProductDescriptionTemplateListRequest,
  ProductDescriptionTemplateStatusRequest,
  ProductDescriptionTemplateUpdateRequest
} from '../product-description-template';
import type {
  ProductMutationJobGetRequest,
  ProductMutationJobListRequest,
  ProductMutationJobRefreshRequest
} from '../product-mutation-job';

export interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  errors: string[];
}

interface StandaloneValidator {
  (value: unknown): boolean;
  errors?: ErrorObject[] | null;
}

function runValidator<T>(
  validator: StandaloneValidator,
  value: unknown,
  locale: 'en' | 'zh' = 'zh'
): ValidationResult<T> {
  const valid = validator(value);
  if (valid) return { valid: true, data: value as T, errors: [] };

  const errors = validator.errors ?? [];
  if (locale === 'zh') localize.zh(errors);
  else localize.en(errors);
  return {
    valid: false,
    errors: errors.map((error) => `${error.instancePath || '/'} ${error.message ?? '校验失败'}`)
  };
}

export const validateProductSchemaInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<ProductSchemaRequest>(validateProductSchemaRequest as StandaloneValidator, value, locale);

export const validateProductSchemaRenderInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<ProductSchemaRenderRequest>(
    validateProductSchemaRenderRequest as StandaloneValidator,
    value,
    locale
  );

export const validateSchemaPublishInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<SchemaPublishRequest>(validateSchemaPublishRequest as StandaloneValidator, value, locale);

export const validateProductSchemaUpdateInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<ProductSchemaUpdateRequest>(
    validateProductSchemaUpdateRequest as StandaloneValidator,
    value,
    locale
  );

export const validateProductDisplayInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<ProductDisplayRequest>(validateProductDisplayRequest as StandaloneValidator, value, locale);

export const validateProductGroupCreateInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<ProductGroupCreateRequest>(
    validateProductGroupCreateRequest as StandaloneValidator,
    value,
    locale
  );

export const validateCapabilityCallInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<CapabilityCallRequest>(validateCapabilityCallRequest as StandaloneValidator, value, locale);

export const validateLogisticsQuoteInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<LogisticsQuoteRequest>(validateLogisticsQuoteRequest as StandaloneValidator, value, locale);

export const validateLogisticsOrderInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<LogisticsOrderDraft>(validateLogisticsOrderDraft as StandaloneValidator, value, locale);

export const validateOperationAvailabilityInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<{ requestId: string; operations: string[] }>(
    validateOperationAvailabilityRequest as StandaloneValidator,
    value,
    locale
  );

export const validateProductDescriptionTemplateListInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<ProductDescriptionTemplateListRequest>(
    validateProductDescriptionTemplateListRequest as StandaloneValidator,
    value,
    locale
  );

export const validateProductDescriptionTemplateCreateInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<ProductDescriptionTemplateCreateRequest>(
    validateProductDescriptionTemplateCreateRequest as StandaloneValidator,
    value,
    locale
  );

export const validateProductDescriptionTemplateUpdateInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<ProductDescriptionTemplateUpdateRequest>(
    validateProductDescriptionTemplateUpdateRequest as StandaloneValidator,
    value,
    locale
  );

export const validateProductDescriptionTemplateStatusInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<ProductDescriptionTemplateStatusRequest>(
    validateProductDescriptionTemplateStatusRequest as StandaloneValidator,
    value,
    locale
  );

export const validateProductMutationJobListInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<ProductMutationJobListRequest>(
    validateProductMutationJobListRequest as StandaloneValidator,
    value,
    locale
  );

export const validateProductMutationJobGetInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<ProductMutationJobGetRequest>(
    validateProductMutationJobGetRequest as StandaloneValidator,
    value,
    locale
  );

export const validateProductMutationJobRefreshInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<ProductMutationJobRefreshRequest>(
    validateProductMutationJobRefreshRequest as StandaloneValidator,
    value,
    locale
  );
