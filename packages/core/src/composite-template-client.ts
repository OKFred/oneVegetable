import { listAllTemplates } from './template-library';
import type {
  ProductDescriptionTemplateClient,
  ProductDescriptionTemplateListInput
} from './product-description-template-client-types';

/** Keep transport/mock implementations out of the independent extension. */
export class CompositeProductDescriptionTemplateClient implements ProductDescriptionTemplateClient {
  constructor(
    private readonly bundled: ProductDescriptionTemplateClient,
    private readonly shared: ProductDescriptionTemplateClient
  ) {}
  async list(input: ProductDescriptionTemplateListInput = {}) {
    const [bundled, shared] = await Promise.all([
      listAllTemplates(this.bundled, input.language),
      listAllTemplates(this.shared, input.language)
    ]);
    const merged = new Map([...bundled, ...shared].map((item) => [item.id, item]));
    const items = [...merged.values()]
      .filter(
        (item) =>
          (!input.category || item.category === input.category) &&
          (!input.status || item.status === input.status)
      )
      .toSorted(
        (a, b) =>
          Number(b.creatorId === 'system:bundled') - Number(a.creatorId === 'system:bundled') ||
          b.updateTimeUtc - a.updateTimeUtc ||
          a.name.localeCompare(b.name)
      );
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    return {
      items: items.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: items.length
    };
  }
  create(input: Parameters<ProductDescriptionTemplateClient['create']>[0]) {
    return this.shared.create(input);
  }
  update(input: Parameters<ProductDescriptionTemplateClient['update']>[0]) {
    return this.shared.update(input);
  }
  archive(id: string, revision: number) {
    return this.shared.archive(id, revision);
  }
  restore(id: string, revision: number) {
    return this.shared.restore(id, revision);
  }
}
