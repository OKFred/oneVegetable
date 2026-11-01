// Local Mock only: inject services before ProductsView mounts; never use provider credentials.
import { expect, test, type Locator, type Page } from '@playwright/test';
import schema from '../../mock/data/product-schema-price.json' with { type: 'json' };
import integrity from '../../mock/data/product-maintenance-integrity.json' with { type: 'json' };
import type { ProductSchemaUpdateRequest } from '../../packages/core/src/types';
import type { ProductMutationJob } from '../../packages/core/src/product-mutation-job';
import { IOP_REFERENCE_METHODS } from '../../packages/core/src/product-reference-methods';
import { productValueMaintenance as en } from '../../packages/ui/src/i18n/messages/en-US/productValueMaintenance';
import { productValueMaintenance as zh } from '../../packages/ui/src/i18n/messages/zh-CN/productValueMaintenance';

test.setTimeout(60_000);
test.use({ serviceWorkers: 'block' });
const source = integrity.snapshot;
const context = { identity: 'a'.repeat(64), gateway: 'b'.repeat(64) };
const locales = [
  { locale: 'en-US', labels: en, width: 1280 },
  { locale: 'zh-CN', labels: zh, width: 390 }
] as const;
type Labels = (typeof locales)[number];
interface Harness {
  calls: { operation: string; payload: unknown; options: unknown }[];
  submissions: ProductSchemaUpdateRequest[];
  refreshes: { id: string; revision: number }[];
  selected: { operation: unknown; payload: unknown }[];
  job: ProductMutationJob | null;
  refreshVerified: boolean;
}

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

async function installHarness(
  page: Page,
  baseURL: string | undefined,
  labels: Labels,
  outcome: 'accepted' | 'unknown' | 'top-only' = 'accepted'
) {
  if (!baseURL) throw new Error('LOCAL_MOCK_BASE_URL_REQUIRED');
  const base = new URL(baseURL);
  if (
    base.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('LOCAL_MOCK_BASE_URL_REQUIRED');
  await page.routeWebSocket(/.*/u, (socket) => socket.close());
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === base.origin &&
    !new URL(route.request().url()).pathname.startsWith('/api/')
      ? route.continue()
      : route.abort('blockedbyclient')
  );
  await page.addInitScript((locale) => {
    localStorage.setItem(
      'one-vegetable:preferences:v2',
      JSON.stringify({
        uiLocale: locale,
        alibabaLanguage: 'en_US',
        theme: 'dark'
      })
    );
  }, labels.locale);
  await page.setViewportSize({ width: labels.width, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/#/dashboard');
  await expect(page.locator('html')).toHaveClass(/dark/u);
  await page.evaluate(
    ({ source, reference, xml, context, method, outcome }) => {
      function object(value: unknown): Record<PropertyKey, unknown> {
        if (!value || typeof value !== 'object') throw new Error('MOCK_HARNESS_UNAVAILABLE');
        return value as Record<PropertyKey, unknown>;
      }
      const root = document.querySelector('#app');
      const app = object(root && Reflect.get(root, '__vue_app__'));
      const provides = object(object(app._instance).provides);
      const key = Reflect.ownKeys(provides).find(
        (key) => typeof key === 'symbol' && key.description === 'one-vegetable-services'
      );
      if (!key) throw new Error('MOCK_HARNESS_UNAVAILABLE');
      const services = object(provides[key]);
      if (services.mode !== 'mock') throw new Error('LOCAL_MOCK_MODE_REQUIRED');
      const gateway = object(services.gateway);
      const original = gateway.request as (...args: unknown[]) => Promise<unknown>;
      const state: Harness = {
        calls: [],
        submissions: [],
        refreshes: [],
        selected: [],
        job: null,
        refreshVerified: false
      };
      Reflect.set(globalThis, '__schemaPriceE2E', state);
      gateway.galleryTransferContext = (operation: unknown, payload: unknown) => {
        if (operation === undefined) return Promise.resolve({ ...context, storage: null });
        state.selected.push({ operation, payload: structuredClone(payload) });
        if (operation !== 'callCapability' || object(payload).method !== method)
          return Promise.reject(new Error('UNEXPECTED_MOCK_CONTEXT'));
        if (outcome === 'top-only') return Promise.reject(new Error('ALIBABA_IOP_AUTHORIZATION_REQUIRED'));
        return Promise.resolve({ ...context, storage: null });
      };
      gateway.request = (operation: string, payload: unknown, options: unknown) => {
        if (['callCapability', 'renderProductSchema', 'updateProduct'].includes(operation)) {
          state.calls.push({
            operation,
            payload: structuredClone(payload),
            options: structuredClone(options)
          });
          if (JSON.stringify(object(options).productContext) !== JSON.stringify(context))
            return Promise.reject(new Error('EXPECTED_IOP_CONTEXT_REQUIRED'));
          if (operation === 'callCapability') {
            if (object(payload).method !== method)
              return Promise.reject(new Error('NON_FIXTURE_METHOD_DENIED'));
            return Promise.resolve({
              method,
              contractValid: true,
              contractIssues: [],
              data: structuredClone(reference)
            });
          }
          if (operation === 'renderProductSchema')
            return Promise.resolve({
              xml,
              categoryId: Number(source.categoryId),
              language: source.language,
              market: 'alibaba'
            });
          const request = structuredClone(payload) as ProductSchemaUpdateRequest;
          state.submissions.push(request);
          if (state.submissions.length !== 1) return Promise.reject(new Error('DUPLICATE_MUTATION_DENIED'));
          if (outcome === 'unknown') return Promise.reject(new Error('REQUEST_TIMEOUT'));
          const now = Date.now();
          state.job = {
            id: 'synthetic-schema-price-job',
            requestId: String(object(options).requestId),
            productId: source.productId,
            protocol: 'iop',
            productContext: context,
            operation: 'updateProduct',
            status: 'auditing',
            revision: 1,
            categoryId: Number(source.categoryId),
            language: 'en_US',
            payloadFingerprint: 'c'.repeat(64),
            fieldExpectations: [
              { fieldId: 'ladderPrice', fingerprint: 'd'.repeat(64), priceGuard: request.priceGuard },
              { fieldId: 'modelNumber', fingerprint: 'e'.repeat(64) }
            ],
            encryptedProductId: null,
            targetDisplay: null,
            originalDisplay: null,
            traceId: null,
            reasonCode: null,
            message: null,
            submittedTimeUtc: now,
            lastCheckedTimeUtc: null,
            completedTimeUtc: null,
            createTimeUtc: now,
            updateTimeUtc: now,
            creatorId: 'synthetic',
            updaterId: 'synthetic',
            remark: null
          };
          return Promise.resolve({ success: true, job: structuredClone(state.job) });
        }
        if (operation === 'listProducts')
          return Promise.resolve({
            page: 1,
            pageSize: 20,
            total: 1,
            items: [
              {
                id: source.productId,
                subject: source.title,
                status: 'online',
                encryptedId: null,
                groupName: 'Synthetic',
                score: 0,
                imageUrl: null,
                detailUrl: null,
                categoryId: Number(source.categoryId),
                updatedAt: '2026-01-01T00:00:00.000Z'
              }
            ]
          });
        if (/^(?:list|get)/u.test(operation)) return original.apply(gateway, [operation, payload, options]);
        return Promise.reject(new Error('NON_FIXTURE_OPERATION_DENIED'));
      };
      services.productMutationJobs = {
        list: () => Promise.resolve({ items: [], page: 1, pageSize: 100, total: 0 }),
        get: () => Promise.reject(new Error('UNEXPECTED_TASK_READ')),
        refresh: (id: string, revision: number) => {
          state.refreshes.push({ id, revision });
          if (state.job?.id !== id || revision !== state.job.revision)
            return Promise.reject(new Error('UNEXPECTED_TASK_REFRESH'));
          state.job = {
            ...state.job,
            revision: revision + 1,
            status: state.refreshVerified ? 'verified' : 'auditing',
            lastCheckedTimeUtc: Date.now()
          };
          return Promise.resolve(structuredClone(state.job));
        },
        recover: () => Promise.reject(new Error('NO_AUTOMATIC_RECOVERY'))
      };
    },
    {
      source,
      reference: referenceResponse(),
      xml: schema.nestedXml,
      context,
      method: IOP_REFERENCE_METHODS.getProduct,
      outcome
    }
  );
  await page.evaluate(() => {
    location.hash = '#/products';
  });
  await expect(page.getByRole('cell', { name: source.title, exact: true })).toBeVisible();
}

async function state(page: Page): Promise<Harness> {
  return page.evaluate(() => structuredClone(Reflect.get(globalThis, '__schemaPriceE2E') as Harness));
}
async function openPrice(page: Page, labels: Labels): Promise<Locator> {
  await page.locator('table tbody tr').first().locator('td').last().getByRole('button').click();
  await page.getByRole('button', { name: labels.labels.priceTitle, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: labels.labels.schemaTitle, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function preview(dialog: Locator) {
  await expect(dialog.locator('[data-field="price-0"]')).toBeEnabled();
  await dialog.locator('[data-field="price-0"]').fill('1.01');
  await dialog.locator('[data-action="preview"]').click();
  await expect(dialog.locator('[data-result="preview"]')).toContainText('1.00 → 1.01 USD');
}

for (const labels of locales) {
  test(
    labels.locale + ': price menu uses guarded Schema, confirms once and waits for verified readback',
    async ({ page, baseURL }) => {
      await installHarness(page, baseURL, labels);
      const dialog = await openPrice(page, labels);
      await expect(dialog.locator('form input')).toHaveCount(2);
      await expect(dialog.locator('form input').first()).toHaveValue('1.00');
      await expect(dialog.locator('form input').last()).toHaveValue('0.90');
      await expect(dialog.locator('tbody th')).toHaveText(['1', '10']);
      await expect(dialog.locator('select')).toHaveCount(0);
      await expect(dialog.getByText(labels.labels.schemaFixedHint, { exact: true })).toBeVisible();
      await expect(dialog.getByText(labels.labels.currency + ': USD', { exact: true })).toBeVisible();
      expect((await state(page)).calls.map((call) => call.operation)).toEqual([
        'callCapability',
        'renderProductSchema'
      ]);
      await preview(dialog);
      expect((await state(page)).submissions).toHaveLength(0);
      await dialog.locator('[data-action="review"]').click();
      const confirmation = page.getByRole('dialog', { name: labels.labels.confirmTitle, exact: true });
      await expect(confirmation).toBeVisible();
      expect((await state(page)).submissions).toHaveLength(0);
      await page.keyboard.press('Escape');
      await expect(confirmation).toHaveCount(0);
      await expect(dialog.locator('[data-result="preview"]')).toBeVisible();
      expect((await state(page)).submissions).toHaveLength(0);
      await dialog.locator('[data-action="review"]').click();
      await confirmation.getByRole('button', { name: labels.labels.sendOnce, exact: true }).click();
      await expect.poll(async () => (await state(page)).submissions.length).toBe(1);
      await expect(dialog.locator('[data-status]')).toHaveText(labels.labels.schemaAuditing);
      await expect(page.getByText(labels.labels.schemaVerified, { exact: true })).toHaveCount(0);
      await expect(dialog.locator('[data-action="review"]')).toHaveCount(0);
      for (const input of await dialog.locator('form input').all()) await expect(input).toBeDisabled();

      const sent = await state(page);
      const request = sent.submissions[0];
      expect(request).toMatchObject({
        productId: source.productId,
        categoryId: Number(source.categoryId),
        language: 'en_US',
        priceGuard: {
          version: 1,
          draft: {
            operation: 'setPrice',
            productId: source.productId,
            mode: 'tiered',
            currency: 'USD',
            tiers: [
              { quantity: '1', price: '1.01' },
              { quantity: '10', price: '0.90' }
            ]
          }
        }
      });
      const patch = await page.evaluate((xml) => {
        const root = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
        return {
          roots: [...root.children].map((field) => field.getAttribute('id')),
          models: [...root.querySelectorAll('field[id="modelNumber"] value')].map(
            (value) => value.textContent
          ),
          quantities: [...root.querySelectorAll('field[id="quantity"] > value')]
            .map((value) => value.textContent)
            .filter(Boolean),
          currencies: [...root.querySelectorAll('field[id="currency"] > value')].map(
            (value) => value.textContent
          ),
          prices: [...root.querySelectorAll('field[id="price"]')]
            .map((value) => value.textContent.trim())
            .filter(Boolean),
          parserError: root.querySelector('parsererror') !== null
        };
      }, request.schemaPatchXml);
      expect(patch).toEqual({
        roots: ['modelNumber', 'ladderPrice'],
        models: [source.modelNumber],
        quantities: ['1', '10'],
        currencies: ['USD'],
        prices: ['1.01', '0.90'],
        parserError: false
      });
      expect(sent.selected.length).toBeGreaterThan(0);
      for (const selection of sent.selected)
        expect(selection).toEqual({
          operation: 'callCapability',
          payload: { method: IOP_REFERENCE_METHODS.getProduct, parameters: { product_id: source.productId } }
        });
      for (const call of sent.calls) expect(call.options).toMatchObject({ productContext: context });
      expect(sent.calls.filter((call) => call.operation === 'updateProduct')).toHaveLength(1);

      await dialog.locator('[data-action="refresh"]').click();
      await expect.poll(async () => (await state(page)).refreshes.length).toBeGreaterThanOrEqual(1);
      await expect(dialog.locator('[data-status]')).toHaveText(labels.labels.schemaAuditing);
      await expect(page.getByText(labels.labels.schemaVerified, { exact: true })).toHaveCount(0);
      await page.evaluate(() => {
        (Reflect.get(globalThis, '__schemaPriceE2E') as Harness).refreshVerified = true;
      });
      await expect(dialog.locator('[data-action="refresh"]')).toBeEnabled();
      await dialog.locator('[data-action="refresh"]').click();
      await expect(dialog.locator('[data-status]')).toHaveText(labels.labels.verified);
      await expect(page.getByText(labels.labels.schemaVerified, { exact: true })).toBeVisible();
      await expect(dialog.locator('[data-action="refresh"]')).toHaveCount(0);
      expect((await state(page)).submissions).toHaveLength(1);
    }
  );

  test(labels.locale + ': unknown Schema outcome cannot submit or retry again', async ({ page, baseURL }) => {
    await page.clock.install();
    await installHarness(page, baseURL, labels, 'unknown');
    const dialog = await openPrice(page, labels);
    await preview(dialog);
    await dialog.locator('[data-action="review"]').click();
    await page
      .getByRole('dialog', { name: labels.labels.confirmTitle, exact: true })
      .getByRole('button', { name: labels.labels.sendOnce, exact: true })
      .click();
    await expect(dialog.locator('[data-status]')).toHaveText(labels.labels.schemaUnknown);
    await expect(dialog.getByText(labels.labels.schemaAttempted, { exact: true })).toBeVisible();
    await expect(dialog.locator('[data-action="review"], [data-action="refresh"]')).toHaveCount(0);
    await expect(dialog.locator('[data-action="preview"]')).toBeDisabled();
    await expect(page.getByText(labels.labels.schemaVerified, { exact: true })).toHaveCount(0);
    await page.clock.fastForward(30_000);
    await dialog.locator('form').evaluate((form) => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect((await state(page)).submissions).toHaveLength(1);
    expect((await state(page)).refreshes).toHaveLength(0);
    await expect(dialog.locator('[data-action="task-center"]')).toBeVisible();
  });

  test(
    labels.locale + ': TOP-only explicitly needs IOP without a write or fallback',
    async ({ page, baseURL }) => {
      await installHarness(page, baseURL, labels, 'top-only');
      const dialog = await openPrice(page, labels);
      await expect(dialog.locator('[data-error-hint]')).toHaveText(labels.labels.schemaIopRequired);
      await expect(dialog.locator('input, [data-action="preview"], [data-action="review"]')).toHaveCount(0);
      const snapshot = await state(page);
      expect(snapshot.calls).toHaveLength(0);
      expect(snapshot.submissions).toHaveLength(0);
      expect(snapshot.refreshes).toHaveLength(0);
      expect(snapshot.selected).toHaveLength(1);
    }
  );
}
