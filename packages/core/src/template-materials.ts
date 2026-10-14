import { parseFragment, serialize, type DefaultTreeAdapterTypes } from 'parse5';
import { sanitizeProductDescriptionHtml } from './product-description';
import { isPhotoBankUrl } from './product-description-url';
import { validateProductDescriptionTemplateMaterialBundle } from './generated/validators-templates';
import {
  parseTemplateBundle,
  templateError,
  TEMPLATE_HTML_MAX_BYTES,
  type PortableTemplate,
  type TemplateBundle
} from './template-library';
import type { components } from './generated/api';

export type TemplateMaterialAsset = components['schemas']['ProductDescriptionTemplateMaterial'];
export type TemplateMaterialDocument = components['schemas']['ProductDescriptionTemplateMaterialBundle'];
export interface TemplateMaterialPackage {
  document: TemplateMaterialDocument;
  assets: { path: string; bytes: Uint8Array }[];
}
export const TEMPLATE_MATERIAL_MAX_ZIP_BYTES = 50 * 1024 * 1024;
export const TEMPLATE_MATERIAL_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
export const TEMPLATE_MATERIAL_MAX_ASSETS = 500;
export const TEMPLATE_MATERIAL_MAX_MANIFEST_BYTES = 5 * 1024 * 1024;
const PATH = /^assets\/([a-f0-9]{64})\.(jpg|jpeg|png|gif|bmp)$/u;
const PLACEHOLDER_ORIGIN = 'https://s.alicdn.com/onevegetable-template-material/';
const encoder = new TextEncoder();
type Element = DefaultTreeAdapterTypes.Element;

function images(html: string, visit: (element: Element) => void): DefaultTreeAdapterTypes.DocumentFragment {
  const fragment = parseFragment(html);
  function walk(parent: DefaultTreeAdapterTypes.ParentNode): void {
    for (const child of parent.childNodes) {
      if (!('tagName' in child)) continue;
      if (child.tagName === 'img') visit(child);
      walk(child);
    }
  }
  walk(fragment);
  return fragment;
}
function source(element: Element): string {
  return element.attrs.find((attribute) => attribute.name === 'src')?.value.trim() ?? '';
}
function setSource(element: Element, value: string, fileId?: string): void {
  element.attrs = element.attrs.filter(
    (attribute) => attribute.name !== 'src' && !attribute.name.startsWith('data-photobank-')
  );
  element.attrs.push({ name: 'src', value });
  if (fileId) element.attrs.push({ name: 'data-photobank-file-id', value: fileId });
}
export function templateMaterialPathValid(value: string): boolean {
  return PATH.test(value);
}
export function templateMaterialPath(sha256: string, extension: string): string {
  const path = `assets/${sha256}.${extension}`;
  if (!PATH.test(path)) throw templateError('TEMPLATE_MATERIAL_PATH_INVALID');
  return path;
}
export function templateImageSources(templates: readonly Pick<PortableTemplate, 'html'>[]): string[] {
  const sources = new Set<string>();
  for (const template of templates) {
    images(template.html, (element) => {
      const value = source(element);
      if (!isPhotoBankUrl(value)) throw templateError('TEMPLATE_MATERIAL_SOURCE_UNSUPPORTED');
      const url = new URL(value.startsWith('//') ? `https:${value}` : value);
      if (url.username || url.password || url.hash)
        throw templateError('TEMPLATE_MATERIAL_SOURCE_UNSUPPORTED');
      sources.add(url.href);
    });
  }
  return [...sources];
}

/** No original URL, fileId or account-specific image metadata goes into the portable package. */
export function templatesWithMaterialPaths(
  templates: readonly PortableTemplate[],
  replacements: ReadonlyMap<string, string>
): PortableTemplate[] {
  return templates.map((template) => {
    const fragment = images(template.html, (element) => {
      const value = source(element);
      const key = new URL(value.startsWith('//') ? `https:${value}` : value).href;
      const path = replacements.get(key);
      if (!path || !PATH.test(path)) throw templateError('TEMPLATE_MATERIAL_MISSING');
      setSource(element, path);
    });
    return { ...template, html: sanitizeMaterialHtml(serialize(fragment)) };
  });
}
function sanitizeMaterialHtml(html: string): string {
  const original = images(html, (element) => {
    const path = source(element);
    if (!PATH.test(path)) throw templateError('TEMPLATE_MATERIAL_PATH_INVALID');
    setSource(element, `${PLACEHOLDER_ORIGIN}${path}`);
  });
  const safe = sanitizeProductDescriptionHtml(serialize(original)).html;
  const fragment = images(safe, (element) => {
    const value = source(element);
    if (!value.startsWith(PLACEHOLDER_ORIGIN)) throw templateError('TEMPLATE_MATERIAL_PATH_INVALID');
    const path = value.slice(PLACEHOLDER_ORIGIN.length);
    if (!PATH.test(path)) throw templateError('TEMPLATE_MATERIAL_PATH_INVALID');
    setSource(element, path);
  });
  return serialize(fragment);
}
export function parseTemplateMaterialDocument(bytes: Uint8Array): TemplateMaterialDocument {
  if (bytes.length > TEMPLATE_MATERIAL_MAX_MANIFEST_BYTES)
    throw templateError('TEMPLATE_MATERIAL_MANIFEST_TOO_LARGE');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw templateError('TEMPLATE_MATERIAL_INVALID');
  }
  if (!validateProductDescriptionTemplateMaterialBundle(value))
    throw templateError('TEMPLATE_MATERIAL_INVALID');
  const document = value as TemplateMaterialDocument;
  if (!Number.isSafeInteger(document.exportedAtUtc)) throw templateError('TEMPLATE_MATERIAL_INVALID');
  const metadata = new Map<string, TemplateMaterialAsset>();
  const hashes = new Set<string>();
  for (const asset of document.assets) {
    if (metadata.has(asset.path) || hashes.has(asset.sha256) || PATH.exec(asset.path)?.[1] !== asset.sha256)
      throw templateError('TEMPLATE_MATERIAL_INVALID');
    metadata.set(asset.path, asset);
    hashes.add(asset.sha256);
  }
  const referenced = new Set<string>();
  const templates: PortableTemplate[] = [];
  for (const template of document.templates) {
    if (!template.name.trim() || encoder.encode(template.html).length > TEMPLATE_HTML_MAX_BYTES)
      throw templateError('TEMPLATE_MATERIAL_INVALID');
    const safe = sanitizeMaterialHtml(template.html);
    images(safe, (element) => {
      const path = source(element);
      if (!PATH.test(path) || !metadata.has(path)) throw templateError('TEMPLATE_MATERIAL_MISSING');
      referenced.add(path);
    });
    templates.push({ ...template, html: safe });
  }
  if (referenced.size !== metadata.size) throw templateError('TEMPLATE_MATERIAL_UNREFERENCED');
  return { ...document, templates };
}
export function templateMaterialManifest(document: TemplateMaterialDocument): Uint8Array {
  const bytes = encoder.encode(JSON.stringify(document, null, 2));
  return encoder.encode(JSON.stringify(parseTemplateMaterialDocument(bytes), null, 2));
}
export interface TemplateMaterialPhoto {
  url: string;
  fileId: string;
}
export function templateMaterialResolvedBundle(
  document: TemplateMaterialDocument,
  photos: ReadonlyMap<string, TemplateMaterialPhoto>
): TemplateBundle {
  const templates = document.templates.map((template) => {
    const fragment = images(template.html, (element) => {
      const photo = photos.get(source(element));
      if (!photo?.fileId || !isPhotoBankUrl(photo.url)) throw templateError('TEMPLATE_MATERIAL_UNCONFIRMED');
      setSource(element, photo.url, photo.fileId);
    });
    return { ...template, html: sanitizeProductDescriptionHtml(serialize(fragment)).html };
  });
  return parseTemplateBundle(
    encoder.encode(
      JSON.stringify({
        kind: 'oneVegetable.product-description-templates',
        schemaVersion: 1,
        exportedAtUtc: document.exportedAtUtc,
        templates
      })
    )
  );
}
