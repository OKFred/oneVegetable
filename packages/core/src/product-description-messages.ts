import type { UiLocale } from './preferences';

const PRODUCT_DESCRIPTION_SANITIZATION_MESSAGES = {
  'zh-CN': {
    removedElement: '删除不允许的 <{tag}> 元素及内容',
    unwrappedElement: '删除 <{tag}> 标签，保留其中内容',
    removedAttribute: '删除 <{tag}> 的 {attribute} 属性',
    removedUrl: '删除不安全链接 {url}',
    securedLink: '链接已增加安全 rel 并在新窗口打开',
    externalImage: '删除非国际站图库图片 {url}',
    missingImage: '删除缺少地址的图片'
  },
  'en-US': {
    removedElement: 'Removed disallowed <{tag}> element and its content',
    unwrappedElement: 'Removed <{tag}> while retaining its content',
    removedAttribute: 'Removed {attribute} attribute from <{tag}>',
    removedUrl: 'Removed unsafe link {url}',
    securedLink: 'Added safe rel attributes and opened the link in a new window',
    externalImage: 'Removed image outside the Alibaba.com gallery: {url}',
    missingImage: 'Removed image with no source URL'
  }
} as const satisfies Record<UiLocale, Record<string, string>>;

export type ProductDescriptionSanitizationMessageKey =
  keyof (typeof PRODUCT_DESCRIPTION_SANITIZATION_MESSAGES)['zh-CN'];

export function productDescriptionSanitizationMessage(
  locale: UiLocale,
  key: ProductDescriptionSanitizationMessageKey,
  values: Readonly<Record<string, string | number>> = {}
): string {
  return Object.entries(values).reduce<string>(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    PRODUCT_DESCRIPTION_SANITIZATION_MESSAGES[locale][key]
  );
}
