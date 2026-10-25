import { inject, provide, toRaw, type InjectionKey } from 'vue';
import type { GatewayClient, Photo } from '@one-vegetable/core';
import { snapshotProductPhotoSeed } from '@one-vegetable/core';
import type { GalleryTransferContext } from '@one-vegetable/core/gallery-transfer-task';

export interface ProductPhotoHandoff {
  id: string;
  scope: string;
  createdAt: number;
  photos: Photo[];
  source: Readonly<Record<string, unknown>>;
  context: Pick<GalleryTransferContext, 'identity' | 'gateway'> | null;
  productContexts: Partial<
    Record<'getProductSchema' | 'saveProductDraft' | 'publishProduct', GalleryTransferContext>
  >;
}

/** A one-use, app-scoped selection. No URLs, photo data or credentials are persisted. */
export class ProductPhotoHandoffService {
  private pending: ProductPhotoHandoff | null = null;

  constructor(
    private readonly gateway: GatewayClient,
    private readonly mode: string,
    private readonly scope: () => string,
    private readonly now = Date.now
  ) {}

  async create(
    photos: readonly Photo[],
    source: Readonly<Record<string, unknown>>,
    listedContext?: Pick<GalleryTransferContext, 'identity' | 'gateway'>
  ): Promise<string> {
    if (!photos.length || photos.length > 96) throw new Error('PHOTO_HANDOFF_INVALID');
    const scope = this.scope();
    const frozenPhotos = snapshotProductPhotoSeed(photos);
    const frozenSource = structuredClone(toRaw(source));
    const context = await this.gateway.galleryTransferContext?.('listPhotos', frozenSource);
    if (
      (this.mode !== 'mock' && !listedContext) ||
      (listedContext &&
        (context?.identity !== listedContext.identity || context.gateway !== listedContext.gateway))
    )
      throw new Error('GALLERY_CONTEXT_CHANGED');
    const productContexts: ProductPhotoHandoff['productContexts'] = {};
    for (const operation of ['getProductSchema', 'saveProductDraft', 'publishProduct'] as const) {
      const selected = await this.gateway.galleryTransferContext?.(operation, {});
      if (!selected && this.mode !== 'mock') throw new Error('GALLERY_CONTEXT_CHANGED');
      if (selected) {
        if (context && context.identity !== selected.identity) throw new Error('GALLERY_CONTEXT_CHANGED');
        productContexts[operation] = selected;
      }
    }
    if ((!context && this.mode !== 'mock') || scope !== this.scope())
      throw new Error('GALLERY_CONTEXT_CHANGED');
    const id = crypto.randomUUID();
    this.pending = {
      id,
      scope,
      createdAt: this.now(),
      photos: frozenPhotos,
      source: frozenSource,
      context: context ? { identity: context.identity, gateway: context.gateway } : null,
      productContexts
    };
    return id;
  }

  take(id: string): ProductPhotoHandoff | null {
    const pending = this.pending;
    this.pending = null;
    return pending?.id === id && this.isCurrent(pending) ? structuredClone(pending) : null;
  }

  async assertCurrent(handoff: ProductPhotoHandoff): Promise<void> {
    if (handoff.scope !== this.scope()) throw new Error('GALLERY_CONTEXT_CHANGED');
    const latest = await this.gateway.galleryTransferContext?.('listPhotos', { ...handoff.source });
    if (
      handoff.scope !== this.scope() ||
      (this.mode !== 'mock' && !latest) ||
      (latest?.identity ?? null) !== (handoff.context?.identity ?? null) ||
      (latest?.gateway ?? null) !== (handoff.context?.gateway ?? null)
    )
      throw new Error('GALLERY_CONTEXT_CHANGED');
    for (const operation of ['getProductSchema', 'saveProductDraft', 'publishProduct'] as const) {
      const expected = handoff.productContexts[operation];
      const actual = await this.gateway.galleryTransferContext?.(operation, {});
      if (
        handoff.scope !== this.scope() ||
        (this.mode !== 'mock' && !actual) ||
        actual?.identity !== expected?.identity ||
        actual?.gateway !== expected?.gateway
      )
        throw new Error('GALLERY_CONTEXT_CHANGED');
    }
  }

  /** Resolve with the actual request, but only within the configurations frozen at selection. */
  async productContext(
    handoff: ProductPhotoHandoff,
    operation: 'getProductSchema' | 'saveProductDraft' | 'publishProduct',
    payload: Readonly<Record<string, unknown>>
  ): Promise<GalleryTransferContext | undefined> {
    if (handoff.scope !== this.scope()) throw new Error('GALLERY_CONTEXT_CHANGED');
    const actual = await this.gateway.galleryTransferContext?.(operation, { ...payload });
    const frozen = [handoff.context, ...Object.values(handoff.productContexts)];
    if (
      handoff.scope !== this.scope() ||
      (this.mode !== 'mock' && !actual) ||
      (actual &&
        !frozen.some((entry) => entry?.identity === actual.identity && entry.gateway === actual.gateway))
    )
      throw new Error('GALLERY_CONTEXT_CHANGED');
    return actual ? { ...actual } : undefined;
  }

  clear(): void {
    this.pending = null;
  }

  private isCurrent(handoff: ProductPhotoHandoff): boolean {
    const age = this.now() - handoff.createdAt;
    return handoff.scope === this.scope() && age >= 0 && age < 30 * 60_000;
  }
}

const key: InjectionKey<ProductPhotoHandoffService> = Symbol('product-photo-handoff');
export function provideProductPhotoHandoff(service: ProductPhotoHandoffService): void {
  provide(key, service);
}
export function useProductPhotoHandoff(): ProductPhotoHandoffService | null {
  return inject(key, null);
}
