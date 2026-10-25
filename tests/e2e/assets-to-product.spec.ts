import { expect, test, type Page } from '@playwright/test';
import type { GalleryTransferContext } from '../../packages/core/src/gallery-transfer-task';
import type { ProductOperationContext } from '../../packages/core/src/product-operation-context';
import { products as productsEn } from '../../packages/ui/src/i18n/messages/en-US/products';
import { photos as photosEn } from '../../packages/ui/src/i18n/messages/en-US/photos';
import { shell as shellEn } from '../../packages/ui/src/i18n/messages/en-US/shell';
import { GATEWAY_CONFIGURATION_EVENT } from '../../packages/ui/src/lib/gateway-configuration-events';
import fixture from '../../mock/data/assets-to-product.json' with { type: 'json' };
import photoFixture from '../../mock/data/photos.json' with { type: 'json' };
import productFixture from '../../mock/data/products.json' with { type: 'json' };

interface SeedHarness {
  requests: {
    operation: string;
    payload: Record<string, unknown>;
    options: { galleryContext?: GalleryTransferContext; productContext?: ProductOperationContext } | null;
  }[];
  contextCalls: { operation: string; payload: Record<string, unknown> }[];
  schema: 'fresh' | 'existing';
  sourceContext: GalleryTransferContext;
  productContext: GalleryTransferContext;
  draftRemaining: number;
  pauseContextOperation: string | null;
  waitingForContext: boolean;
  completedGates: number;
}
declare global {
  interface Window {
    __assetsToProduct: SeedHarness;
    __assetsToProductHashes: string[];
    __releaseProductPhotoContext?: () => void;
  }
}
const mutations = [
  'publishProduct',
  'saveProductDraft',
  'updateProduct',
  'uploadPhoto',
  'transferPhotoFromUrl'
];

test.beforeEach(async ({ context, page }) => {
  // The normal mock-mode Web entrypoint remains in use. All provider/BFF
  // requests are blocked, and response data comes only from mock/data.
  await context.route('https://**', (route) => route.abort());
  await context.route('**/api/v1/**', (route) => route.abort());
  await context.addInitScript(() => {
    localStorage.setItem(
      'one-vegetable:preferences:v2',
      JSON.stringify({
        uiLocale: 'en-US',
        alibabaLanguage: 'en_US',
        theme: 'light'
      })
    );
    window.__assetsToProductHashes = [];
    window.addEventListener('hashchange', (event) => {
      window.__assetsToProductHashes.push(new URL(event.newURL).hash);
    });
  });
  await page.route(/\/packages\/core\/src\/mock-product-maintenance\.ts(?:\?|$)/u, async (route) => {
    const response = await route.fetch();
    const instrumentation = `
const __seedFixture = ${JSON.stringify(fixture)};
const __seedExistingSchema = ${JSON.stringify(productFixture.responses.getProductSchema)};
const __seedDraftResponse = ${JSON.stringify(productFixture.responses.saveProductDraft)};
const __seedMutations = ${JSON.stringify(mutations)};
const __seedProductOperations = ${JSON.stringify(fixture.productOperations)};
const __seedState = globalThis.__assetsToProduct = {
  requests: [], contextCalls: [], schema: 'fresh', draftRemaining: 0,
  pauseContextOperation: null, waitingForContext: false, completedGates: 0,
  sourceContext: structuredClone(__seedFixture.sourceContext),
  productContext: structuredClone(__seedFixture.productContext)
};
const __seedOriginalRequest = MockProductMaintenanceGateway.prototype.request;
// Model the extension/plugin message boundary: Vue proxies must fail here.
MockProductMaintenanceGateway.prototype.request = async function(operation, payload, options) {
  __seedState.requests.push({
    operation, payload: structuredClone(payload), options: structuredClone(options ?? null)
  });
  if (__seedProductOperations.includes(operation) && options?.galleryContext)
    throw new Error('Product requests must not carry galleryContext');
  if (__seedProductOperations.includes(operation) && options?.productContext &&
      Object.keys(options.productContext).sort().join(',') !== 'gateway,identity')
    throw new Error('Product context must contain identity and gateway only');
  if (__seedMutations.includes(operation)) {
    if (operation !== 'saveProductDraft' || __seedState.draftRemaining !== 1)
      throw new Error('Unexpected write: ' + operation);
    __seedState.draftRemaining = 0;
    return structuredClone(__seedDraftResponse);
  }
  if (operation === 'getProductSchema')
    return structuredClone(__seedState.schema === 'fresh' ? __seedFixture.freshSchema : __seedExistingSchema);
  return __seedOriginalRequest.call(this, operation, payload, options);
};
MockProductMaintenanceGateway.prototype.galleryTransferContext = async function(operation, payload) {
  __seedState.contextCalls.push({ operation, payload: structuredClone(payload) });
  if (__seedState.pauseContextOperation === operation) {
    __seedState.pauseContextOperation = null;
    __seedState.waitingForContext = true;
    await new Promise((resolve) => {
      globalThis.__releaseProductPhotoContext = () => {
        delete globalThis.__releaseProductPhotoContext;
        resolve();
      };
    });
    __seedState.waitingForContext = false;
    __seedState.completedGates++;
  }
  return structuredClone(operation === 'listPhotos' ? __seedState.sourceContext : __seedState.productContext);
};
`;
    await route.fulfill({
      response,
      contentType: 'application/javascript',
      body: (await response.text()) + '\n' + instrumentation
    });
  });
});

async function state(page: Page): Promise<SeedHarness> {
  return page.evaluate(() => window.__assetsToProduct);
}

async function expectNoWrites(page: Page): Promise<void> {
  expect((await state(page)).requests.filter((call) => mutations.includes(call.operation))).toEqual([]);
}

async function armDraftClick(page: Page, pauseContext = false): Promise<void> {
  await expectNoWrites(page);
  await page.evaluate(
    ({ label, pause }) => {
      const harness = window.__assetsToProduct;
      harness.pauseContextOperation = pause ? 'publishProduct' : null;
      document.addEventListener(
        'click',
        (event) => {
          const button = event.target instanceof Element ? event.target.closest('button') : null;
          if (event.isTrusted && button?.textContent.trim() === label) harness.draftRemaining = 1;
        },
        { capture: true }
      );
    },
    { label: productsEn.editor.savePlatformDraft, pause: pauseContext }
  );
  expect((await state(page)).draftRemaining).toBe(0);
  await expectNoWrites(page);
}

async function releaseContext(page: Page): Promise<void> {
  await page.evaluate(() => {
    const release = window.__releaseProductPhotoContext;
    if (!release) throw new Error('No delayed context to release');
    release();
  });
  await page.waitForFunction(
    () => !window.__assetsToProduct.waitingForContext && window.__assetsToProduct.completedGates === 1
  );
}

async function openSeed(page: Page, count: number) {
  await page.goto('/#/photos');
  const action = page.getByRole('button', { name: 'Use for new product', exact: true });
  await expect(action).toBeDisabled();
  const cards = page.getByTestId('photo-card-grid').getByRole('checkbox');
  await expect(cards).toHaveCount(photoFixture.responses.listPhotos.items.length);
  for (let index = 0; index < count; index++) await cards.nth(index).check();
  await expect(action).toBeEnabled();
  const listed = await state(page);
  const listingRequest = listed.requests.find((call) => call.operation === fixture.listedMetadata.operation);
  expect(listingRequest?.options?.galleryContext).toEqual(fixture.sourceContext);
  expect(listingRequest?.options?.galleryContext?.storage).toBe(fixture.sourceContext.storage);
  const previousSourceCalls = listed.contextCalls.filter((call) => call.operation === 'listPhotos').length;
  expect(listed.contextCalls).toContainEqual({
    operation: 'listPhotos',
    payload: listingRequest?.payload
  });
  await expectNoWrites(page);
  await action.click();
  await expect(page).toHaveURL(/#\/products\/publisher\/quick\/basics\/new(?:\/|$)/u);
  const panel = page.getByTestId('product-photo-seed');
  await expect(panel.getByRole('heading')).toHaveText('Images for this product \u00b7 ' + String(count));
  await expect(panel.locator('img')).toHaveCount(count);
  const handedOff = await state(page);
  expect(
    handedOff.contextCalls.filter((call) => call.operation === 'listPhotos').slice(previousSourceCalls)[0]
      ?.payload
  ).toEqual(listingRequest?.payload);
  expect(handedOff.requests.filter((call) => call.operation === 'getProductSchema')).toEqual([]);
  await expectNoWrites(page);
  return panel;
}

async function chooseCategoryAndRequestForm(page: Page): Promise<void> {
  const category = page.getByRole('combobox', { name: productsEn.categoryPicker.choose, exact: true });
  await expect(category).toHaveCount(1);
  await category.click();
  const picker = page.getByRole('dialog', { name: productsEn.categoryPicker.title, exact: true });
  await picker.getByRole('button', { name: /Consumer Electronics/u }).click();
  await picker.getByRole('button', { name: /Portable Power Stations/u }).click();
  await expect(picker).toBeHidden();
  await page.getByRole('button', { name: 'Start editing', exact: true }).click();
}

async function loadCategory(page: Page): Promise<void> {
  await chooseCategoryAndRequestForm(page);
  await expect(page.getByRole('group', { name: 'Product editor mode' })).toBeVisible();
}

async function openXml(page: Page): Promise<void> {
  await page
    .getByRole('group', { name: 'Product editor mode' })
    .getByRole('button', { name: 'Advanced mode', exact: true })
    .click();
  await page.locator('summary').filter({ hasText: productsEn.editor.xmlPreview }).click();
}

async function imageValues(page: Page) {
  const xml = await page.locator('pre').filter({ hasText: 'scImages' }).textContent();
  return page.evaluate((value) => {
    const document = new DOMParser().parseFromString(value ?? '', 'application/xml');
    return Array.from(document.querySelectorAll('field[id="scImages"] value')).map((node) => ({
      id: node.getAttribute('fileId'),
      url: node.textContent
    }));
  }, xml);
}

test('selection is an opaque one-use handoff; latest category images and file IDs survive editor modes', async ({
  page
}) => {
  const panel = await openSeed(page, 2);
  const hashes = await page.evaluate(() => window.__assetsToProductHashes);
  expect(hashes).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^#\/products\/from-assets\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u)
    ])
  );
  const photos = photoFixture.responses.listPhotos.items.slice(0, 2);
  for (const [index, photo] of photos.entries()) {
    await expect(panel.locator('img').nth(index)).toHaveAttribute('src', photo.url);
    await expect(panel.locator('img').nth(index)).toHaveAttribute('alt', photo.name);
  }
  await loadCategory(page);
  await expect(panel.getByRole('status')).toContainText('2 images added.');
  await expect(panel.locator('img')).toHaveCount(0);
  await expect(page.getByTestId('selected-photo-strip').locator('img')).toHaveCount(2);
  const schema = (await state(page)).requests.filter((call) => call.operation === 'getProductSchema');
  expect(schema).toHaveLength(1);
  expect(schema[0]).toMatchObject({
    payload: { categoryId: fixture.freshSchema.categoryId, language: 'en_US' },
    options: { productContext: fixture.productOperationContext }
  });
  expect(schema[0]?.options).not.toHaveProperty('galleryContext');
  expect(schema[0]?.options?.productContext).not.toHaveProperty('storage');
  await expect(page.getByRole('textbox', { name: 'Product name', exact: true })).toHaveValue(
    'Latest category fixture title'
  );
  await page.getByRole('textbox', { name: 'Product name', exact: true }).fill('Edited seeded product');
  const modes = page.getByRole('group', { name: 'Product editor mode' });
  await modes.getByRole('button', { name: 'Guided editor', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Product name', exact: true })).toHaveValue(
    'Edited seeded product'
  );
  await page
    .getByRole('navigation', { name: 'Product editing steps' })
    .getByRole('button', { name: /Image assets/u })
    .click();
  await expect(page.getByTestId('selected-photo-strip').locator('img')).toHaveCount(2);
  await openXml(page);
  expect(await imageValues(page)).toEqual(photos.map((photo) => ({ id: photo.id, url: photo.url })));
  await modes.getByRole('button', { name: 'Quick publish', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Product name', exact: true })).toHaveValue(
    'Edited seeded product'
  );
  await expect(page.getByTestId('selected-photo-strip').locator('img')).toHaveCount(2);
  const stored = await page.evaluate(() =>
    JSON.stringify([...Object.entries(localStorage), ...Object.entries(sessionStorage)])
  );
  for (const photo of photos) {
    expect(stored).not.toContain(photo.url);
    expect(stored).not.toContain(photo.id);
  }
  await expectNoWrites(page);
});

test('capacity failure applies nothing; removing an image and retrying applies the remaining order', async ({
  page
}) => {
  const panel = await openSeed(page, 3);
  await loadCategory(page);
  await expect(panel.getByRole('alert')).toContainText('at most 2 images');
  await expect(page.getByTestId('selected-photo-strip')).toHaveCount(0);
  await openXml(page);
  expect(await imageValues(page)).toEqual([]);
  const removed = photoFixture.responses.listPhotos.items.at(-1);
  if (!removed) throw new Error('Missing overflow photo fixture');
  await panel.getByRole('button', { name: 'Remove this image: ' + removed.name, exact: true }).click();
  await expect(panel.getByRole('heading')).toHaveText('Images for this product \u00b7 2');
  await expect(page.getByTestId('selected-photo-strip')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Try adding again', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('2 images added.');
  expect(await imageValues(page)).toEqual(
    photoFixture.responses.listPhotos.items.slice(0, 2).map((photo) => ({ id: photo.id, url: photo.url }))
  );
  expect((await state(page)).requests.filter((call) => call.operation === 'getProductSchema')).toHaveLength(
    1
  );
  await expectNoWrites(page);
});

test('a populated category refuses overwrite, including an explicit retry', async ({ page }) => {
  const panel = await openSeed(page, 2);
  await page.evaluate(() => {
    window.__assetsToProduct.schema = 'existing';
  });
  await loadCategory(page);
  await expect(panel.getByRole('alert')).toContainText('Nothing was overwritten');
  await expect(page.getByTestId('selected-photo-strip').locator('img')).toHaveCount(1);
  await openXml(page);
  const before = await imageValues(page);
  await panel.getByRole('button', { name: 'Try adding again', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Nothing was overwritten');
  expect(await imageValues(page)).toEqual(before);
  expect(before).toEqual([
    {
      id: 'ph_001',
      url: photoFixture.responses.listPhotos.items[0]?.url
    }
  ]);
  await expectNoWrites(page);
});

test('refresh discards applied images and cannot replay the old handoff URL', async ({ page }) => {
  const panel = await openSeed(page, 2);
  const tokenHash = (await page.evaluate(() => window.__assetsToProductHashes)).find((hash) =>
    hash.startsWith('#/products/from-assets/')
  );
  expect(tokenHash).toBeDefined();
  await loadCategory(page);
  await expect(panel.getByRole('status')).toContainText('2 images added.');
  await expectNoWrites(page);
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole('group', { name: 'Product editor mode' })).toBeVisible();
  await expect(page.getByTestId('product-photo-seed')).toHaveCount(0);
  await expect(page.getByTestId('selected-photo-strip')).toHaveCount(0);
  await page.goto('/' + (tokenHash ?? '#/products'));
  await expect(page).toHaveURL(/#\/products\/publisher\/quick\/basics\/new$/u);
  await expect(page.getByTestId('product-photo-seed')).toHaveCount(0);
  await expect(page.getByText('This image selection has expired.', { exact: false })).toBeVisible();
  await expectNoWrites(page);
});

test('cached listing A and a pending seed both reject current account B in mock mode', async ({ page }) => {
  await test.step('cached A listing is not relabelled as B on the handoff click', async () => {
    await page.goto('/#/photos');
    const action = page.getByRole('button', { name: 'Use for new product', exact: true });
    const cards = page.getByTestId('photo-card-grid').getByRole('checkbox');
    await expect(cards).toHaveCount(photoFixture.responses.listPhotos.items.length);
    await cards.nth(0).check();
    await cards.nth(1).check();
    await expect(action).toBeEnabled();
    const listed = await state(page);
    expect(listed.requests.find((call) => call.operation === 'listPhotos')?.options?.galleryContext).toEqual(
      fixture.sourceContext
    );
    await page.evaluate(
      ({ identity, gateway }) => {
        window.__assetsToProduct.sourceContext.identity = identity;
        window.__assetsToProduct.sourceContext.gateway = gateway;
        window.__assetsToProduct.productContext.identity = identity;
      },
      { identity: fixture.replacementIdentity, gateway: fixture.replacementGateway }
    );
    await action.click();
    await expect(page.getByText(photosEn.productSeed.failure, { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/#\/photos$/u);
    await expect(page.getByTestId('product-photo-seed')).toHaveCount(0);
    const rejected = await state(page);
    expect(rejected.requests.filter((call) => call.operation === 'listPhotos')).toHaveLength(
      listed.requests.filter((call) => call.operation === 'listPhotos').length
    );
    expect(rejected.requests.filter((call) => call.operation === 'getProductSchema')).toEqual([]);
    expect(rejected.contextCalls.filter((call) => call.operation === 'getProductSchema')).toEqual([]);
    expect(
      await page.evaluate(() =>
        window.__assetsToProductHashes.some((hash) => hash.startsWith('#/products/from-assets/'))
      )
    ).toBe(false);
    await expectNoWrites(page);
  });
  await page.reload();
  const panel = await openSeed(page, 2);
  await page.evaluate((identity) => {
    window.__assetsToProduct.sourceContext.identity = identity;
    window.__assetsToProduct.productContext.identity = identity;
  }, fixture.replacementIdentity);
  await chooseCategoryAndRequestForm(page);
  // Mock mode does not subscribe to the BFF credential-epoch event.
  // Actual context revalidation now rejects before fetching any category Schema.
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveText(photosEn.productSeed.context);
  await expect(page.getByText('GALLERY_CONTEXT_CHANGED', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Product editor mode' })).toHaveCount(0);
  expect((await state(page)).requests.filter((call) => call.operation === 'getProductSchema')).toEqual([]);
  await expect(panel.getByRole('status')).not.toContainText('images added.');
  await expect(panel.locator('img')).toHaveCount(2);
  await expect(page.getByTestId('selected-photo-strip')).toHaveCount(0);
  await expectNoWrites(page);
});

test('only an explicit draft click permits one product-context save despite unrelated S3 changes', async ({
  page
}) => {
  const panel = await openSeed(page, 2);
  await page.evaluate((storage) => {
    window.__assetsToProduct.sourceContext.storage = storage;
    window.__assetsToProduct.productContext.storage = storage;
  }, fixture.replacementStorage);
  await loadCategory(page);
  await expect(panel.getByRole('status')).toContainText('2 images added.');
  const schemaRequest = (await state(page)).requests.find((call) => call.operation === 'getProductSchema');
  const captured = schemaRequest?.options?.productContext;
  expect(captured).toEqual(fixture.productOperationContext);
  expect(schemaRequest?.options).not.toHaveProperty('galleryContext');
  expect(captured).not.toHaveProperty('storage');
  expect(captured).not.toEqual(fixture.sourceContext);
  await armDraftClick(page);
  await page.getByRole('button', { name: productsEn.editor.savePlatformDraft, exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: productsEn.editor.platformDraftCreated,
      exact: true
    })
  ).toBeDisabled();
  const writes = (await state(page)).requests.filter((call) => mutations.includes(call.operation));
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    operation: 'saveProductDraft',
    options: { productContext: captured }
  });
  expect(writes[0]?.options?.productContext).not.toEqual(fixture.sourceContext);
  expect(writes[0]?.options).not.toHaveProperty('galleryContext');
  expect(writes[0]?.options?.productContext).not.toHaveProperty('storage');
  expect(Object.keys(writes[0]?.options?.productContext ?? {}).sort()).toEqual(['gateway', 'identity']);
  for (const photo of photoFixture.responses.listPhotos.items.slice(0, 2)) {
    expect(writes[0]?.payload.schemaXml).toEqual(expect.stringContaining(photo.url));
    expect(writes[0]?.payload.schemaXml).toEqual(expect.stringContaining('fileId="' + photo.id + '"'));
  }
  expect((await state(page)).draftRemaining).toBe(0);
});

test('delayed pre-submit context cannot write after account change, a late form edit, or navigation', async ({
  page
}) => {
  test.setTimeout(60_000);
  page.on('dialog', (dialog) => dialog.accept());
  for (const change of ['account', 'form', 'navigation'] as const) {
    await test.step(change, async () => {
      // Reset the document between races, not the handoff or mutation under test.
      if (change !== 'account') {
        await page.evaluate(() => {
          history.replaceState(null, '', '/#/photos');
        });
        await page.reload();
      }
      const panel = await openSeed(page, 2);
      await loadCategory(page);
      await expect(panel.getByRole('status')).toContainText('2 images added.');
      await armDraftClick(page, true);
      await page.getByRole('button', { name: productsEn.editor.savePlatformDraft, exact: true }).click();
      await page.waitForFunction(() => window.__assetsToProduct.waitingForContext);
      await expectNoWrites(page);
      if (change === 'account') {
        await page.evaluate(
          ({ identity, eventName }) => {
            window.__assetsToProduct.sourceContext.identity = identity;
            window.__assetsToProduct.productContext.identity = identity;
            // Mock ignores the BFF event; actual metadata revalidation must reject.
            window.dispatchEvent(new Event(eventName));
          },
          { identity: fixture.replacementIdentity, eventName: GATEWAY_CONFIGURATION_EVENT }
        );
      } else if (change === 'form') {
        await page.getByRole('textbox', { name: 'Product name', exact: true }).fill('Late form edit');
      } else {
        await page.getByRole('tab', { name: productsEn.view.page.list, exact: true }).click();
        const discard = page.getByRole('dialog', { name: shellEn.editing.title, exact: true });
        await expect
          .poll(async () => (await discard.isVisible()) || page.url().endsWith('#/products/list'))
          .toBe(true);
        if (await discard.isVisible())
          await discard.getByRole('button', { name: shellEn.editing.discard, exact: true }).click();
        await expect(page).toHaveURL(/#\/products\/list$/u);
      }
      await releaseContext(page);
      if (change !== 'navigation') await expect(page.getByRole('dialog')).toBeVisible();
      await expectNoWrites(page);
      expect((await state(page)).draftRemaining).toBe(1);
    });
  }
});

test('removing every pending image cancels the seed without loading a form or writing', async ({ page }) => {
  const panel = await openSeed(page, 2);
  for (const photo of photoFixture.responses.listPhotos.items.slice(0, 2))
    await panel.getByRole('button', { name: 'Remove this image: ' + photo.name, exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect((await state(page)).requests.filter((call) => call.operation === 'getProductSchema')).toEqual([]);
  await expectNoWrites(page);
});
