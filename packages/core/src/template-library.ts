import { GatewayException } from './errors';
import { sanitizeProductDescriptionHtml } from './product-description';
import { validateProductDescriptionTemplateBundle } from './generated/validators-templates';
import type { components } from './generated/api';
import type {
  ProductDescriptionTemplate,
  ProductDescriptionTemplateLanguage
} from './product-description-template';
import type { ProductDescriptionTemplateClient } from './product-description-template-client-types';

export type TemplateBundle = components['schemas']['ProductDescriptionTemplateBundle'];
export type PortableTemplate = components['schemas']['ProductDescriptionTemplatePortable'];
export const TEMPLATE_BUNDLE_MAX_BYTES = 5 * 1024 * 1024;
export const TEMPLATE_HTML_MAX_BYTES = 256 * 1024;
export const TEMPLATE_BUNDLE_MAX_ITEMS = 100;

export function templateError(code: string): GatewayException {
  return new GatewayException({ code, message: code, retryable: false });
}

export function parseTemplateBundle(bytes: Uint8Array): TemplateBundle {
  if (bytes.byteLength > TEMPLATE_BUNDLE_MAX_BYTES) throw templateError('TEMPLATE_PACKAGE_TOO_LARGE');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw templateError('TEMPLATE_PACKAGE_INVALID');
  }
  if (!validateProductDescriptionTemplateBundle(value)) throw templateError('TEMPLATE_PACKAGE_INVALID');
  const bundle = value as TemplateBundle;
  for (const item of bundle.templates) {
    if (!item.name.trim() || new TextEncoder().encode(item.html).byteLength > TEMPLATE_HTML_MAX_BYTES)
      throw templateError('TEMPLATE_PACKAGE_INVALID');
  }
  return bundle;
}

export function encodeTemplateBundle(
  templates: readonly ProductDescriptionTemplate[],
  now = Date.now()
): Uint8Array {
  const bundle: TemplateBundle = {
    kind: 'oneVegetable.product-description-templates',
    schemaVersion: 1,
    exportedAtUtc: now,
    templates: templates.map(({ name, category, language, html, remark }) => ({
      name,
      category,
      language,
      html: sanitizeProductDescriptionHtml(html).html,
      remark
    }))
  };
  const bytes = new TextEncoder().encode(JSON.stringify(bundle, null, 2));
  parseTemplateBundle(bytes);
  return bytes;
}

/** Complete pagination: an empty/repeated page is not proof that a name is unused. */
export async function listAllTemplates(
  client: ProductDescriptionTemplateClient,
  language?: ProductDescriptionTemplateLanguage
): Promise<ProductDescriptionTemplate[]> {
  const values = new Map<string, ProductDescriptionTemplate>();
  for (let page = 1; page <= 100; page += 1) {
    const result = await client.list({ page, pageSize: 100, ...(language ? { language } : {}) });
    const before = values.size;
    for (const item of result.items) values.set(item.id, item);
    if (values.size >= result.total) return [...values.values()];
    if (values.size === before) break;
  }
  throw templateError('TEMPLATE_PAGE_LIMIT_EXCEEDED');
}

export interface TemplateImportOutcome {
  name: string;
  status: 'created' | 'skipped' | 'failed';
  error: unknown;
}

export async function importTemplateBundle(
  client: ProductDescriptionTemplateClient,
  bundle: TemplateBundle,
  conflict: 'skip' | 'copy',
  onProgress?: (outcome: TemplateImportOutcome) => void,
  isCurrent: () => boolean = () => true
): Promise<TemplateImportOutcome[]> {
  // Revalidate callers too; imports never accept IDs/audit fields supplied by a file.
  parseTemplateBundle(new TextEncoder().encode(JSON.stringify(bundle)));
  const existing = await listAllTemplates(client);
  const names = new Set(existing.map((item) => nameKey(item.name, item.language)));
  const outcomes: TemplateImportOutcome[] = [];
  for (const item of bundle.templates) {
    if (!isCurrent()) break;
    let name = item.name.trim();
    let outcome: TemplateImportOutcome;
    if (names.has(nameKey(name, item.language)) && conflict === 'skip') {
      outcome = { name, status: 'skipped', error: null };
    } else {
      if (names.has(nameKey(name, item.language))) {
        let suffix = 2;
        do {
          const tail = ` (${suffix++})`;
          name =
            Array.from(item.name.trim())
              .slice(0, 80 - tail.length)
              .join('') + tail;
        } while (names.has(nameKey(name, item.language)));
      }
      try {
        const created = await client.create({ ...item, name });
        names.add(nameKey(created.name, created.language));
        outcome = { name: created.name, status: 'created', error: null };
      } catch (error: unknown) {
        outcome = { name, status: 'failed', error };
      }
    }
    outcomes.push(outcome);
    onProgress?.(outcome);
    // Do not automatically repeat an unknown write or continue after authentication loss.
    if (outcome.status === 'failed') break;
  }
  return outcomes;
}

function nameKey(name: string, language: string): string {
  return `${language}:${name.trim().toLowerCase()}`;
}
