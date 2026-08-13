import type { ErrorObject } from 'ajv';
import localize from 'ajv-i18n';

import {
  validateCapabilityCallRequest,
  validateLogisticsOrderDraft,
  validateLogisticsQuoteRequest,
  validateProductSchemaRequest,
  validateSchemaPublishRequest
} from '../generated/validators-core';

import type {
  CapabilityCallRequest,
  LogisticsOrderDraft,
  LogisticsQuoteRequest,
  ProductSchemaRequest,
  SchemaPublishRequest
} from '../types';

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

export const validateSchemaPublishInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<SchemaPublishRequest>(validateSchemaPublishRequest as StandaloneValidator, value, locale);

export const validateCapabilityCallInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<CapabilityCallRequest>(validateCapabilityCallRequest as StandaloneValidator, value, locale);

export const validateLogisticsQuoteInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<LogisticsQuoteRequest>(validateLogisticsQuoteRequest as StandaloneValidator, value, locale);

export const validateLogisticsOrderInput = (value: unknown, locale?: 'en' | 'zh') =>
  runValidator<LogisticsOrderDraft>(validateLogisticsOrderDraft as StandaloneValidator, value, locale);
