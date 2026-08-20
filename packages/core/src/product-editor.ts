import { isProductSchemaHtmlField, isProductSchemaImageField } from './product-schema';

import type { ProductSchemaField } from './product-schema';

export const PRODUCT_EDITOR_STEP_IDS = [
  'basics',
  'attributes',
  'media',
  'description',
  'trade',
  'review'
] as const;

export type ProductEditorStepId = (typeof PRODUCT_EDITOR_STEP_IDS)[number];

export interface ProductEditorFieldEntry {
  field: ProductSchemaField;
  sourceIndex: number;
  required: boolean;
  recommended: boolean;
  optional: boolean;
}

export interface ProductEditorSection {
  id: ProductEditorStepId;
  title: string;
  description: string;
  fields: ProductEditorFieldEntry[];
}

const STEP_COPY: Record<ProductEditorStepId, Pick<ProductEditorSection, 'title' | 'description'>> = {
  basics: { title: '基础信息与类目', description: '设置标题、关键词、品牌和商品身份信息' },
  attributes: { title: '商品属性与规格', description: '填写类目属性、型号、材质和规格组合' },
  media: { title: '图片素材', description: '从国际站图库选择主图、SKU 图和其他素材' },
  description: { title: '商品详情', description: '编辑普通详情内容并查看内容质量建议' },
  trade: { title: '交易与物流', description: '填写价格、起订量、包装、交期和物流信息' },
  review: { title: '检查与提交', description: '集中修正阻断问题并查看非阻断整改建议' }
};

const KNOWN_FIELD_STEPS = new Map<string, ProductEditorStepId>([
  ['producttitle', 'basics'],
  ['subject', 'basics'],
  ['title', 'basics'],
  ['keywords', 'basics'],
  ['keyword', 'basics'],
  ['brandname', 'basics'],
  ['brand', 'basics'],
  ['modelnumber', 'basics'],
  ['model', 'basics'],
  ['producttype', 'basics'],
  ['groupid', 'basics'],
  ['scimages', 'media'],
  ['mainimages', 'media'],
  ['skuimages', 'media'],
  ['supertext', 'description'],
  ['productdesctype', 'description'],
  ['description', 'description'],
  ['productdescription', 'description']
]);

const BASIC_PATTERN = /(title|subject|keyword|brand|model|producttype|group)/i;
const TRADE_PATTERN =
  /(price|moq|minorder|quantity|unit|package|packing|delivery|leadtime|shipping|freight|port|supply)/i;

export function classifyProductSchemaFields(fields: readonly ProductSchemaField[]): ProductEditorSection[] {
  const sections = PRODUCT_EDITOR_STEP_IDS.map((id): ProductEditorSection => ({
    id,
    ...STEP_COPY[id],
    fields: []
  }));
  const byId = new Map(sections.map((section) => [section.id, section]));
  fields.forEach((field, sourceIndex) => {
    const required = isRequired(field);
    const recommended = hasOfficialTip(field);
    const entry: ProductEditorFieldEntry = {
      field,
      sourceIndex,
      required,
      recommended,
      optional: !required && !recommended
    };
    byId.get(productEditorStepForField(field))?.fields.push(entry);
  });
  return sections;
}

export function productEditorStepForField(field: ProductSchemaField): ProductEditorStepId {
  const normalizedId = normalizeFieldId(field.id);
  const known = KNOWN_FIELD_STEPS.get(normalizedId);
  if (known) return known;
  if (isProductSchemaImageField(field)) return 'media';
  if (isProductSchemaHtmlField(field)) return 'description';
  if (TRADE_PATTERN.test(field.id) || TRADE_PATTERN.test(field.name)) return 'trade';
  if (BASIC_PATTERN.test(field.id) || BASIC_PATTERN.test(field.name)) return 'basics';
  return 'attributes';
}

export function isProductEditorFieldRequired(field: ProductSchemaField): boolean {
  return isRequired(field);
}

export function isProductEditorFieldRecommended(field: ProductSchemaField): boolean {
  return hasOfficialTip(field);
}

export function productEditorFieldDomId(fieldKey: string): string {
  return `product-field-${encodeURIComponent(fieldKey)}`;
}

function normalizeFieldId(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

function isRequired(field: ProductSchemaField): boolean {
  return field.rules.some((rule) => rule.name === 'requiredRule' && isTruthy(rule.value));
}

function hasOfficialTip(field: ProductSchemaField): boolean {
  return field.rules.some(
    (rule) => (rule.name === 'tipRule' || rule.name === 'devTipRule') && rule.value.trim() !== ''
  );
}

function isTruthy(value: string): boolean {
  return ['true', '1', 'yes'].includes(value.trim().toLocaleLowerCase());
}
