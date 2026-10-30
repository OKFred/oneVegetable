/**
 * Local Mock / isolated-service E2E only. The parent starts the matching Mock web
 * server and runs this file. No build, real BFF, credentials, provider requests,
 * persistent database or live Alibaba mutation is used by this harness.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import readFixture from '../../mock/data/product-read-tools.json' with { type: 'json' };
import lookupFixture from '../../mock/data/product-lookup.json' with { type: 'json' };
import maintenanceFixture from '../../mock/data/product-maintenance-api.json' with { type: 'json' };
import draftFixture from '../../mock/data/product-value-maintenance.json' with { type: 'json' };
import {
  ProductMaintenanceService,
  type ProductMaintenanceCommand,
  type ProductMaintenanceRecord,
  type ProductMaintenanceServiceRequest
} from '../../packages/core/src/product-maintenance-service';
import {
  PRODUCT_MAINTENANCE_METHODS,
  type KnownProductDraft,
  type ProductMaintenanceSnapshot
} from '../../packages/core/src/product-maintenance-api';
import { PRODUCT_READ_METHODS } from '../../packages/core/src/product-read-tools';
import { productLookup as lookupZh } from '../../packages/ui/src/i18n/messages/zh-CN/productLookup';
import { productLookup as lookupEn } from '../../packages/ui/src/i18n/messages/en-US/productLookup';
import { productReadTools as readZh } from '../../packages/ui/src/i18n/messages/zh-CN/productReadTools';
import { productReadTools as readEn } from '../../packages/ui/src/i18n/messages/en-US/productReadTools';
import { productValueMaintenance as valueZh } from '../../packages/ui/src/i18n/messages/zh-CN/productValueMaintenance';
import { productValueMaintenance as valueEn } from '../../packages/ui/src/i18n/messages/en-US/productValueMaintenance';
import { products as productsZh } from '../../packages/ui/src/i18n/messages/zh-CN/products';
import { products as productsEn } from '../../packages/ui/src/i18n/messages/en-US/products';

test.setTimeout(60_000);
test.use({ serviceWorkers: 'block' });

interface MockRead {
  operation: string;
  method: string | null;
  parameters: Record<string, unknown> | null;
}
interface BrowserHarness {
  calls: MockRead[];
  jobReads: number;
}
interface IsolatedState {
  commands: ProductMaintenanceCommand[];
  tasks: Map<string, ProductMaintenanceRecord>;
  providerAttempts: number;
  outcome: 'accepted' | 'unknown';
}
const locales = [
  { locale: 'zh-CN', lookup: lookupZh, read: readZh, value: valueZh, products: productsZh, width: 1280 },
  { locale: 'en-US', lookup: lookupEn, read: readEn, value: valueEn, products: productsEn, width: 390 }
] as const;
type Labels = (typeof locales)[number];

async function installMockHarness(
  page: Page,
  baseURL: string | undefined,
  labels: Labels
): Promise<IsolatedState> {
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
  await page.routeWebSocket(/.*/u, async (socket) => {
    await socket.close();
  });
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort('blockedbyclient')
  );
  await page.addInitScript((locale) => {
    globalThis.localStorage.setItem(
      'one-vegetable:preferences:v2',
      JSON.stringify({ uiLocale: locale, alibabaLanguage: 'en_US', theme: 'dark' })
    );
  }, labels.locale);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: labels.width, height: 900 });

  const state: IsolatedState = { commands: [], tasks: new Map(), providerAttempts: 0, outcome: 'accepted' };
  let nextId = 0;
  const service = new ProductMaintenanceService(
    {
      get: (id) => Promise.resolve(structuredClone(state.tasks.get(id) ?? null)),
      list: () => Promise.resolve(structuredClone([...state.tasks.values()])),
      save: (record, revision) => {
        if ((state.tasks.get(record.task.id)?.task.revision ?? null) !== revision)
          return Promise.reject(new Error('ENTITY_VERSION_CONFLICT'));
        state.tasks.set(record.task.id, structuredClone(record));
        return Promise.resolve();
      }
    },
    (context) =>
      Promise.resolve({
        context,
        protocol: 'iop',
        enabled: true,
        client: {
          call: (method) => {
            state.providerAttempts++;
            if (state.outcome === 'unknown') return Promise.reject(new Error('REQUEST_TIMEOUT'));
            return Promise.resolve({
              method,
              data: structuredClone(
                method === PRODUCT_MAINTENANCE_METHODS.deleteDraft
                  ? maintenanceFixture.responses.deleteOne
                  : maintenanceFixture.responses.accepted
              )
            });
          }
        },
        readProduct: (productId) =>
          Promise.resolve({
            ...structuredClone(maintenanceFixture.snapshots.matching),
            productId
          } as ProductMaintenanceSnapshot),
        knownDrafts: maintenanceFixture.service.knownDrafts as KnownProductDraft[],
        readDrafts: (ids) =>
          Promise.resolve(
            maintenanceFixture.service.draftReads.absent.filter((row) => ids.includes(row.draftId)) as {
              draftId: string;
              status: 'absent';
            }[]
          )
      }),
    () => maintenanceFixture.service.now,
    () => maintenanceFixture.service.taskIds[nextId++] ?? maintenanceFixture.persistedIntentId
  );

  await page.exposeFunction('__productApiWorkbenchControl', (request: ProductMaintenanceServiceRequest) => {
    state.commands.push(structuredClone(request.command));
    return service.execute(maintenanceFixture.service.ownerId, request);
  });
  // Install optional services before ProductsView captures them in setup().
  await page.goto('/#/dashboard');
  await expect(page.locator('html')).toHaveClass(/dark/u);

  // Reuse the existing e2e Mock-service injection boundary. Never attach to a BFF or extension runtime.
  await page.evaluate(
    ({ reads, lookup, drafts, context, methods, maintenanceMethods }) => {
      function object(value: unknown): Record<PropertyKey, unknown> {
        if (!value || typeof value !== 'object') throw new Error('MOCK_HARNESS_UNAVAILABLE');
        return value as Record<PropertyKey, unknown>;
      }
      const root = globalThis.document.querySelector('#app');
      const app = object(root && Reflect.get(root, '__vue_app__'));
      const provides = object(object(app._instance).provides);
      const key = Reflect.ownKeys(provides).find(
        (item) => typeof item === 'symbol' && item.description === 'one-vegetable-services'
      );
      if (!key) throw new Error('MOCK_HARNESS_UNAVAILABLE');
      const services = object(provides[key]);
      if (services.mode !== 'mock') throw new Error('LOCAL_MOCK_MODE_REQUIRED');
      const gateway = object(services.gateway);
      const original = gateway.request as (...args: unknown[]) => unknown;
      if (typeof original !== 'function') throw new Error('MOCK_HARNESS_UNAVAILABLE');
      const state = { calls: [] as MockRead[], jobReads: 0 };
      Reflect.set(globalThis, '__productApiWorkbench', state);
      const responses: Record<string, unknown> = {
        [lookup.method]: lookup.response,
        [methods.translation]: reads.unsafeTranslation,
        [methods.countries]: reads.countries,
        [methods.coverage]: reads.coverage
      };
      const contextMethods = new Set([...Object.keys(responses), ...Object.values(maintenanceMethods)]);
      gateway.galleryTransferContext = (operation: unknown, payload: unknown) => {
        const request = operation === 'callCapability' ? object(payload) : {};
        if (operation !== 'callCapability' && operation !== 'listShippingTemplates')
          return Promise.reject(new Error('UNEXPECTED_MOCK_CONTEXT_OPERATION'));
        if (
          operation === 'callCapability' &&
          (typeof request.method !== 'string' || !contextMethods.has(request.method))
        )
          return Promise.reject(new Error('UNEXPECTED_MOCK_CONTEXT_METHOD'));
        return Promise.resolve({ ...context, storage: null });
      };
      gateway.request = (operation: unknown, payload: unknown, options: unknown) => {
        if (operation === 'callCapability') {
          const request = object(payload);
          const method = typeof request.method === 'string' ? request.method : '';
          if (!Object.hasOwn(responses, method))
            return Promise.reject(new Error('MOCK_CAPABILITY_NOT_ALLOWLISTED'));
          state.calls.push({ operation, method, parameters: structuredClone(object(request.parameters)) });
          return Promise.resolve({
            method,
            data: structuredClone(responses[method]),
            traceId: globalThis.crypto.randomUUID(),
            contractValid: true,
            contractIssues: []
          });
        }
        if (operation === 'listShippingTemplates') {
          state.calls.push({ operation, method: null, parameters: null });
          return Promise.resolve(structuredClone(reads.templates));
        }
        if (typeof operation === 'string' && /^(?:list|get)/u.test(operation))
          return original.apply(gateway, [operation, payload, options]);
        return Promise.reject(new Error('NON_FIXTURE_OPERATION_DENIED'));
      };
      const bridge = Reflect.get(globalThis, '__productApiWorkbenchControl') as (
        request: unknown
      ) => Promise<unknown>;
      if (typeof bridge !== 'function') throw new Error('ISOLATED_CONTROL_UNAVAILABLE');
      services.productMaintenance = {
        productMaintenance: (command: unknown, scope: unknown, requestId: unknown) =>
          bridge({ requestId, context: scope, command })
      };
      services.productMutationJobs = {
        list: () => {
          state.jobReads++;
          return Promise.resolve(structuredClone(drafts));
        },
        get: () => Promise.reject(new Error('UNEXPECTED_DRAFT_RECEIPT_READ')),
        refresh: () => Promise.reject(new Error('UNEXPECTED_DRAFT_RECEIPT_REFRESH')),
        recover: () => Promise.reject(new Error('DRAFT_RECEIPT_RECOVERY_DENIED'))
      };
    },
    {
      reads: readFixture,
      lookup: lookupFixture,
      drafts: draftFixture,
      context: maintenanceFixture.service.context,
      methods: PRODUCT_READ_METHODS,
      maintenanceMethods: PRODUCT_MAINTENANCE_METHODS
    }
  );
  // Hash navigation preserves the isolated services while mounting ProductsView for the first time.
  await page.evaluate(() => {
    globalThis.location.hash = '#/products';
  });
  await expect(page.locator('table tbody tr').first().locator('td').last().getByRole('button')).toBeVisible();
  await expect(
    page.getByRole('toolbar', { name: labels.products.view.page.toolbar, exact: true })
  ).toBeVisible();
  return state;
}
async function harnessState(page: Page): Promise<BrowserHarness> {
  return page.evaluate(() => {
    const value = Reflect.get(globalThis, '__productApiWorkbench') as BrowserHarness | undefined;
    if (!value) throw new Error('MOCK_HARNESS_UNAVAILABLE');
    return structuredClone(value);
  });
}
async function expectSettledInViewport(target: Locator, width: number): Promise<void> {
  await expect(target).toBeVisible();
  // Visibility can precede the end of the CSS entry transform; do not sample that transient position.
  await expect(async () => {
    const moving = await target.evaluate((element) =>
      element.getAnimations().some((animation) => animation.pending || animation.playState === 'running')
    );
    expect(moving, 'entry animation has finished').toBe(false);
    const bounds = await target.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error('DIALOG_BOUNDS_UNAVAILABLE');
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
  }).toPass({ timeout: 5000, intervals: [50, 100, 200] });
}
async function openMoreTool(page: Page, labels: Labels, name: string): Promise<Locator> {
  await page
    .getByRole('toolbar', { name: labels.products.view.page.toolbar, exact: true })
    .getByRole('button', { name: labels.products.view.page.more, exact: true })
    .click();
  await expectSettledInViewport(page.getByRole('menu'), labels.width);
  await page.getByRole('menuitem', { name, exact: true }).click();
  const dialog = page.getByRole('dialog', { name, exact: true });
  await expectSettledInViewport(dialog, labels.width);
  return dialog;
}
async function openInventory(page: Page, labels: Labels): Promise<Locator> {
  await page.locator('table tbody tr').first().locator('td').last().getByRole('button').click();
  await page.getByRole('button', { name: labels.value.inventoryTitle, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: labels.value.inventoryTitle, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function closeDialog(dialog: Locator, name: string): Promise<void> {
  await dialog.getByRole('button', { name, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

for (const labels of locales) {
  test(`${labels.locale} dark: More opens lazy model/SKU lookup with exact explicit queries`, async ({
    page,
    baseURL
  }) => {
    const state = await installMockHarness(page, baseURL, labels);
    const dialog = await openMoreTool(page, labels, labels.lookup.title);
    expect((await harnessState(page)).calls).toHaveLength(0);
    await dialog
      .getByRole('textbox', { name: labels.lookup.modelNumber, exact: true })
      .fill(lookupFixture.queries.modelNumber);
    expect((await harnessState(page)).calls).toHaveLength(0);
    await dialog.getByRole('button', { name: labels.lookup.search, exact: true }).click();
    await expect(
      dialog.getByRole('cell', { name: lookupFixture.queries.modelNumber, exact: true }).first()
    ).toBeVisible();
    await dialog.getByRole('textbox', { name: labels.lookup.modelNumber, exact: true }).fill('');
    await dialog
      .getByRole('textbox', { name: labels.lookup.skuCode, exact: true })
      .fill(lookupFixture.queries.skuCode);
    expect((await harnessState(page)).calls).toHaveLength(1);
    await dialog.getByRole('button', { name: labels.lookup.search, exact: true }).click();
    await expect.poll(async () => (await harnessState(page)).calls.length).toBe(2);
    const calls = (await harnessState(page)).calls;
    expect(calls.map((call) => call.method)).toEqual([lookupFixture.method, lookupFixture.method]);
    expect(calls[0]?.parameters).toEqual({
      model_number: lookupFixture.queries.modelNumber,
      page_index: 1,
      page_size: 20
    });
    expect(calls[1]?.parameters).toEqual({
      sku_code: lookupFixture.queries.skuCode,
      page_index: 1,
      page_size: 20
    });
    await expect(dialog.getByText('synthetic-owner-never-display', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(state.providerAttempts).toBe(0);
    expect(state.commands).toHaveLength(0);
  });

  test(`${labels.locale} dark: More translation is explicit, literal and copy-only`, async ({
    page,
    baseURL
  }) => {
    const state = await installMockHarness(page, baseURL, labels);
    const dialog = await openMoreTool(page, labels, labels.read.translationTitle);
    expect((await harnessState(page)).calls).toHaveLength(0);
    const input = readFixture.translationInput;
    await dialog.getByRole('textbox', { name: labels.read.appName, exact: true }).fill(input.appName);
    await dialog
      .getByRole('textbox', { name: labels.read.sourceLanguage, exact: true })
      .fill(input.sourceLanguage);
    await dialog
      .getByRole('textbox', { name: labels.read.targetLanguage, exact: true })
      .fill(input.targetLanguage);
    await dialog.getByRole('textbox', { name: labels.read.sourceText, exact: true }).fill(input.text);
    expect((await harnessState(page)).calls).toHaveLength(0);
    await dialog.getByRole('button', { name: labels.read.translate, exact: true }).click();
    await expect(dialog.locator('[data-result="translation"] pre')).toHaveText(
      readFixture.unsafeTranslation.result[0]?.translate_result_text ?? ''
    );
    await expect(dialog.locator('script, img')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: labels.read.copy, exact: true })).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: /^(?:Apply|Publish|Save|应用|发布|保存)$/u })
    ).toHaveCount(0);
    const calls = (await harnessState(page)).calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe(PRODUCT_READ_METHODS.translation);
    expect(calls[0]?.parameters).toMatchObject({
      icbu_translate_task_dto: [{ app_name: input.appName, format: 'text', source_text: input.text }]
    });
    await closeDialog(dialog, labels.read.close);
    expect(state.providerAttempts).toBe(0);
    expect(state.commands).toHaveLength(0);
  });

  test(`${labels.locale} dark: More shipping separates countries from determinacy and never quotes money`, async ({
    page,
    baseURL
  }) => {
    const state = await installMockHarness(page, baseURL, labels);
    const dialog = await openMoreTool(page, labels, labels.read.shippingTitle);
    expect((await harnessState(page)).calls).toHaveLength(0);
    await dialog.getByRole('button', { name: labels.read.loadCountries, exact: true }).click();
    await expect(dialog.locator('[data-result="countries"]')).toContainText(readFixture.countries.trace_id);
    await expect(dialog.locator('[data-result="coverage"]')).toHaveCount(0);
    await dialog.getByRole('button', { name: labels.read.loadTemplates, exact: true }).click();
    await expect(
      dialog.locator('select option').filter({
        hasText: readFixture.templates[0]?.name ?? 'MISSING_FIXTURE'
      })
    ).toHaveCount(1);
    const input = readFixture.shippingInput;
    for (const [field, value] of Object.entries({
      templateId: input.shippingTemplateId,
      weight: input.weightKg,
      length: input.lengthCm,
      width: input.widthCm,
      height: input.heightCm,
      moq: String(input.moq)
    }))
      await dialog.locator('[data-field="' + field + '"]').fill(value);
    await dialog.locator('[data-field="productType"]').selectOption(String(input.productType));
    expect(
      (await harnessState(page)).calls.filter((call) => call.method === PRODUCT_READ_METHODS.coverage)
    ).toHaveLength(0);
    await dialog.getByRole('button', { name: labels.read.queryCoverage, exact: true }).click();
    const coverage = dialog.locator('[data-result="coverage"]');
    await expect(coverage).toContainText(labels.read.certain);
    await expect(coverage).toContainText(labels.read.uncertain);
    await expect(coverage).toContainText(labels.read.unknown);
    await expect(dialog.getByText(labels.read.shippingHint, { exact: true })).toBeVisible();
    await expect(coverage).not.toContainText('USD');
    const calls = (await harnessState(page)).calls.filter(
      (call) => call.method === PRODUCT_READ_METHODS.coverage
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.parameters).toEqual(readFixture.shippingRequest);
    await closeDialog(dialog, labels.read.close);
    expect(state.providerAttempts).toBe(0);
  });

  test(`${labels.locale} dark: More draft receipts only offers current verified IOP draft records`, async ({
    page,
    baseURL
  }) => {
    const state = await installMockHarness(page, baseURL, labels);
    const dialog = await openMoreTool(page, labels, labels.value.draftsTitle);
    expect((await harnessState(page)).jobReads).toBe(0);
    await dialog.getByRole('button', { name: labels.value.loadDrafts, exact: true }).click();
    await expect(dialog.locator('[data-action="prepare-delete"]')).toHaveCount(1);
    await expect(
      dialog.getByText(draftFixture.items[0]?.productId ?? 'MISSING_FIXTURE', { exact: true })
    ).toBeVisible();
    await expect(
      dialog.getByText(draftFixture.items[4]?.productId ?? 'MISSING_FIXTURE', { exact: true })
    ).toHaveCount(0);
    await expect(dialog.locator('input')).toHaveCount(0);
    expect((await harnessState(page)).jobReads).toBe(1);
    expect(state.commands).toHaveLength(0);
    expect(state.providerAttempts).toBe(0);
    await closeDialog(dialog, labels.value.close);
  });
}

test('maintenance prepared preview survives closing and is restored through explicit task listing', async ({
  page,
  baseURL
}) => {
  const labels = locales[0];
  const state = await installMockHarness(page, baseURL, labels);
  let dialog = await openInventory(page, labels);
  expect(state.commands).toHaveLength(0);
  await dialog
    .getByRole('textbox', { name: labels.value.inventory, exact: true })
    .fill(maintenanceFixture.drafts.inventory.inventory);
  await dialog.getByRole('button', { name: labels.value.prepare, exact: true }).click();
  await expect(dialog.locator('[data-result="preview"]')).toBeVisible();
  expect(state.commands.map((command) => command.action)).toEqual(['create']);
  expect(state.providerAttempts).toBe(0);
  const taskId = [...state.tasks.keys()][0];
  expect(taskId).toBeTruthy();
  await expect(dialog.getByText(labels.value.closeHint, { exact: true })).toBeVisible();
  await closeDialog(dialog, labels.value.close);
  dialog = await openInventory(page, labels);
  expect(state.commands).toHaveLength(1);
  await dialog.getByRole('button', { name: labels.value.loadTasks, exact: true }).click();
  await dialog.locator('[data-action="select-task"]').click();
  await expect(dialog.locator('[data-result="preview"]')).toContainText(taskId ?? 'MISSING_TASK');
  await expect(dialog.getByText(labels.value.resumedHint, { exact: true })).toBeVisible();
  await expect(dialog.locator('[data-action="review"]')).toBeDisabled();
  expect(state.commands.map((command) => command.action)).toEqual(['create', 'list']);
  await dialog.getByRole('button', { name: labels.value.cancelPreview, exact: true }).click();
  await expect(dialog.locator('[data-result="preview"]')).toHaveCount(0);
  expect(state.commands.map((command) => command.action)).toEqual(['create', 'list', 'cancel']);
  expect(state.providerAttempts).toBe(0);
  expect(taskId ? state.tasks.get(taskId)?.task.status : null).toBe('cancelled');
});

test('unknown maintenance result survives reopening and cannot be resent or automatically verified', async ({
  page,
  baseURL
}) => {
  const labels = locales[1];
  const state = await installMockHarness(page, baseURL, labels);
  state.outcome = 'unknown';
  let dialog = await openInventory(page, labels);
  await dialog
    .getByRole('textbox', { name: labels.value.inventory, exact: true })
    .fill(maintenanceFixture.drafts.inventory.inventory);
  await dialog.getByRole('button', { name: labels.value.prepare, exact: true }).click();
  await expect(dialog.locator('[data-result="preview"]')).toBeVisible();
  await dialog.getByRole('button', { name: labels.value.confirm, exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: labels.value.confirmTitle, exact: true });
  await expect(confirmation).toBeVisible();
  expect(state.providerAttempts).toBe(0);
  await confirmation.getByRole('button', { name: labels.value.sendOnce, exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(dialog.locator('[data-status]')).toHaveText(labels.value.ambiguous);
  expect(state.providerAttempts).toBe(1);
  await closeDialog(dialog, labels.value.close);
  dialog = await openInventory(page, labels);
  await dialog.getByRole('button', { name: labels.value.loadTasks, exact: true }).click();
  await dialog.locator('[data-action="select-task"]').click();
  await expect(dialog.locator('[data-status]')).toHaveText(labels.value.ambiguous);
  await expect(dialog.locator('[data-action="review"]')).toBeDisabled();
  await expect(dialog.locator('[data-action="verify"]')).toBeEnabled();
  expect(state.commands.filter((command) => command.action === 'send')).toHaveLength(1);
  expect(state.commands.filter((command) => command.action === 'verify')).toHaveLength(0);
  await dialog.getByRole('button', { name: labels.value.refresh, exact: true }).click();
  await expect.poll(() => state.commands.filter((command) => command.action === 'get').length).toBe(1);
  await expect(dialog.locator('[aria-busy]')).toHaveAttribute('aria-busy', 'false');
  expect(state.providerAttempts).toBe(1);
  expect(state.commands.filter((command) => command.action === 'send')).toHaveLength(1);
  expect(state.commands.filter((command) => command.action === 'verify')).toHaveLength(0);
});
