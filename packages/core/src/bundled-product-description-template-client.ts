import { GatewayException } from './errors';

import type {
  ProductDescriptionTemplate,
  ProductDescriptionTemplateCategory,
  ProductDescriptionTemplateLanguage
} from './product-description-template';
import type {
  ProductDescriptionTemplateClient,
  ProductDescriptionTemplateListInput
} from './product-description-template-client-types';

/** Small read-only adapter used by the extension without pulling in BFF or Mock transports. */
export class BundledProductDescriptionTemplateClient implements ProductDescriptionTemplateClient {
  readonly #values: readonly ProductDescriptionTemplate[];

  constructor(values: readonly ProductDescriptionTemplate[]) {
    this.#values = structuredClone(values);
  }

  list(input: ProductDescriptionTemplateListInput = {}) {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    const values = this.#values
      .filter((value) => input.language === undefined || value.language === input.language)
      .filter((value) => input.category === undefined || value.category === input.category)
      .filter((value) => input.status === undefined || value.status === input.status)
      .toSorted((left, right) => left.name.localeCompare(right.name));
    const offset = (page - 1) * pageSize;
    return Promise.resolve({
      items: structuredClone(values.slice(offset, offset + pageSize)),
      page,
      pageSize,
      total: values.length
    });
  }

  create(_input: {
    name: string;
    category: ProductDescriptionTemplateCategory;
    language: ProductDescriptionTemplateLanguage;
    html: string;
    remark?: string | null;
  }): Promise<ProductDescriptionTemplate> {
    return Promise.reject(readOnlyError());
  }

  update(_input: {
    id: string;
    name: string;
    category: ProductDescriptionTemplateCategory;
    language: ProductDescriptionTemplateLanguage;
    html: string;
    revision: number;
    remark: string | null;
  }): Promise<ProductDescriptionTemplate> {
    return Promise.reject(readOnlyError());
  }

  archive(_id: string, _revision: number): Promise<ProductDescriptionTemplate> {
    return Promise.reject(readOnlyError());
  }

  restore(_id: string, _revision: number): Promise<ProductDescriptionTemplate> {
    return Promise.reject(readOnlyError());
  }
}

function readOnlyError(): GatewayException {
  return new GatewayException({
    code: 'TEMPLATE_WRITE_UNAVAILABLE',
    message: '当前模式只能使用内置详情模板',
    retryable: false
  });
}
