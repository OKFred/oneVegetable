import { parseFragment, serialize } from 'parse5';

import { PRODUCT_DESCRIPTION_TAGS } from './product-description-contract';
import { productDescriptionSanitizationMessage } from './product-description-messages';
import { isPhotoBankUrl } from './product-description-url';

import type { DefaultTreeAdapterTypes, Token } from 'parse5';
import type { UiLocale } from './preferences';
import type {
  ProductDescriptionSanitizationChange,
  SanitizedProductDescription
} from './product-description-contract';

export * from './product-description-contract';
export { isPhotoBankUrl } from './product-description-url';

const ALLOWED_TAGS = new Set<string>(PRODUCT_DESCRIPTION_TAGS);
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button'
]);
const ALLOWED_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set([
    'src',
    'alt',
    'title',
    'data-photobank-file-id',
    'data-photobank-width',
    'data-photobank-height'
  ]),
  th: new Set(['colspan', 'rowspan']),
  td: new Set(['colspan', 'rowspan'])
};

export function sanitizeProductDescriptionHtml(
  html: string,
  locale: UiLocale = 'zh-CN'
): SanitizedProductDescription {
  const fragment = parseFragment(html);
  const changes: ProductDescriptionSanitizationChange[] = [];
  sanitizeChildren(fragment, changes, locale);
  return { html: serialize(fragment), supported: changes.length === 0, changes };
}

function sanitizeChildren(
  parent: DefaultTreeAdapterTypes.ParentNode,
  changes: ProductDescriptionSanitizationChange[],
  locale: UiLocale
): void {
  for (let index = 0; index < parent.childNodes.length;) {
    const child = parent.childNodes[index];
    if (!child || !isElement(child)) {
      index += 1;
      continue;
    }
    index += sanitizeElement(parent, index, child, changes, locale);
  }
}

function sanitizeElement(
  parent: DefaultTreeAdapterTypes.ParentNode,
  index: number,
  element: DefaultTreeAdapterTypes.Element,
  changes: ProductDescriptionSanitizationChange[],
  locale: UiLocale
): number {
  const tag = element.tagName.toLocaleLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    if (DROP_WITH_CONTENT.has(tag)) {
      changes.push({
        type: 'removed-element',
        target: tag,
        detail: productDescriptionSanitizationMessage(locale, 'removedElement', { tag })
      });
      parent.childNodes.splice(index, 1);
      return 0;
    }
    changes.push({
      type: 'unwrapped-element',
      target: tag,
      detail: productDescriptionSanitizationMessage(locale, 'unwrappedElement', { tag })
    });
    sanitizeChildren(element, changes, locale);
    for (const child of element.childNodes) child.parentNode = parent;
    parent.childNodes.splice(index, 1, ...element.childNodes);
    return element.childNodes.length;
  }

  sanitizeAttributes(element, tag, changes, locale);
  if (tag === 'a') sanitizeLink(element, changes, locale);
  if (tag === 'img' && !sanitizeImage(parent, index, element, changes, locale)) return 0;
  sanitizeChildren(element, changes, locale);
  return 1;
}

function sanitizeAttributes(
  element: DefaultTreeAdapterTypes.Element,
  tag: string,
  changes: ProductDescriptionSanitizationChange[],
  locale: UiLocale
): void {
  const allowed = ALLOWED_ATTRIBUTES[tag] ?? new Set<string>();
  const safeAttributes: Token.Attribute[] = [];
  for (const attribute of element.attrs) {
    const name = attribute.name.toLocaleLowerCase();
    if (allowed.has(name)) {
      safeAttributes.push(attribute);
      continue;
    }
    changes.push({
      type: 'removed-attribute',
      target: `${tag}.${attribute.name}`,
      detail: productDescriptionSanitizationMessage(locale, 'removedAttribute', {
        tag,
        attribute: attribute.name
      })
    });
  }
  element.attrs = safeAttributes;
}

function sanitizeLink(
  element: DefaultTreeAdapterTypes.Element,
  changes: ProductDescriptionSanitizationChange[],
  locale: UiLocale
): void {
  const href = getAttribute(element, 'href');
  if (!href || !isHttpUrl(href)) {
    if (href) {
      changes.push({
        type: 'removed-url',
        target: 'a.href',
        detail: productDescriptionSanitizationMessage(locale, 'removedUrl', { url: href })
      });
      removeAttribute(element, 'href');
    }
    removeAttribute(element, 'target');
    removeAttribute(element, 'rel');
    return;
  }
  const requiredRel = 'nofollow noopener noreferrer';
  if (getAttribute(element, 'rel') !== requiredRel || getAttribute(element, 'target') !== '_blank') {
    changes.push({
      type: 'secured-link',
      target: 'a',
      detail: productDescriptionSanitizationMessage(locale, 'securedLink')
    });
  }
  setAttribute(element, 'target', '_blank');
  setAttribute(element, 'rel', requiredRel);
}

function sanitizeImage(
  parent: DefaultTreeAdapterTypes.ParentNode,
  index: number,
  element: DefaultTreeAdapterTypes.Element,
  changes: ProductDescriptionSanitizationChange[],
  locale: UiLocale
): boolean {
  const src = getAttribute(element, 'src') ?? '';
  if (isPhotoBankUrl(src)) return true;
  changes.push({
    type: 'removed-url',
    target: 'img.src',
    detail: src
      ? productDescriptionSanitizationMessage(locale, 'externalImage', { url: src })
      : productDescriptionSanitizationMessage(locale, 'missingImage')
  });
  parent.childNodes.splice(index, 1);
  return false;
}

function isElement(node: DefaultTreeAdapterTypes.ChildNode): node is DefaultTreeAdapterTypes.Element {
  return 'tagName' in node;
}

function getAttribute(element: DefaultTreeAdapterTypes.Element, name: string): string | null {
  return element.attrs.find((attribute) => attribute.name === name)?.value ?? null;
}

function removeAttribute(element: DefaultTreeAdapterTypes.Element, name: string): void {
  element.attrs = element.attrs.filter((attribute) => attribute.name !== name);
}

function setAttribute(element: DefaultTreeAdapterTypes.Element, name: string, value: string): void {
  const attribute = element.attrs.find((candidate) => candidate.name === name);
  if (attribute) {
    attribute.value = value;
    return;
  }
  element.attrs.push({ name, value });
}

function isHttpUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
