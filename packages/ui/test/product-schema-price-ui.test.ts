// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { toast } from 'vue-sonner';
import { parseProductSchemaXml, type ProductMutationJob, type SettingsRepository } from '@one-vegetable/core';
import { GatewayException } from '@one-vegetable/core/errors';
import { IOP_REFERENCE_METHODS } from '@one-vegetable/core/product-reference';
import integrity from '../../../mock/data/product-maintenance-integrity.json';
import schema from '../../../mock/data/product-schema-price.json';
import ProductSchemaPriceDialog from '../src/components/ProductSchemaPriceDialog.vue';
import { provideServices } from '../src/lib/services';
import { provideListIdentityScope } from '../src/lib/list-identity-scope';
import { GATEWAY_CONFIGURATION_EVENT } from '../src/lib/gateway-configuration-events';
import { uiI18n } from '../src/i18n';
import { productValueMaintenance as en } from '../src/i18n/messages/en-US/productValueMaintenance';
import { productValueMaintenance as zh } from '../src/i18n/messages/zh-CN/productValueMaintenance';

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn() } }));
const wrappers: VueWrapper[] = [];
const context = { identity: 'a'.repeat(64), gateway: 'b'.repeat(64) };
const source = integrity.snapshot;
function referenceResponse() {
  return {
    success: true,
    product_info: {
      basic_info: {
        product_id: source.productId,
        title: source.title,
        keywords: source.keywords,
        description: source.descriptionHtml,
        product_images: source.images.map((image_url) => ({ image_url })),
        language: source.language,
        status: source.status,
        audit_status: source.auditStatus,
        model_number: source.modelNumber,
        create_timestamp: source.createdTimestamp,
        last_modified_timestamp: source.modifiedTimestamp
      },
      category_info: {
        category_id: source.categoryId,
        category_name: source.categoryPath,
        attributes: source.attributes.map((row) => ({ attribute_name: row.name, attribute_value: row.value }))
      },
      logistics_info: {
        shipping_template_id: source.shippingTemplateId,
        weight: source.weight,
        dimension: source.dimension,
        tiered_lead_time: source.leadTimes.map((row) => ({ quantity: row.quantity, lead_time: row.days }))
      },
      trade_info: {
        moq: source.moq,
        unit: source.unit,
        inventory: source.inventory,
        price: {
          price_type: source.price.type,
          currency: source.price.currency,
          tiered_price: source.price.tiers
        },
        sku_info: source.skus.map((row) => ({
          sku_id: row.id,
          sku_code: row.code,
          inventory: row.inventory,
          sku_price: { price: row.price, currency: row.currency },
          sale_attributes: row.attributes.map((item) => ({
            attribute_name: item.name,
            attribute_value: item.value,
            image: { image_url: item.imageUrl }
          }))
        }))
      }
    }
  };
}
function receipt(status: ProductMutationJob['status'] = 'submitted', revision = 1): ProductMutationJob {
  return {
    id: 'price-job',
    requestId: 'price-request',
    productId: source.productId,
    protocol: 'iop',
    productContext: context,
    operation: 'updateProduct',
    status,
    revision,
    categoryId: Number(source.categoryId),
    language: 'en_US',
    payloadFingerprint: 'c'.repeat(64),
    fieldExpectations: [],
    encryptedProductId: null,
    targetDisplay: null,
    originalDisplay: null,
    traceId: null,
    reasonCode: null,
    message: null,
    submittedTimeUtc: Date.now(),
    lastCheckedTimeUtc: null,
    completedTimeUtc: null,
    createTimeUtc: Date.now(),
    updateTimeUtc: Date.now(),
    creatorId: 'test',
    updaterId: 'test',
    remark: null
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(
  options: { selectError?: Error; mutate?: (response: ReturnType<typeof referenceResponse>) => void } = {}
) {
  const scope = ref('account'),
    visible = ref(true),
    productId = ref(source.productId);
  const response = referenceResponse();
  const select = vi.fn((_operation?: string, _payload?: Readonly<Record<string, unknown>>) =>
    Promise.resolve({ ...context, storage: null })
  );
  const refresh = vi.fn(() => Promise.resolve(receipt('auditing', 2)));
  const request = vi.fn((operation: string, _payload: unknown, _options?: unknown): Promise<unknown> => {
    if (operation === 'callCapability') return Promise.resolve({ contractValid: true, data: response });
    if (operation === 'renderProductSchema') return Promise.resolve({ xml: schema.nestedXml });
    if (operation === 'updateProduct') return Promise.resolve({ success: true, job: receipt() });
    throw new Error('Unexpected operation');
  });
  if (options.selectError) select.mockRejectedValue(options.selectError);
  options.mutate?.(response);
  const onClose = vi.fn(() => {
    visible.value = false;
  });
  const wrapper = mount(
    defineComponent({
      setup() {
        provideServices({
          gateway: { request: request as never, galleryTransferContext: select },
          mode: 'bff',
          settings: {} as SettingsRepository,
          productMutationJobs: { list: vi.fn(), get: vi.fn(), refresh, recover: vi.fn() }
        });
        provideListIdentityScope(computed(() => scope.value));
        return () =>
          visible.value ? h(ProductSchemaPriceDialog, { productId: productId.value, onClose }) : null;
      }
    }),
    {
      global: {
        stubs: {
          ModalDialog: {
            props: ['open', 'title'],
            template: '<section v-if="open"><h2>{{title}}</h2><slot/><slot name="footer"/></section>'
          },
          ConfirmActionDialog: {
            props: ['open', 'pending'],
            emits: ['confirm', 'update:open'],
            template:
              '<section v-if="open" data-confirm><slot/><button data-action="confirm-send" :disabled="pending" @click="$emit(\'confirm\')">Send once</button><button data-action="cancel-confirm" @click="$emit(\'update:open\', false)">Cancel</button></section>'
          }
        }
      }
    }
  );
  wrappers.push(wrapper);
  return { wrapper, scope, visible, productId, response, select, request, refresh, onClose };
}
async function settle(wrapper: VueWrapper) {
  await flushPromises();
  await vi.waitFor(() => {
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false);
  });
}
async function preview(wrapper: VueWrapper, value = '1.01') {
  await settle(wrapper);
  await wrapper.get('[data-field="price-0"]').setValue(value);
  await wrapper.get('form').trigger('submit');
  await settle(wrapper);
}
async function send(wrapper: VueWrapper) {
  await preview(wrapper);
  await wrapper.get('[data-action="review"]').trigger('click');
  await wrapper.get('[data-action="confirm-send"]').trigger('click');
  await settle(wrapper);
}
beforeEach(() => {
  vi.useFakeTimers();
  uiI18n.global.locale.value = 'en-US';
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => {
    wrapper.unmount();
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Schema price dialog with protected model preservation', () => {
  it('loads reference and Schema in the actual get/v2 context; only existing amounts are editable', async () => {
    const app = setup();
    await settle(app.wrapper);
    expect(app.select).toHaveBeenCalledWith('callCapability', {
      method: IOP_REFERENCE_METHODS.getProduct,
      parameters: { product_id: source.productId }
    });
    expect(app.request.mock.calls.map(([op]) => op)).toEqual(['callCapability', 'renderProductSchema']);
    for (const [, , options] of app.request.mock.calls) expect(options).toEqual({ productContext: context });
    expect(app.wrapper.findAll('input').map((row) => row.element.value)).toEqual(['1.00', '0.90']);
    expect(app.wrapper.findAll('tbody th').map((row) => row.text())).toEqual(['1', '10']);
    expect(app.wrapper.findAll('select')).toHaveLength(0);
    expect(app.wrapper.text()).toContain(en.schemaFixedHint);
  });
  it.each(['PRODUCT_MUTATION_ACCEPTED', 'ALIBABA_IOP_API_REJECTED', 'PRODUCT_SCHEMA_PRICE_REVIEW_PENDING'])(
    'does not label pending platform review as a failed update: %s',
    async (reasonCode) => {
      const app = setup();
      await settle(app.wrapper);
      app.request.mockResolvedValueOnce({
        success: true,
        job: { ...receipt('auditing'), reasonCode }
      });
      await send(app.wrapper);
      expect(app.wrapper.get('[data-status]').text()).toBe(en.schemaAuditing);
      expect(app.wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(toast.success).not.toHaveBeenCalled();
    }
  );

  it('treats equivalent decimal amounts as a no-op and never offers submission', async () => {
    const app = setup();
    await preview(app.wrapper, '1.0000');
    expect(app.wrapper.get('[data-result="noop"]').text()).toBe(en.schemaNoop);
    expect(app.wrapper.find('[data-action="review"]').exists()).toBe(false);
    expect(app.request.mock.calls.some(([op]) => op === 'updateProduct')).toBe(false);
  });
  it('invalidates a preview and confirmation as soon as values change', async () => {
    const app = setup();
    await preview(app.wrapper);
    await app.wrapper.get('[data-action="review"]').trigger('click');
    await app.wrapper.get('[data-field="price-0"]').setValue('1.02');
    expect(app.wrapper.find('[data-result="preview"]').exists()).toBe(false);
    expect(app.wrapper.find('[data-confirm]').exists()).toBe(false);
    expect(app.request.mock.calls.some(([op]) => op === 'updateProduct')).toBe(false);
  });
  it('confirms once, submits the guarded Schema patch, and reports success only for a verified job', async () => {
    const schedule = vi.spyOn(globalThis, 'setTimeout');
    const app = setup();
    await preview(app.wrapper);
    expect(app.wrapper.get('[data-result="preview"]').text()).toContain('1.00 → 1.01 USD');
    await app.wrapper.get('[data-action="review"]').trigger('click');
    await app.wrapper.get('[data-action="cancel-confirm"]').trigger('click');
    expect(app.request.mock.calls.some(([op]) => op === 'updateProduct')).toBe(false);
    await app.wrapper.get('[data-action="review"]').trigger('click');
    const confirm = app.wrapper.get('[data-action="confirm-send"]');
    await confirm.trigger('click');
    await confirm.trigger('click');
    await settle(app.wrapper);
    const calls = app.request.mock.calls.filter(([op]) => op === 'updateProduct');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toMatchObject({
      productId: source.productId,
      categoryId: Number(source.categoryId),
      language: 'en_US',
      priceGuard: {
        version: 1,
        draft: {
          mode: 'tiered',
          currency: 'USD',
          tiers: [
            { quantity: '1', price: '1.01' },
            { quantity: '10', price: '0.90' }
          ]
        }
      }
    });
    expect(calls[0]?.[1]).toHaveProperty('schemaPatchXml', expect.stringContaining('ladderPrice'));
    const submitted = calls[0]?.[1] as { schemaPatchXml: string };
    const fields = parseProductSchemaXml(submitted.schemaPatchXml).fields;
    expect(fields.map((field) => field.id).sort()).toEqual(['ladderPrice', 'modelNumber']);
    expect(fields.find((field) => field.id === 'modelNumber')?.values.map((value) => value.text)).toEqual([
      source.modelNumber
    ]);
    expect(calls[0]?.[2]).toMatchObject({ productContext: context });
    expect(calls[0]?.[2]).toHaveProperty('requestId', expect.any(String));
    expect(app.wrapper.get('[data-status]').text()).toBe(en.schemaSubmitted);
    expect(app.wrapper.get('[data-action="task-center"]').attributes('href')).toBe(
      '#/products/tasks/price-job'
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 5_000);
    await vi.advanceTimersByTimeAsync(4_900);
    expect(app.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await settle(app.wrapper);
    expect(app.refresh).toHaveBeenCalledWith('price-job', 1);
    expect(app.wrapper.get('[data-status]').text()).toBe(en.schemaAuditing);
    app.refresh.mockResolvedValue(receipt('verified', 3));
    await app.wrapper.get('[data-action="refresh"]').trigger('click');
    await settle(app.wrapper);
    expect(app.refresh).toHaveBeenLastCalledWith('price-job', 2);
    expect(app.wrapper.get('[data-status]').text()).toBe(en.verified);
    expect(toast.success).toHaveBeenCalledExactlyOnceWith(en.schemaVerified);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(app.refresh).toHaveBeenCalledTimes(2);
    expect(app.request.mock.calls.filter(([op]) => op === 'updateProduct')).toHaveLength(1);
  });
  it('does not retry an unknown submission, and keeps a task-center link even without a receipt', async () => {
    const app = setup();
    await settle(app.wrapper);
    app.request.mockImplementation((operation) => {
      if (operation === 'updateProduct') throw new Error('REQUEST_TIMEOUT');
      throw new Error('Unexpected read');
    });
    await send(app.wrapper);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(app.request.mock.calls.filter(([op]) => op === 'updateProduct')).toHaveLength(1);
    expect(app.wrapper.find('[data-action="review"]').exists()).toBe(false);
    expect(app.wrapper.get('[data-action="task-center"]').attributes('href')).toBe('#/products/tasks');
    expect(app.refresh).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it('bounds automatic readback to five minutes but leaves manual readback available', async () => {
    const app = setup();
    await send(app.wrapper);
    await vi.advanceTimersByTimeAsync(300_000);
    await settle(app.wrapper);
    expect(app.refresh.mock.calls.length).toBeGreaterThan(0);
    expect(app.refresh.mock.calls.length).toBeLessThanOrEqual(60);
    expect(app.wrapper.text()).toContain(en.schemaPollingStopped);
    const count = app.refresh.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(app.refresh).toHaveBeenCalledTimes(count);
    await app.wrapper.get('[data-action="refresh"]').trigger('click');
    await settle(app.wrapper);
    expect(app.refresh).toHaveBeenCalledTimes(count + 1);
  });
  it.each(['identity', 'configuration', 'hidden', 'close'] as const)(
    'stops scheduling and ignores stale verification on %s',
    async (change) => {
      const app = setup();
      await send(app.wrapper);
      const result = deferred<ProductMutationJob>();
      app.refresh.mockReturnValue(result.promise);
      await app.wrapper.get('[data-action="refresh"]').trigger('click');
      await flushPromises();
      expect(app.refresh).toHaveBeenCalledTimes(1);
      if (change === 'identity') app.scope.value = 'another-account';
      if (change === 'configuration') globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
      if (change === 'hidden') {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
      }
      if (change === 'close') await app.wrapper.get('[data-action="close"]').trigger('click');
      await flushPromises();
      result.resolve(receipt('verified', 3));
      await flushPromises();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(app.refresh).toHaveBeenCalledTimes(1);
      expect(toast.success).not.toHaveBeenCalled();
      if (change !== 'close') {
        expect(app.wrapper.get('[data-action="task-center"]').attributes('href')).toBe(
          '#/products/tasks/price-job'
        );
        expect(app.wrapper.findAll('input')).toHaveLength(0);
      } else expect(app.onClose).toHaveBeenCalledOnce();
    }
  );
  it('rejects an old reference completion after a configuration replacement', async () => {
    const app = setup();
    const result = deferred<unknown>();
    app.request.mockReturnValueOnce(result.promise);
    await flushPromises();
    globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
    result.resolve({ contractValid: true, data: app.response });
    await flushPromises();
    expect(app.wrapper.findAll('input')).toHaveLength(0);
    expect(app.request.mock.calls.some(([op]) => op === 'renderProductSchema')).toBe(false);
  });
  it('explains that TOP-only authorization cannot supply independent readback, without fallback', async () => {
    const app = setup({
      selectError: new GatewayException({
        code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
        message: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
        retryable: false
      })
    });
    await settle(app.wrapper);
    expect(app.wrapper.get('[data-error-hint]').text()).toBe(en.schemaIopRequired);
    expect(app.request).not.toHaveBeenCalled();
    expect(app.select.mock.calls.every(([operation]) => operation === 'callCapability')).toBe(true);
  });
  it.each(['currency', 'mode', 'invalid-integrity'] as const)(
    'blocks unsupported or incomplete baselines: %s',
    async (kind) => {
      const app = setup({
        mutate: (response) => {
          if (kind === 'currency') response.product_info.trade_info.price.currency = 'EUR';
          if (kind === 'mode') response.product_info.trade_info.price.price_type = 'RANGE';
          if (kind === 'invalid-integrity') response.product_info.trade_info.inventory = 'unavailable';
        }
      });
      await settle(app.wrapper);
      expect(app.wrapper.findAll('input')).toHaveLength(0);
      expect(app.wrapper.get('[data-error-hint]').text()).toBe(
        kind === 'invalid-integrity' ? en.integrityUnavailableHint : en.schemaUnsupported
      );
      expect(app.request.mock.calls.some(([op]) => op === 'updateProduct')).toBe(false);
    }
  );
  it.each([
    ['PRODUCT_SCHEMA_PRICE_INTEGRITY_MISMATCH', 'recovery-required', 'nonTargetChangedHint'],
    ['PRODUCT_SCHEMA_PRICE_READBACK_UNAVAILABLE', 'auditing', 'integrityUnavailableHint'],
    ['PRODUCT_SCHEMA_PRICE_REVIEW_PENDING', 'auditing', 'reviewPendingHint']
  ] as const)('localizes %s without reporting success or restoring', async (reasonCode, status, message) => {
    const app = setup();
    await send(app.wrapper);
    app.refresh.mockResolvedValue({ ...receipt(status, 2), reasonCode });
    await app.wrapper.get('[data-action="refresh"]').trigger('click');
    await settle(app.wrapper);
    expect(app.wrapper.get('[data-error-hint]').text()).toBe(en[message]);
    expect(app.wrapper.get('[data-status]').text()).not.toBe(en.verified);
    expect(app.wrapper.find('[data-action="review"]').exists()).toBe(false);
    expect(app.wrapper.get('[data-action="refresh"]').attributes('disabled')).toBeUndefined();
    expect(app.request.mock.calls.filter(([op]) => op === 'updateProduct')).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();
  });
  it('keeps translated Schema hints complete and renders Chinese without raw provider messages', async () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    uiI18n.global.locale.value = 'zh-CN';
    const app = setup();
    await settle(app.wrapper);
    expect(app.wrapper.text()).toContain(zh.schemaTitle);
    expect(app.wrapper.text()).toContain(zh.schemaFixedHint);
  });
});
