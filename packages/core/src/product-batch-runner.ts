import { GatewayException } from './errors';
import { isProductMutationJob, type ProductMutationJobClient } from './product-mutation-job-client';
import { assertProductOperationContext, type ProductOperationContext } from './product-operation-context';
import {
  previewProductBatchMaintenance,
  productBatchTargetFingerprint,
  type ProductBatchMaintenancePreview,
  type ProductBatchMaintenanceRules
} from './product-batch-maintenance';
import type { ProductMutationJob } from './product-mutation-job';
import type { AlibabaLanguage, UiLocale } from './preferences';
import type { GatewayClient, Product } from './types';

export interface ProductMaintenanceItem {
  product: Product;
  preview: ProductBatchMaintenancePreview | null;
  selected: boolean;
  state:
    | 'reading'
    | 'ready'
    | 'unchanged'
    | 'unsupported'
    | 'failed'
    | 'conflict'
    | 'submitting'
    | 'pending'
    | 'verified'
    | 'unknown';
  error: unknown;
  requestId: string | null;
  job: ProductMutationJob | null;
}
const failure = (code: string): GatewayException =>
  new GatewayException({ code, message: code, retryable: false });
const fatal = (error: unknown): boolean =>
  error instanceof GatewayException &&
  /AUTH|SESSION|TOKEN|CSRF|CONTEXT|CREDENTIAL|PERMISSION|FORBIDDEN|IN_PROGRESS|DISABLED/iu.test(
    `${error.gatewayError.code};${error.gatewayError.subCode ?? ''}`
  );
/** One in-memory editor session. Only backend receipts are durable, never rules or full Schema. */
export class ProductBatchMaintenanceRunner {
  readonly batchId = crypto.randomUUID();
  readonly items: ProductMaintenanceItem[];
  private stopped = false;
  private running = false;
  private sent = false;
  private lastCall = 0;
  private context: ProductOperationContext | null = null;
  private rules: ProductBatchMaintenanceRules | null = null;
  constructor(
    private readonly options: {
      gateway: GatewayClient;
      jobs: ProductMutationJobClient;
      products: Product[];
      language: AlibabaLanguage;
      locale?: UiLocale;
      changed?: () => void;
      wait?: (ms: number) => Promise<void>;
      now?: () => number;
    }
  ) {
    if (
      !options.products.length ||
      options.products.length > 30 ||
      new Set(options.products.map((p) => p.id)).size !== options.products.length
    )
      throw failure('PRODUCT_BATCH_RANGE_INVALID');
    this.items = options.products.map((product) => ({
      product: structuredClone(product),
      preview: null,
      selected: true,
      state: 'reading',
      error: null,
      requestId: null,
      job: null
    }));
  }
  stop(): void {
    this.stopped = true;
  }
  private isStopped(): boolean {
    return this.stopped;
  }
  private change(): void {
    this.options.changed?.();
  }
  private now(): number {
    return (this.options.now ?? Date.now)();
  }
  private wait(ms: number): Promise<void> {
    return this.options.wait?.(ms) ?? new Promise((resolve) => setTimeout(resolve, ms));
  }
  private async call<T>(action: () => Promise<T>): Promise<T> {
    await this.wait(Math.max(0, 300 - (this.now() - this.lastCall)));
    if (this.stopped) throw failure('PRODUCT_BATCH_STOPPED');
    this.lastCall = this.now();
    return action();
  }
  private async scope(): Promise<ProductOperationContext> {
    const current = await this.options.gateway.productOperationContext?.();
    if (!current) throw failure('PRODUCT_CONTEXT_UNAVAILABLE');
    if (this.context) assertProductOperationContext(this.context, current);
    return current;
  }
  private async latest(id: string): Promise<Product> {
    const page = await this.call(() =>
      this.options.gateway.request(
        'listProducts',
        { productId: id, page: 1, pageSize: 1, language: this.options.language },
        this.context ? { productContext: this.context } : undefined
      )
    );
    const product = page.items.find((p) => p.id === id);
    if (!product?.categoryId || !['online', 'offline'].includes(product.status))
      throw failure('PRODUCT_BATCH_STATE_CHANGED');
    return product;
  }
  private async schema(product: Product): Promise<string> {
    if (!product.categoryId) throw failure('PRODUCT_BATCH_STATE_CHANGED');
    const rendered = await this.call(() =>
      this.options.gateway.request(
        'renderProductSchema',
        { productId: product.id, categoryId: product.categoryId ?? 0, language: this.options.language },
        this.context ? { productContext: this.context } : undefined
      )
    );
    if (rendered.categoryId !== product.categoryId) throw failure('PRODUCT_BATCH_STATE_CHANGED');
    return rendered.xml;
  }
  async preview(rules: ProductBatchMaintenanceRules): Promise<void> {
    if (this.running || this.sent) throw failure('PRODUCT_BATCH_ALREADY_STARTED');
    this.running = true;
    this.rules = structuredClone(rules);
    try {
      this.context = await this.scope();
      for (const item of this.items) {
        if (this.stopped) break;
        try {
          item.product = await this.latest(item.product.id);
          const xml = await this.schema(item.product);
          if (this.isStopped()) break;
          item.preview = await previewProductBatchMaintenance(xml, this.rules, this.options.locale);
          item.state = item.preview.status;
          item.selected = item.state === 'ready';
        } catch (error) {
          item.state = 'failed';
          item.error = error;
          item.selected = false;
          if (fatal(error)) this.stop();
        }
        this.change();
      }
    } finally {
      this.running = false;
      this.change();
    }
  }
  async execute(): Promise<void> {
    if (this.running || this.sent || !this.context || !this.rules)
      throw failure('PRODUCT_BATCH_ALREADY_STARTED');
    this.running = true;
    this.sent = true;
    // Snapshot exclusions before the first await; checkbox changes cannot alter an active batch.
    const targets = this.items.filter((item) => item.selected && item.state === 'ready');
    try {
      await this.scope();
      for (const item of targets) {
        if (this.stopped) break;
        try {
          await this.scope();
          const current = await this.latest(item.product.id);
          const xml = await this.schema(current);
          if (
            current.categoryId !== item.product.categoryId ||
            current.status !== item.product.status ||
            !item.preview?.baseline ||
            (await productBatchTargetFingerprint(xml, item.preview.rootIds)) !== item.preview.baseline
          ) {
            item.state = 'conflict';
            this.change();
            continue;
          }
          const updated = await previewProductBatchMaintenance(xml, this.rules, this.options.locale);
          if (updated.status !== 'ready') {
            item.state = 'conflict';
            this.change();
            continue;
          }
          item.state = 'submitting';
          const requestId = crypto.randomUUID();
          item.requestId = requestId;
          this.change();
          const result = await this.call(() =>
            this.options.gateway.request(
              'updateProduct',
              {
                productId: current.id,
                categoryId: current.categoryId ?? 0,
                language: this.options.language,
                schemaPatchXml: updated.patchXml
              },
              {
                ...(this.context ? { productContext: this.context } : {}),
                productBatchId: this.batchId,
                requestId
              }
            )
          );
          if (
            !isProductMutationJob(result.job) ||
            result.job.batchId !== this.batchId ||
            result.job.requestId !== item.requestId
          )
            throw failure('PRODUCT_BATCH_RECEIPT_MISSING');
          item.job = result.job;
          item.state = 'pending';
          this.change();
          await this.verify(item);
        } catch (error) {
          item.error = error;
          if (error instanceof GatewayException && error.gatewayError.code === 'PRODUCT_BATCH_STOPPED') {
            item.state = 'ready';
            item.requestId = null;
            this.stop();
            this.change();
            break;
          }
          if (item.state === 'submitting') {
            // A lost transport response may still have a durable server receipt. Never resubmit it.
            try {
              const page = await this.options.jobs.list({ productId: item.product.id, pageSize: 100 });
              item.job =
                page.items.find((job) => job.requestId === item.requestId && job.batchId === this.batchId) ??
                null;
            } catch {
              /* Keep the original error and unknown outcome. */
            }
            item.state = item.job?.status === 'failed' ? 'failed' : 'unknown';
          } else if (item.state !== 'pending') item.state = 'failed';
          if (fatal(error) || item.state === 'unknown' || item.state === 'pending') this.stop();
        }
        this.change();
      }
    } finally {
      this.running = false;
      this.change();
    }
  }
  private async verify(item: ProductMaintenanceItem): Promise<void> {
    const deadline = this.now() + 300_000;
    while (!this.stopped && item.job && this.now() < deadline) {
      await this.wait(5_000);
      if (this.isStopped() || this.now() > deadline) return;
      await this.scope();
      item.job = await this.call(() =>
        this.options.jobs.refresh(item.job?.id ?? '', item.job?.revision ?? 0)
      );
      if (item.job.reasonCode && fatal(failure(item.job.reasonCode))) {
        item.error = failure(item.job.reasonCode);
        this.stop();
        this.change();
        return;
      }
      if (item.job.status === 'verified') {
        item.state = 'verified';
        this.change();
        return;
      }
      if (item.job.status === 'failed') {
        item.state = 'failed';
        this.change();
        return;
      }
      this.change();
    }
    // An accepted update still needs review/readback; no automatic writes to the next item.
    if (item.state === 'pending') this.stop();
  }
}
