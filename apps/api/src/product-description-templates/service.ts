import { sanitizeProductDescriptionHtml } from '@one-vegetable/core';

import type {
  ProductDescriptionTemplate,
  ProductDescriptionTemplateCategory,
  ProductDescriptionTemplateLanguage,
  ProductDescriptionTemplateStatus
} from '@one-vegetable/core';
import type { AuthPrincipal } from '../auth/types';
import type { AuthService } from '../auth/service';
import type { ProductDescriptionTemplateListQuery, ProductDescriptionTemplateRepository } from './repository';

export class ProductDescriptionTemplateService {
  readonly #repository: ProductDescriptionTemplateRepository;
  readonly #authService: AuthService;

  constructor(repository: ProductDescriptionTemplateRepository, authService: AuthService) {
    this.#repository = repository;
    this.#authService = authService;
  }

  list(query: ProductDescriptionTemplateListQuery): Promise<{
    items: ProductDescriptionTemplate[];
    total: number;
  }> {
    return this.#repository.list(query);
  }

  async create(input: {
    requestId: string;
    actor: AuthPrincipal;
    name: string;
    category: ProductDescriptionTemplateCategory;
    language: ProductDescriptionTemplateLanguage;
    html: string;
    remark?: string | null;
  }): Promise<ProductDescriptionTemplate> {
    const entity = await this.#repository.create({
      name: input.name,
      category: input.category,
      language: input.language,
      html: sanitizeProductDescriptionHtml(input.html).html,
      actorId: input.actor.actorId,
      ...(input.remark !== undefined ? { remark: input.remark } : {})
    });
    await this.#audit(input.requestId, input.actor.actorId, 'create', entity, null);
    return entity;
  }

  async update(input: {
    requestId: string;
    actor: AuthPrincipal;
    id: string;
    name: string;
    category: ProductDescriptionTemplateCategory;
    language: ProductDescriptionTemplateLanguage;
    html: string;
    expectedRevision: number;
    remark: string | null;
  }): Promise<ProductDescriptionTemplate> {
    const entity = await this.#repository.update({
      id: input.id,
      name: input.name,
      category: input.category,
      language: input.language,
      html: sanitizeProductDescriptionHtml(input.html).html,
      expectedRevision: input.expectedRevision,
      actorId: input.actor.actorId,
      remark: input.remark
    });
    await this.#audit(input.requestId, input.actor.actorId, 'update', entity, input.expectedRevision);
    return entity;
  }

  archive(input: {
    requestId: string;
    actor: AuthPrincipal;
    id: string;
    expectedRevision: number;
  }): Promise<ProductDescriptionTemplate> {
    return this.#changeStatus(input, 'archived');
  }

  restore(input: {
    requestId: string;
    actor: AuthPrincipal;
    id: string;
    expectedRevision: number;
  }): Promise<ProductDescriptionTemplate> {
    return this.#changeStatus(input, 'active');
  }

  async #changeStatus(
    input: {
      requestId: string;
      actor: AuthPrincipal;
      id: string;
      expectedRevision: number;
    },
    status: ProductDescriptionTemplateStatus
  ): Promise<ProductDescriptionTemplate> {
    const entity = await this.#repository[status === 'archived' ? 'archive' : 'restore']({
      id: input.id,
      expectedRevision: input.expectedRevision,
      actorId: input.actor.actorId
    });
    await this.#audit(input.requestId, input.actor.actorId, status, entity, input.expectedRevision);
    return entity;
  }

  #audit(
    requestId: string,
    actorId: string,
    action: 'create' | 'update' | 'active' | 'archived',
    entity: ProductDescriptionTemplate,
    revisionBefore: number | null
  ): Promise<unknown> {
    return this.#authService.audit({
      requestId,
      actorId,
      action: `product-description-template.${action}`,
      resourceKind: 'product-description-template',
      resourceId: entity.id,
      outcome: 'success',
      reasonCode: 'TEMPLATE_MUTATION_SUCCEEDED',
      revisionBefore,
      revisionAfter: entity.revision
    });
  }
}
