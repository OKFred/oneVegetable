import { PRODUCT_DESCRIPTION_TAGS } from './product-description-contract';
import { productDescriptionSanitizationMessage } from './product-description-messages';
import { isPhotoBankUrl } from './product-description-url';

import type {
  ProductDescriptionSanitizationChange,
  SanitizedProductDescription
} from './product-description-contract';
import type { UiLocale } from './preferences';

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
  const document = new DOMParser().parseFromString(html, 'text/html');
  const changes: ProductDescriptionSanitizationChange[] = [];
  sanitizeChildren(document.body, changes, locale);
  return { html: document.body.innerHTML, supported: changes.length === 0, changes };
}

function sanitizeChildren(
  parent: ParentNode,
  changes: ProductDescriptionSanitizationChange[],
  locale: UiLocale
): void {
  for (const child of Array.from(parent.children)) sanitizeElement(child, changes, locale);
}

function sanitizeElement(
  element: Element,
  changes: ProductDescriptionSanitizationChange[],
  locale: UiLocale
): void {
  const tag = element.tagName.toLocaleLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    if (DROP_WITH_CONTENT.has(tag)) {
      changes.push({
        type: 'removed-element',
        target: tag,
        detail: productDescriptionSanitizationMessage(locale, 'removedElement', { tag })
      });
      element.remove();
      return;
    }
    changes.push({
      type: 'unwrapped-element',
      target: tag,
      detail: productDescriptionSanitizationMessage(locale, 'unwrappedElement', { tag })
    });
    sanitizeChildren(element, changes, locale);
    element.replaceWith(...Array.from(element.childNodes));
    return;
  }

  sanitizeAttributes(element, tag, changes, locale);
  if (tag === 'a') sanitizeLink(element, changes, locale);
  if (tag === 'img' && !sanitizeImage(element, changes, locale)) return;
  sanitizeChildren(element, changes, locale);
}

function sanitizeAttributes(
  element: Element,
  tag: string,
  changes: ProductDescriptionSanitizationChange[],
  locale: UiLocale
): void {
  const allowed = ALLOWED_ATTRIBUTES[tag] ?? new Set<string>();
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLocaleLowerCase();
    if (allowed.has(name)) continue;
    changes.push({
      type: 'removed-attribute',
      target: `${tag}.${attribute.name}`,
      detail: productDescriptionSanitizationMessage(locale, 'removedAttribute', {
        tag,
        attribute: attribute.name
      })
    });
    element.removeAttribute(attribute.name);
  }
}

function sanitizeLink(
  element: Element,
  changes: ProductDescriptionSanitizationChange[],
  locale: UiLocale
): void {
  const href = element.getAttribute('href');
  if (!href || !isHttpUrl(href)) {
    if (href) {
      changes.push({
        type: 'removed-url',
        target: 'a.href',
        detail: productDescriptionSanitizationMessage(locale, 'removedUrl', { url: href })
      });
      element.removeAttribute('href');
    }
    element.removeAttribute('target');
    element.removeAttribute('rel');
    return;
  }
  const requiredRel = 'nofollow noopener noreferrer';
  if (element.getAttribute('rel') !== requiredRel || element.getAttribute('target') !== '_blank') {
    changes.push({
      type: 'secured-link',
      target: 'a',
      detail: productDescriptionSanitizationMessage(locale, 'securedLink')
    });
  }
  element.setAttribute('target', '_blank');
  element.setAttribute('rel', requiredRel);
}

function sanitizeImage(
  element: Element,
  changes: ProductDescriptionSanitizationChange[],
  locale: UiLocale
): boolean {
  const src = element.getAttribute('src') ?? '';
  if (isPhotoBankUrl(src)) return true;
  changes.push({
    type: 'removed-url',
    target: 'img.src',
    detail: src
      ? productDescriptionSanitizationMessage(locale, 'externalImage', { url: src })
      : productDescriptionSanitizationMessage(locale, 'missingImage')
  });
  element.remove();
  return false;
}

function isHttpUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
