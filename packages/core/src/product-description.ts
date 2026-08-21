export const PRODUCT_DESCRIPTION_TAGS = [
  'p',
  'br',
  'h2',
  'h3',
  'h4',
  'strong',
  'em',
  'u',
  'ul',
  'ol',
  'li',
  'blockquote',
  'table',
  'tbody',
  'tr',
  'th',
  'td',
  'a',
  'img',
  'hr'
] as const;

export interface ProductDescriptionSanitizationChange {
  type: 'removed-element' | 'unwrapped-element' | 'removed-attribute' | 'removed-url' | 'secured-link';
  target: string;
  detail: string;
}

export interface SanitizedProductDescription {
  html: string;
  supported: boolean;
  changes: ProductDescriptionSanitizationChange[];
}

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
  const fragment = parseFragment(html);
  const changes: ProductDescriptionSanitizationChange[] = [];
  sanitizeChildren(fragment, changes);
  return { html: serialize(fragment), supported: changes.length === 0, changes };
}

export function isPhotoBankUrl(rawUrl: string): boolean {
  try {
    const normalized = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
    const url = new URL(normalized);
    const hostname = url.hostname.toLocaleLowerCase();
    return url.protocol === 'https:' && (hostname === 'alicdn.com' || hostname.endsWith('.alicdn.com'));
  } catch {
    return false;
  }
}

function sanitizeChildren(
  parent: DefaultTreeAdapterTypes.ParentNode,
  changes: ProductDescriptionSanitizationChange[]
): void {
  for (let index = 0; index < parent.childNodes.length;) {
    const child = parent.childNodes[index];
    if (!child || !isElement(child)) {
      index += 1;
      continue;
    }
    index += sanitizeElement(parent, index, child, changes);
  }
}

function sanitizeElement(
  parent: DefaultTreeAdapterTypes.ParentNode,
  index: number,
  element: DefaultTreeAdapterTypes.Element,
  changes: ProductDescriptionSanitizationChange[]
): number {
  const tag = element.tagName.toLocaleLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    if (DROP_WITH_CONTENT.has(tag)) {
      changes.push({ type: 'removed-element', target: tag, detail: `删除不允许的 <${tag}> 元素及内容` });
      parent.childNodes.splice(index, 1);
      return 0;
    }
    changes.push({ type: 'unwrapped-element', target: tag, detail: `删除 <${tag}> 标签，保留其中内容` });
    sanitizeChildren(element, changes);
    for (const child of element.childNodes) child.parentNode = parent;
    parent.childNodes.splice(index, 1, ...element.childNodes);
    return element.childNodes.length;
  }

  sanitizeAttributes(element, tag, changes);
  if (tag === 'a') sanitizeLink(element, changes);
  if (tag === 'img' && !sanitizeImage(parent, index, element, changes)) return 0;
  sanitizeChildren(element, changes);
  return 1;
}

function sanitizeAttributes(
  element: DefaultTreeAdapterTypes.Element,
  tag: string,
  changes: ProductDescriptionSanitizationChange[]
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
      detail: `删除 <${tag}> 的 ${attribute.name} 属性`
    });
  }
  element.attrs = safeAttributes;
}

function sanitizeLink(
  element: DefaultTreeAdapterTypes.Element,
  changes: ProductDescriptionSanitizationChange[]
): void {
  const href = getAttribute(element, 'href');
  if (!href || !isHttpUrl(href)) {
    if (href) {
      changes.push({ type: 'removed-url', target: 'a.href', detail: `删除不安全链接 ${href}` });
      removeAttribute(element, 'href');
    }
    removeAttribute(element, 'target');
    removeAttribute(element, 'rel');
    return;
  }
  const requiredRel = 'nofollow noopener noreferrer';
  if (getAttribute(element, 'rel') !== requiredRel || getAttribute(element, 'target') !== '_blank') {
    changes.push({ type: 'secured-link', target: 'a', detail: '链接已增加安全 rel 并在新窗口打开' });
  }
  setAttribute(element, 'target', '_blank');
  setAttribute(element, 'rel', requiredRel);
}

function sanitizeImage(
  parent: DefaultTreeAdapterTypes.ParentNode,
  index: number,
  element: DefaultTreeAdapterTypes.Element,
  changes: ProductDescriptionSanitizationChange[]
): boolean {
  const src = getAttribute(element, 'src') ?? '';
  if (isPhotoBankUrl(src)) return true;
  changes.push({
    type: 'removed-url',
    target: 'img.src',
    detail: src ? `删除非国际站图库图片 ${src}` : '删除缺少地址的图片'
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
import { parseFragment, serialize } from 'parse5';

import type { DefaultTreeAdapterTypes, Token } from 'parse5';
