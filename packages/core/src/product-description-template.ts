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
