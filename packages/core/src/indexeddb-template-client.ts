import { createEntityAuditFields, updateEntityAuditFields } from './audit';
import { sanitizeProductDescriptionHtml } from './product-description';
import {
  validateProductDescriptionTemplate,
  validateProductDescriptionTemplateCreateRequest,
  validateProductDescriptionTemplateUpdateRequest
} from './generated/validators-templates';
import { templateError, TEMPLATE_HTML_MAX_BYTES } from './template-library';
import type {
  ProductDescriptionTemplateClient,
  ProductDescriptionTemplateListInput
} from './product-description-template-client-types';
import type { ProductDescriptionTemplate } from './product-description-template';

export const LOCAL_TEMPLATE_DATABASE = 'one-vegetable:description-templates:v1';
const STORE = 'templates';

/** Trusted extension pages only. Transactions serialize name/revision checks across tabs. */
export class IndexedDbProductDescriptionTemplateClient implements ProductDescriptionTemplateClient {
  constructor(private readonly factory: IDBFactory = indexedDB) {}

  async list(input: ProductDescriptionTemplateListInput = {}) {
    const values = await this.#read();
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    const filtered = values
      .filter(
        (value) =>
          (!input.language || value.language === input.language) &&
          (!input.category || value.category === input.category) &&
          (!input.status || value.status === input.status)
      )
      .toSorted((a, b) => b.updateTimeUtc - a.updateTimeUtc || a.name.localeCompare(b.name));
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: filtered.length
    };
  }

  create(input: Parameters<ProductDescriptionTemplateClient['create']>[0]) {
    if (!validateProductDescriptionTemplateCreateRequest({ requestId: crypto.randomUUID(), ...input }))
      return Promise.reject(templateError('TEMPLATE_PACKAGE_INVALID'));
    return this.#mutate((values) => {
      if (values.length >= 1000) throw templateError('TEMPLATE_STORAGE_LIMIT');
      this.#unique(values, input.name, input.language);
      return {
        id: crypto.randomUUID(),
        name: input.name.trim(),
        category: input.category,
        language: input.language,
        html: safeHtml(input.html),
        status: 'active',
        ...createEntityAuditFields('local:templates', Date.now(), input.remark)
      };
    });
  }

  update(input: Parameters<ProductDescriptionTemplateClient['update']>[0]) {
    if (!validateProductDescriptionTemplateUpdateRequest({ requestId: crypto.randomUUID(), ...input }))
      return Promise.reject(templateError('TEMPLATE_PACKAGE_INVALID'));
    return this.#mutate((values) => {
      const current = required(values, input.id, input.revision);
      this.#unique(values, input.name, input.language, input.id);
      return {
        ...current,
        name: input.name.trim(),
        category: input.category,
        language: input.language,
        html: safeHtml(input.html),
        ...updateEntityAuditFields(current, 'local:templates', Date.now(), input.remark)
      };
    });
  }

  archive(id: string, revision: number) {
    return this.#status(id, revision, 'archived');
  }
  restore(id: string, revision: number) {
    return this.#status(id, revision, 'active');
  }

  #status(id: string, revision: number, status: 'active' | 'archived') {
    return this.#mutate((values) => {
      const current = required(values, id, revision);
      return {
        ...current,
        status,
        ...updateEntityAuditFields(current, 'local:templates', Date.now(), current.remark)
      };
    });
  }

  #unique(values: ProductDescriptionTemplate[], name: string, language: string, except?: string): void {
    if (!name.trim()) throw templateError('TEMPLATE_PACKAGE_INVALID');
    if (
      values.some(
        (v) =>
          v.id !== except && v.language === language && v.name.toLowerCase() === name.trim().toLowerCase()
      )
    )
      throw templateError('TEMPLATE_NAME_CONFLICT');
  }

  async #open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open(LOCAL_TEMPLATE_DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(templateError('TEMPLATE_STORAGE_UNAVAILABLE'));
      };
      request.onblocked = () => {
        reject(templateError('TEMPLATE_STORAGE_UNAVAILABLE'));
      };
    });
  }

  async #read(): Promise<ProductDescriptionTemplate[]> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      let values: ProductDescriptionTemplate[];
      let error: Error | undefined;
      request.onsuccess = () => {
        try {
          values = validateRows(request.result as unknown);
        } catch (cause: unknown) {
          error = cause instanceof Error ? cause : templateError('TEMPLATE_STORAGE_INVALID');
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve(values);
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        reject(error ?? templateError('TEMPLATE_STORAGE_UNAVAILABLE'));
      };
    });
  }

  async #mutate(
    prepare: (values: ProductDescriptionTemplate[]) => ProductDescriptionTemplate
  ): Promise<ProductDescriptionTemplate> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const request = store.getAll();
      let value: ProductDescriptionTemplate;
      let error: Error | undefined;
      request.onsuccess = () => {
        try {
          value = prepare(validateRows(request.result as unknown));
          store.put(value);
        } catch (cause: unknown) {
          error = cause instanceof Error ? cause : templateError('TEMPLATE_STORAGE_INVALID');
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve(structuredClone(value));
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        reject(error ?? templateError('TEMPLATE_STORAGE_UNAVAILABLE'));
      };
    });
  }
}

export function clearLocalTemplates(factory: IDBFactory = indexedDB): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(LOCAL_TEMPLATE_DATABASE);
    request.onsuccess = () => {
      resolve();
    };
    request.onblocked = request.onerror = () => {
      reject(templateError('TEMPLATE_STORAGE_UNAVAILABLE'));
    };
  });
}

function validateRows(value: unknown): ProductDescriptionTemplate[] {
  if (
    !Array.isArray(value) ||
    value.length > 1000 ||
    !value.every((row: unknown) => validateProductDescriptionTemplate(row))
  )
    throw templateError('TEMPLATE_STORAGE_INVALID');
  return value as ProductDescriptionTemplate[];
}

function required(
  values: ProductDescriptionTemplate[],
  id: string,
  revision: number
): ProductDescriptionTemplate {
  const value = values.find((v) => v.id === id);
  if (!value) throw templateError('TEMPLATE_NOT_FOUND');
  if (value.revision !== revision) throw templateError('ENTITY_VERSION_CONFLICT');
  return value;
}

function safeHtml(html: string): string {
  if (new TextEncoder().encode(html).byteLength > TEMPLATE_HTML_MAX_BYTES)
    throw templateError('TEMPLATE_PACKAGE_INVALID');
  return sanitizeProductDescriptionHtml(html).html;
}
