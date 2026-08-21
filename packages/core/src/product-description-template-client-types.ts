import type {
  OperationAvailabilityResult,
  ProductDescriptionTemplate,
  ProductDescriptionTemplateCategory,
  ProductDescriptionTemplateLanguage,
  ProductDescriptionTemplatePage,
  ProductDescriptionTemplateStatus
} from './product-description-template';
import type { OperationId } from './types';

export interface ProductDescriptionTemplateListInput {
  page?: number;
  pageSize?: number;
  language?: ProductDescriptionTemplateLanguage;
  category?: ProductDescriptionTemplateCategory;
  status?: ProductDescriptionTemplateStatus;
}

export interface ProductDescriptionTemplateClient {
  list(input?: ProductDescriptionTemplateListInput): Promise<ProductDescriptionTemplatePage>;
  create(input: {
    name: string;
    category: ProductDescriptionTemplateCategory;
    language: ProductDescriptionTemplateLanguage;
    html: string;
    remark?: string | null;
  }): Promise<ProductDescriptionTemplate>;
  update(input: {
    id: string;
    name: string;
    category: ProductDescriptionTemplateCategory;
    language: ProductDescriptionTemplateLanguage;
    html: string;
    revision: number;
    remark: string | null;
  }): Promise<ProductDescriptionTemplate>;
  archive(id: string, revision: number): Promise<ProductDescriptionTemplate>;
  restore(id: string, revision: number): Promise<ProductDescriptionTemplate>;
}

export interface OperationAvailabilityClient {
  get(operations: readonly OperationId[]): Promise<OperationAvailabilityResult>;
}
