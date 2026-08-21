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
