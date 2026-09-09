import type { GalleryTransferDriver } from '@one-vegetable/core/gallery-transfer-runner';
import {
  GalleryTaskError,
  type GalleryTransferTaskV1 as Task,
  type GalleryTransferItemV1 as Item
} from '@one-vegetable/core/gallery-transfer-task';
import type { AppServices } from './services';
import type { BrowserGalleryTransferDriver } from './gallery-transfer-driver';

/** Do not load ZIP codecs or asset adapters just to show the workbench/login shell. */
export class LazyGalleryTransferDriver implements GalleryTransferDriver {
  private instance: BrowserGalleryTransferDriver | null = null;
  private pending: Promise<BrowserGalleryTransferDriver> | null = null;
  constructor(
    private readonly services: AppServices,
    private readonly download: (name: string, bytes: Uint8Array) => void
  ) {}
  private load(): Promise<BrowserGalleryTransferDriver> {
    this.pending ??= import('./gallery-transfer-driver').then(({ BrowserGalleryTransferDriver }) => {
      this.instance = new BrowserGalleryTransferDriver(this.services, this.download);
      return this.instance;
    });
    return this.pending;
  }
  async context() {
    if (!this.services.gateway.galleryTransferContext)
      throw new GalleryTaskError('GALLERY_CONTEXT_UNAVAILABLE');
    return this.services.gateway.galleryTransferContext();
  }
  async prepare(task: Task, item: Item): Promise<Item> {
    return (await this.load()).prepare(task, item);
  }
  async execute(task: Task, item: Item): Promise<Item> {
    return (await this.load()).execute(task, item);
  }
  async verify(task: Task, item: Item): Promise<Item> {
    return (await this.load()).verify(task, item);
  }
  async attachArchive(task: Task, bytes: Uint8Array): Promise<void> {
    await (await this.load()).attachArchive(task, bytes);
  }
  forgetArchive(id: string): void {
    this.instance?.forgetArchive(id);
  }
  release(id: string): void {
    this.instance?.release(id);
  }
}
