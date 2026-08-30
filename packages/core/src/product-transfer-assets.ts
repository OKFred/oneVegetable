import { parseFragment, serialize } from 'parse5';

import {
  isProductSchemaHtmlField,
  isProductSchemaImageField,
  type ProductSchemaField,
  type ProductSchemaModel,
  type ProductSchemaValue,
  type ProductSchemaValueMetadata
} from './product-schema';

import type { DefaultTreeAdapterTypes } from 'parse5';

export const PRODUCT_TRANSFER_ASSET_DIRECTORY = 'assets/';

export type ProductTransferAssetReferenceKind = 'schema-value' | 'description-image';

export interface ProductTransferAssetReference {
  source: string;
  fieldKey: string;
  fieldId: string;
  fieldName: string;
  kind: ProductTransferAssetReferenceKind;
}

export interface ProductTransferAssetReplacement {
  url: string;
  fileId: string | null;
  fileName?: string;
  groupId?: string;
  width?: number | null;
  height?: number | null;
  fileSize?: number;
}

export function collectProductSchemaAssetReferences(
  model: ProductSchemaModel
): ProductTransferAssetReference[] {
  const references: ProductTransferAssetReference[] = [];
  visitFields(model.fields, (field) => {
    if (isProductSchemaHtmlField(field)) {
      for (const value of field.values) {
        for (const source of collectHtmlImageSources(value.text)) {
          references.push(reference(field, source, 'description-image'));
        }
      }
      return;
    }
    if (!isTransferImageField(field)) return;
    for (const value of field.values) {
      const source = normalizeTransferAssetSource(value.text);
      if (source) references.push(reference(field, source, 'schema-value'));
    }
  });
  return references;
}

export function replaceProductSchemaAssetReferences(
  model: ProductSchemaModel,
  replacements: ReadonlyMap<string, ProductTransferAssetReplacement>
): ProductSchemaModel {
  return {
    ...model,
    fields: model.fields.map((field) => rewriteField(field, replacements))
  };
}

export function normalizeProductTransferAssetPath(value: string): string | null {
  const path = value.trim();
  if (!path.startsWith(PRODUCT_TRANSFER_ASSET_DIRECTORY)) return null;
  if (
    path.length <= PRODUCT_TRANSFER_ASSET_DIRECTORY.length ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.includes('?') ||
    path.includes('#')
  ) {
    return null;
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (decoded !== path || decoded.includes('\\')) return null;
  return path;
}

export function normalizeRemoteProductAssetUrl(value: string): string | null {
  const normalized = value.trim().startsWith('//') ? `https:${value.trim()}` : value.trim();
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function rewriteField(
  field: ProductSchemaField,
  replacements: ReadonlyMap<string, ProductTransferAssetReplacement>
): ProductSchemaField {
  const values = field.values.map((value) => {
    if (isProductSchemaHtmlField(field)) {
      const html = replaceHtmlImages(value.text, replacements);
      if (html === value.text) return value;
      return { ...value, text: html };
    }
    if (!isTransferImageField(field)) return value;
    const source = normalizeTransferAssetSource(value.text);
    const replacement = source ? replacements.get(source) : undefined;
    if (!replacement) return value;
    return replaceSchemaValue(value, replacement);
  });
  const instances = field.instances.map((instance) => ({
    ...instance,
    fields: instance.fields.map((child) => rewriteField(child, replacements))
  }));
  const children = field.children.map((child) => rewriteField(child, replacements));
  return { ...field, values, instances, children };
}

function replaceSchemaValue(
  value: ProductSchemaValue,
  replacement: ProductTransferAssetReplacement
): ProductSchemaValue {
  const attributes = { ...value.attributes };
  if (replacement.fileId) attributes.fileId = replacement.fileId;
  else delete attributes.fileId;
  const metadata: ProductSchemaValueMetadata = {};
  if (replacement.fileName) metadata.fileName = replacement.fileName;
  if (replacement.groupId) metadata.groupId = replacement.groupId;
  const width = numberText(replacement.width);
  const height = numberText(replacement.height);
  const fileSize = numberText(replacement.fileSize);
  if (width) metadata.width = width;
  if (height) metadata.height = height;
  if (fileSize) metadata.fileSize = fileSize;
  return { text: replacement.url, attributes, metadata };
}

function replaceHtmlImages(
  html: string,
  replacements: ReadonlyMap<string, ProductTransferAssetReplacement>
): string {
  const fragment = parseFragment(html);
  const changed = replaceHtmlImageElements(fragment, replacements);
  return changed ? serialize(fragment) : html;
}

function replaceHtmlImageElements(
  parent: DefaultTreeAdapterTypes.ParentNode,
  replacements: ReadonlyMap<string, ProductTransferAssetReplacement>
): boolean {
  let changed = false;
  for (const child of parent.childNodes) {
    if (!('tagName' in child)) continue;
    if (child.tagName.toLocaleLowerCase() === 'img') {
      const source = normalizeTransferAssetSource(readHtmlAttribute(child, 'src') ?? '');
      const replacement = source ? replacements.get(source) : undefined;
      if (replacement) {
        changed = true;
        writeHtmlAttribute(child, 'src', replacement.url);
        if (replacement.fileId) writeHtmlAttribute(child, 'data-photobank-file-id', replacement.fileId);
        else removeHtmlAttribute(child, 'data-photobank-file-id');
        writeOptionalHtmlAttribute(child, 'data-photobank-width', numberText(replacement.width));
        writeOptionalHtmlAttribute(child, 'data-photobank-height', numberText(replacement.height));
      }
    }
    changed = replaceHtmlImageElements(child, replacements) || changed;
  }
  return changed;
}

function collectHtmlImageSources(html: string): string[] {
  const sources: string[] = [];
  const fragment = parseFragment(html);
  visitHtmlElements(fragment, (element) => {
    if (element.tagName.toLocaleLowerCase() !== 'img') return;
    const source = normalizeTransferAssetSource(readHtmlAttribute(element, 'src') ?? '');
    if (source) sources.push(source);
  });
  return sources;
}

function normalizeTransferAssetSource(value: string): string | null {
  return normalizeProductTransferAssetPath(value) ?? normalizeRemoteProductAssetUrl(value);
}

function isTransferImageField(field: ProductSchemaField): boolean {
  const identity = `${field.id} ${field.name}`.toLocaleLowerCase();
  return !identity.includes('video') && !identity.includes('视频') && isProductSchemaImageField(field);
}

function visitFields(
  fields: readonly ProductSchemaField[],
  visit: (field: ProductSchemaField) => void
): void {
  for (const field of fields) {
    visit(field);
    for (const instance of field.instances) visitFields(instance.fields, visit);
  }
}

function visitHtmlElements(
  parent: DefaultTreeAdapterTypes.ParentNode,
  visit: (element: DefaultTreeAdapterTypes.Element) => void
): void {
  for (const child of parent.childNodes) {
    if (!('tagName' in child)) continue;
    visit(child);
    visitHtmlElements(child, visit);
  }
}

function reference(
  field: ProductSchemaField,
  source: string,
  kind: ProductTransferAssetReferenceKind
): ProductTransferAssetReference {
  return { source, fieldKey: field.key, fieldId: field.id, fieldName: field.name, kind };
}

function readHtmlAttribute(element: DefaultTreeAdapterTypes.Element, name: string): string | null {
  return element.attrs.find((attribute) => attribute.name === name)?.value ?? null;
}

function writeHtmlAttribute(element: DefaultTreeAdapterTypes.Element, name: string, value: string): void {
  const current = element.attrs.find((attribute) => attribute.name === name);
  if (current) current.value = value;
  else element.attrs.push({ name, value });
}

function removeHtmlAttribute(element: DefaultTreeAdapterTypes.Element, name: string): void {
  element.attrs = element.attrs.filter((attribute) => attribute.name !== name);
}

function writeOptionalHtmlAttribute(
  element: DefaultTreeAdapterTypes.Element,
  name: string,
  value: string | undefined
): void {
  if (value) writeHtmlAttribute(element, name, value);
  else removeHtmlAttribute(element, name);
}

function numberText(value: number | null | undefined): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(value) : undefined;
}
