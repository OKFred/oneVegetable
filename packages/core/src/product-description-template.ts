import type { EntityAuditFields } from './audit';

export const PRODUCT_DESCRIPTION_TEMPLATE_CATEGORIES = [
  'company',
  'logistics',
  'packaging',
  'service',
  'custom'
] as const;
export const PRODUCT_DESCRIPTION_TEMPLATE_LANGUAGES = ['zh_CN', 'en_US'] as const;
export const PRODUCT_DESCRIPTION_TEMPLATE_STATUSES = ['active', 'archived'] as const;

export type ProductDescriptionTemplateCategory = (typeof PRODUCT_DESCRIPTION_TEMPLATE_CATEGORIES)[number];
export type ProductDescriptionTemplateLanguage = (typeof PRODUCT_DESCRIPTION_TEMPLATE_LANGUAGES)[number];
export type ProductDescriptionTemplateStatus = (typeof PRODUCT_DESCRIPTION_TEMPLATE_STATUSES)[number];

export interface ProductDescriptionTemplate extends EntityAuditFields {
  id: string;
  name: string;
  category: ProductDescriptionTemplateCategory;
  language: ProductDescriptionTemplateLanguage;
  html: string;
  status: ProductDescriptionTemplateStatus;
}

export interface ProductDescriptionTemplatePage {
  items: ProductDescriptionTemplate[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ProductDescriptionTemplateListRequest {
  requestId: string;
  page?: number;
  pageSize?: number;
  language?: ProductDescriptionTemplateLanguage;
  category?: ProductDescriptionTemplateCategory;
  status?: ProductDescriptionTemplateStatus;
}

export interface ProductDescriptionTemplateCreateRequest {
  requestId: string;
  name: string;
  category: ProductDescriptionTemplateCategory;
  language: ProductDescriptionTemplateLanguage;
  html: string;
  remark?: string | null;
}

export interface ProductDescriptionTemplateUpdateRequest {
  requestId: string;
  id: string;
  name: string;
  category: ProductDescriptionTemplateCategory;
  language: ProductDescriptionTemplateLanguage;
  html: string;
  revision: number;
  remark: string | null;
}

export interface ProductDescriptionTemplateStatusRequest {
  requestId: string;
  id: string;
  revision: number;
}

export interface OperationAvailability {
  operation: string;
  allowed: boolean;
  reasonCode: string | null;
}

export interface OperationAvailabilityResult {
  items: OperationAvailability[];
}
