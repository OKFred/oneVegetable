import { GatewayException } from './errors';
import { isPhotoBankUrl } from './product-description-url';
import { IOP_REFERENCE_METHODS } from './product-reference-methods';
import type { GatewayClient } from './types';

export { IOP_REFERENCE_METHODS } from './product-reference-methods';
export interface ProductReferenceCategory {
  id: string;
  name: string;
  leaf: boolean | null;
  level: number | null;
}
export interface ProductCategorySuggestion {
  categoryId: string;
  categoryName: string | null;
  categoryPath: string | null;
}
export interface ProductReferenceAttribute {
  id: string | null;
  name: string | null;
  required: boolean | null;
  custom: boolean | null;
  multiple: boolean | null;
  values: { id: string | null; name: string | null }[];
}
export interface ProductReferenceAttributes {
  categoryId: string;
  attributes: ProductReferenceAttribute[];
  saleAttributes: ProductReferenceAttribute[];
}
export interface ProductReferenceShippingTemplate {
  id: string;
  name: string | null;
}
export interface ProductReference {
  productId: string;
  title: string | null;
  keywords: string | null;
  descriptionHtml: string | null;
  language: string | null;
  status: string | null;
  auditStatus: string | null;
  modelNumber: string | null;
  createdTimestamp: string | null;
  modifiedTimestamp: string | null;
  categoryId: string | null;
  categoryPath: string | null;
  attributes: { name: string | null; value: string | null }[];
  shippingTemplateId: string | null;
  weight: string | null;
  dimension: { length: string | null; width: string | null; height: string | null };
  leadTimes: { quantity: string | null; days: string | null }[];
  moq: string | null;
  unit: string | null;
  price: {
    type: string | null;
    currency: string | null;
    min: string | null;
    max: string | null;
    tiers: { quantity: string | null; price: string | null }[];
  };
  inventory: string | null;
  skus: {
    id: string | null;
    code: string | null;
    price: string | null;
    currency: string | null;
    inventory: string | null;
    attributes: { name: string | null; value: string | null; imageUrl: string | null }[];
  }[];
}

function fail(code = 'ALIBABA_IOP_RESPONSE_INVALID'): never {
  throw new GatewayException({ code, message: code, retryable: false });
}
function record(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function items(value: unknown): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return fail();
  return value.map(record);
}
function text(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (!Number.isInteger(value) || Number.isSafeInteger(value))
  )
    return String(value);
  return fail();
}
function id(value: unknown, required = false, request = false): string | null {
  if ((value === undefined || value === null || value === '') && !required) return null;
  if (
    (typeof value === 'string' && /^[1-9][0-9]*$/u.test(value)) ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
  )
    return String(value);
  return fail(request ? 'REQUEST_CONTRACT_INVALID' : undefined);
}
function flag(value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fail();
}
function requiredId(value: unknown, request = false): string {
  return id(value, true, request) ?? fail(request ? 'REQUEST_CONTRACT_INVALID' : undefined);
}
function attribute(value: Record<string, unknown>): ProductReferenceAttribute {
  return {
    id: id(value.attribute_id),
    name: text(value.attribute_name),
    required: flag(value.required),
    custom: flag(value.support_custom_value),
    multiple: flag(value.support_multi_value),
    values: items(value.attribute_value_list).map((item) => ({
      id: id(item.attribute_value_id),
      name: text(item.attribute_value_name)
    }))
  };
}

/** Pure read-only facade shared by all UIs. Cache ownership stays with the account-scoped caller. */
export class ProductReferenceClient {
  constructor(private readonly gateway: Pick<GatewayClient, 'request'>) {}

  async listCategories(parentCategoryId?: string): Promise<ProductReferenceCategory[]> {
    const value = await this.call(
      IOP_REFERENCE_METHODS.listCategories,
      parentCategoryId === undefined ? {} : { parent_category_id: id(parentCategoryId, true, true) }
    );
    if (!Array.isArray(value.data)) return fail();
    return items(value.data).map((item) => {
      const categoryId = id(item.category_id, true);
      const name = text(item.category_name);
      if (!categoryId || !name) return fail();
      const level = item.level;
      if (level !== undefined && (typeof level !== 'number' || !Number.isSafeInteger(level) || level < 1))
        return fail();
      return {
        id: categoryId,
        name,
        leaf: flag(item.leaf_category),
        level: typeof level === 'number' ? level : null
      };
    });
  }

  async predictCategory(input: {
    title: string;
    description?: string;
    imageUrl?: string;
  }): Promise<ProductCategorySuggestion> {
    if (!input.title.trim()) return fail('REQUEST_CONTRACT_INVALID');
    if (input.imageUrl) {
      let url: URL;
      try {
        url = new URL(input.imageUrl);
      } catch {
        return fail('REQUEST_CONTRACT_INVALID');
      }
      if (url.protocol !== 'https:' || url.username || url.password || !isPhotoBankUrl(input.imageUrl))
        return fail('REQUEST_CONTRACT_INVALID');
    }
    const value = await this.call(IOP_REFERENCE_METHODS.predictCategory, {
      title: input.title.trim(),
      ...(input.description?.trim() ? { description: input.description } : {}),
      ...(input.imageUrl ? { image: input.imageUrl } : {})
    });
    const data = record(value.data);
    return {
      categoryId: requiredId(data.category_id),
      categoryName: text(data.category_name),
      categoryPath: text(data.category_path)
    };
  }

  async getAttributes(categoryId: string): Promise<ProductReferenceAttributes> {
    const queryId = requiredId(categoryId, true);
    const value = await this.call(IOP_REFERENCE_METHODS.getAttributes, { category_id: queryId });
    if (value.data === undefined || value.data === null) return fail();
    const data = record(value.data);
    return {
      categoryId: queryId,
      attributes: items(data.category_attributes).map(attribute),
      saleAttributes: items(data.sale_attributes).map(attribute)
    };
  }

  async listShippingTemplates(): Promise<ProductReferenceShippingTemplate[]> {
    const value = await this.call(IOP_REFERENCE_METHODS.listShippingTemplates, {});
    if (!Array.isArray(value.template_info_list)) return fail();
    return items(value.template_info_list).map((item) => ({
      id: requiredId(item.template_id),
      name: text(item.template_name)
    }));
  }

  async getProduct(productId: string): Promise<ProductReference> {
    const queryId = requiredId(productId, true);
    const value = await this.call(IOP_REFERENCE_METHODS.getProduct, { product_id: queryId });
    const data = record(value.product_info);
    const basic = record(data.basic_info);
    const resultId = requiredId(basic.product_id);
    if (resultId !== queryId) return fail();
    const category = record(data.category_info);
    const logistics = record(data.logistics_info);
    const dimension = record(logistics.dimension);
    const trade = record(data.trade_info);
    const price = record(trade.price);
    const range = record(price.range_price);
    return {
      productId: resultId,
      title: text(basic.title),
      keywords: text(basic.keywords),
      descriptionHtml: text(basic.description),
      language: text(basic.language),
      status: text(basic.status),
      auditStatus: text(basic.audit_status),
      modelNumber: text(basic.model_number),
      createdTimestamp: text(basic.create_timestamp),
      modifiedTimestamp: text(basic.last_modified_timestamp),
      categoryId: id(category.category_id),
      categoryPath: text(category.category_name),
      attributes: items(category.attributes).map((item) => ({
        name: text(item.attribute_name),
        value: text(item.attribute_value)
      })),
      shippingTemplateId: id(logistics.shipping_template_id),
      weight: text(logistics.weight),
      dimension: {
        length: text(dimension.length),
        width: text(dimension.width),
        height: text(dimension.height)
      },
      leadTimes: items(logistics.tiered_lead_time).map((item) => ({
        quantity: text(item.quantity),
        days: text(item.lead_time)
      })),
      moq: text(trade.moq),
      unit: text(trade.unit),
      price: {
        type: text(price.price_type),
        currency: text(price.currency),
        min: text(range.min_price),
        max: text(range.max_price),
        tiers: items(price.tiered_price).map((item) => ({
          quantity: text(item.quantity),
          price: text(item.price)
        }))
      },
      inventory: text(trade.inventory),
      skus: items(trade.sku_info).map((item) => {
        const skuPrice = record(item.sku_price);
        return {
          id: id(item.sku_id),
          code: text(item.sku_code),
          price: text(skuPrice.price),
          currency: text(skuPrice.currency),
          inventory: text(item.inventory),
          attributes: items(item.sale_attributes).map((attribute) => ({
            name: text(attribute.attribute_name),
            value: text(attribute.attribute_value),
            imageUrl: text(record(attribute.image).image_url)
          }))
        };
      })
    };
  }

  private async call(method: string, parameters: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await this.gateway.request('callCapability', { method, parameters });
    if (!result.contractValid) return fail();
    const value = record(result.data);
    const business = method === IOP_REFERENCE_METHODS.predictCategory ? record(value.result) : value;
    if (business.success === false) return fail('ALIBABA_IOP_BUSINESS_REJECTED');
    if (business.success !== true) return fail();
    return business;
  }
}
