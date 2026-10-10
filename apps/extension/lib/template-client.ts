import type { ProductDescriptionTemplateClient } from '@one-vegetable/core';
import {
  BundledProductDescriptionTemplateClient,
  BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA
} from '@one-vegetable/core/runtime';

let clientPromise: Promise<ProductDescriptionTemplateClient> | undefined;
function client(): Promise<ProductDescriptionTemplateClient> {
  clientPromise ??= Promise.all([
    import('@one-vegetable/core/local-templates'),
    import('@one-vegetable/core/composite-templates')
  ]).then(
    ([local, shared]) =>
      new shared.CompositeProductDescriptionTemplateClient(
        new BundledProductDescriptionTemplateClient(BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA.templates),
        new local.IndexedDbProductDescriptionTemplateClient()
      )
  );
  return clientPromise;
}

/** All HTML/storage code is loaded only when a trusted options page uses templates. */
export const extensionTemplates: ProductDescriptionTemplateClient = {
  async list(input) {
    return (await client()).list(input);
  },
  async create(input) {
    return (await client()).create(input);
  },
  async update(input) {
    return (await client()).update(input);
  },
  async archive(id, revision) {
    return (await client()).archive(id, revision);
  },
  async restore(id, revision) {
    return (await client()).restore(id, revision);
  }
};

export async function inspectLocalTemplates() {
  const { IndexedDbProductDescriptionTemplateClient } = await import('@one-vegetable/core/local-templates');
  return (await new IndexedDbProductDescriptionTemplateClient().list({ pageSize: 1000 })).items;
}
export async function resetLocalTemplates(): Promise<void> {
  const { clearLocalTemplates } = await import('@one-vegetable/core/local-templates');
  await clearLocalTemplates();
}
