import { PRODUCT_DESCRIPTION_TAGS } from './product-description-contract';
import { isPhotoBankUrl } from './product-description-url';

import type {
  ProductDescriptionSanitizationChange,
  SanitizedProductDescription
} from './product-description-contract';

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

export function sanitizeProductDescriptionHtml(html: string): SanitizedProductDescription {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const changes: ProductDescriptionSanitizationChange[] = [];
  sanitizeChildren(document.body, changes);
  return { html: document.body.innerHTML, supported: changes.length === 0, changes };
}

function sanitizeChildren(parent: ParentNode, changes: ProductDescriptionSanitizationChange[]): void {
  for (const child of Array.from(parent.children)) sanitizeElement(child, changes);
}

function sanitizeElement(element: Element, changes: ProductDescriptionSanitizationChange[]): void {
  const tag = element.tagName.toLocaleLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    if (DROP_WITH_CONTENT.has(tag)) {
      changes.push({ type: 'removed-element', target: tag, detail: `删除不允许的 <${tag}> 元素及内容` });
      element.remove();
      return;
    }
    changes.push({ type: 'unwrapped-element', target: tag, detail: `删除 <${tag}> 标签，保留其中内容` });
    sanitizeChildren(element, changes);
    element.replaceWith(...Array.from(element.childNodes));
    return;
  }

  sanitizeAttributes(element, tag, changes);
  if (tag === 'a') sanitizeLink(element, changes);
  if (tag === 'img' && !sanitizeImage(element, changes)) return;
  sanitizeChildren(element, changes);
}

function sanitizeAttributes(
  element: Element,
  tag: string,
  changes: ProductDescriptionSanitizationChange[]
): void {
  const allowed = ALLOWED_ATTRIBUTES[tag] ?? new Set<string>();
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLocaleLowerCase();
    if (allowed.has(name)) continue;
    changes.push({
      type: 'removed-attribute',
      target: `${tag}.${attribute.name}`,
      detail: `删除 <${tag}> 的 ${attribute.name} 属性`
    });
    element.removeAttribute(attribute.name);
  }
}

function sanitizeLink(element: Element, changes: ProductDescriptionSanitizationChange[]): void {
  const href = element.getAttribute('href');
  if (!href || !isHttpUrl(href)) {
    if (href) {
      changes.push({ type: 'removed-url', target: 'a.href', detail: `删除不安全链接 ${href}` });
      element.removeAttribute('href');
    }
    element.removeAttribute('target');
    element.removeAttribute('rel');
    return;
  }
  const requiredRel = 'nofollow noopener noreferrer';
  if (element.getAttribute('rel') !== requiredRel || element.getAttribute('target') !== '_blank') {
    changes.push({ type: 'secured-link', target: 'a', detail: '链接已增加安全 rel 并在新窗口打开' });
  }
  element.setAttribute('target', '_blank');
  element.setAttribute('rel', requiredRel);
}

function sanitizeImage(element: Element, changes: ProductDescriptionSanitizationChange[]): boolean {
  const src = element.getAttribute('src') ?? '';
  if (isPhotoBankUrl(src)) return true;
  changes.push({
    type: 'removed-url',
    target: 'img.src',
    detail: src ? `删除非国际站图库图片 ${src}` : '删除缺少地址的图片'
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
