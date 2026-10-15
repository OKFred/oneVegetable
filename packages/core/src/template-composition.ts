import { sanitizeProductDescriptionHtml } from './product-description-browser';
import type { ProductSchemaField, ProductSchemaModel } from './product-schema';
import type { UiLocale } from './preferences';

/** Text substitution only: never evaluate expressions or substitute URLs/HTML attributes. */
export const DESCRIPTION_TEMPLATE_VARIABLES = [
  'productName',
  'model',
  'packaging',
  'leadTime',
  'companyName',
  'shippingOrigin'
] as const;
export type DescriptionTemplateVariable = (typeof DESCRIPTION_TEMPLATE_VARIABLES)[number];
export type DescriptionTemplateValues = Partial<Record<DescriptionTemplateVariable, string>>;
export const DESCRIPTION_COMPOSITION_MAX_TEMPLATES = 10;
export const DESCRIPTION_COMPOSITION_MAX_BYTES = 256 * 1024;
export const DESCRIPTION_VARIABLE_MAX_CHARACTERS = 2000;

export interface DescriptionTemplateFragment {
  id: string;
  html: string;
}
export interface DescriptionTemplateComposition {
  html: string;
  variables: DescriptionTemplateVariable[];
  missing: DescriptionTemplateVariable[];
  unsupported: string[];
  attributeVariables: string[];
  oversizedValues: DescriptionTemplateVariable[];
  sanitizedChanges: number;
  tooLarge: boolean;
  tooMany: boolean;
  canApply: boolean;
}

const TOKEN = /\{\{\s*([^{}]{1,80}?)\s*\}\}/gu;
const VARIABLE_IDS = new Set<string>(DESCRIPTION_TEMPLATE_VARIABLES);
export function descriptionTemplateToken(variable: DescriptionTemplateVariable): string {
  return `{{${variable}}}`;
}

/** DOM text-node replacement keeps all supplied values literal, including markup and braces. */
export function composeDescriptionTemplates(
  templates: readonly DescriptionTemplateFragment[],
  values: DescriptionTemplateValues,
  locale: UiLocale = 'zh-CN'
): DescriptionTemplateComposition {
  const variables = new Set<DescriptionTemplateVariable>();
  const missing = new Set<DescriptionTemplateVariable>();
  const unsupported = new Set<string>();
  const attributeVariables = new Set<string>();
  const oversizedValues = new Set<DescriptionTemplateVariable>();
  let sanitizedChanges = 0;
  let tooLarge = false;
  const encoder = new TextEncoder();
  const byteLength = (text: string) => encoder.encode(text).byteLength;
  let composedBytes = 0;
  const parts: string[] = [];
  const tooMany = templates.length > DESCRIPTION_COMPOSITION_MAX_TEMPLATES;
  for (const template of templates.slice(0, DESCRIPTION_COMPOSITION_MAX_TEMPLATES)) {
    if (
      composedBytes > DESCRIPTION_COMPOSITION_MAX_BYTES ||
      byteLength(template.html) > DESCRIPTION_COMPOSITION_MAX_BYTES
    ) {
      tooLarge = true;
      break;
    }
    const raw = new DOMParser().parseFromString(template.html, 'text/html');
    for (const element of raw.body.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        if (Array.from(attribute.value.matchAll(TOKEN)).length > 0)
          attributeVariables.add(`${element.tagName.toLowerCase()}.${attribute.name}`);
      }
    }
    const safe = sanitizeProductDescriptionHtml(template.html, locale);
    sanitizedChanges += safe.changes.length;
    composedBytes += byteLength(safe.html);
    if (composedBytes > DESCRIPTION_COMPOSITION_MAX_BYTES) {
      tooLarge = true;
      break;
    }
    const document = new DOMParser().parseFromString(safe.html, 'text/html');
    const walker = document.createTreeWalker(document.body, 4 /* SHOW_TEXT */);
    let node = walker.nextNode();
    while (node) {
      node.textContent = (node.textContent ?? '').replace(TOKEN, (token: string, rawKey: string) => {
        if (tooLarge) return token;
        const key = rawKey.trim();
        if (!VARIABLE_IDS.has(key)) {
          unsupported.add(key);
          return token;
        }
        const variable = key as DescriptionTemplateVariable;
        variables.add(variable);
        const value = values[variable]?.trim();
        if (!value) {
          missing.add(variable);
          return token;
        }
        if (Array.from(value).length > DESCRIPTION_VARIABLE_MAX_CHARACTERS) {
          oversizedValues.add(variable);
          return token;
        }
        // Bound expansion before constructing a potentially huge text node.
        const escaped = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        const nextBytes = composedBytes + byteLength(escaped) - byteLength(token);
        if (nextBytes > DESCRIPTION_COMPOSITION_MAX_BYTES) {
          composedBytes = nextBytes;
          tooLarge = true;
          return token;
        }
        composedBytes = nextBytes;
        return value;
      });
      node = walker.nextNode();
    }
    parts.push(document.body.innerHTML);
  }
  const html = parts.join('');
  tooLarge ||= new TextEncoder().encode(html).byteLength > DESCRIPTION_COMPOSITION_MAX_BYTES;
  return {
    html,
    variables: [...variables],
    missing: [...missing],
    unsupported: [...unsupported],
    attributeVariables: [...attributeVariables],
    oversizedValues: [...oversizedValues],
    sanitizedChanges,
    tooLarge,
    tooMany,
    canApply:
      templates.length > 0 &&
      Boolean(html.trim()) &&
      !tooMany &&
      !tooLarge &&
      missing.size === 0 &&
      unsupported.size === 0 &&
      attributeVariables.size === 0 &&
      oversizedValues.size === 0
  };
}

const AUTOFILL_IDS: Readonly<Partial<Record<DescriptionTemplateVariable, readonly string[]>>> = {
  productName: ['subject', 'producttitle', 'title'],
  model: ['modelnumber', 'modelno', 'productmodel'],
  packaging: ['packagingdetails', 'packingdetails', 'packagingdescription'],
  leadTime: ['leadtime', 'deliverytime'],
  shippingOrigin: ['shippingorigin', 'port']
};
const normalizeId = (value: string) => value.replace(/[^a-z0-9]/giu, '').toLowerCase();

/** Read only unambiguous, explicitly mapped scalar fields, never guesses from translated labels. */
export function descriptionTemplateValuesFromSchema(
  model: ProductSchemaModel | null
): DescriptionTemplateValues {
  if (!model) return {};
  const fields: ProductSchemaField[] = [];
  function visit(field: ProductSchemaField): void {
    fields.push(field);
    const children =
      field.instances.length > 0 ? field.instances.flatMap((instance) => instance.fields) : field.children;
    for (const child of children) visit(child);
  }
  for (const field of model.fields) visit(field);
  const result: DescriptionTemplateValues = {};
  for (const variable of DESCRIPTION_TEMPLATE_VARIABLES) {
    const ids = AUTOFILL_IDS[variable];
    if (!ids) continue;
    const candidates = variable === 'productName' ? model.fields : fields;
    const values = new Set(
      candidates
        .filter((field) => ids.includes(normalizeId(field.id)))
        .filter((field) => field.type === 'input' || field.type === 'singleCheck')
        .flatMap((field) =>
          field.values.length === 1
            ? [
                field.options.find((option) => option.value === field.values[0]?.text)?.label ??
                  field.values[0]?.text ??
                  ''
              ]
            : []
        )
        .map((value) => value.trim())
        .filter(Boolean)
    );
    if (values.size === 1) result[variable] = [...values][0] ?? '';
  }
  // A bare delivery quantity lacks a confirmed unit. Do not invent one or expose it as a duration.
  if (result.leadTime && /^\d+(?:\.\d+)?$/u.test(result.leadTime)) delete result.leadTime;
  return result;
}
