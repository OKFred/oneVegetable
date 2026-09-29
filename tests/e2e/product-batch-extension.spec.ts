import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import fixture from '../../mock/data/product-batch-maintenance.json' with { type: 'json' };
import { createProductMutationFingerprints } from '../../packages/core/src/product-mutation-fingerprint';
import { installNodeXmlDomGlobals } from '../../scripts/node-xml-dom';
import { requireProductOperationContext } from '../../packages/core/src/product-operation-context';
test('formal MV3 pins batch context and stores accepted/unknown receipts before allowing further writes', async () => {
  test.setTimeout(90_000);
  installNodeXmlDomGlobals();
  const extension = resolve('apps/extension/.output/chrome-mv3');
  const context = await chromium.launchPersistentContext(await mkdtemp(resolve(tmpdir(), 'ov-batch-')), {
    headless: false,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  try {
    let writes = 0;
    let uncertain = false;
    await context.route(/^https?:\/\//u, (route) => route.abort());
    await context.route('https://eco.taobao.com/**', async (route) => {
      const method = new URLSearchParams(route.request().postData() ?? '').get('method');
      if (method === 'alibaba.icbu.product.schema.update') {
        writes++;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            alibaba_icbu_product_schema_update_response: uncertain ? {} : fixture.accepted
          })
        });
      } else await route.abort();
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#/settings`);
    const send = (message: Record<string, unknown>) =>
      page.evaluate(
        async (value) => {
          const api = (
            globalThis as unknown as {
              chrome: { runtime: { sendMessage(value: unknown): Promise<unknown> } };
            }
          ).chrome;
          return api.runtime.sendMessage(value);
        },
        { requestId: crypto.randomUUID(), ...message }
      );
    expect(
      await send({
        kind: 'credential-vault-request',
        operation: 'create',
        payload: { passphrase: 'batch-test-password', settings: fixture.settings }
      })
    ).toMatchObject({ ok: true });
    const contextResponse = await send({ kind: 'product-operation-context' });
    expect(contextResponse).toMatchObject({ ok: true });
    const productContext = requireProductOperationContext((contextResponse as { data: unknown }).data);
    const productMutationFingerprint = await createProductMutationFingerprints(fixture.xml);
    const envelope = {
      kind: 'gateway-request',
      operation: 'updateProduct',
      productBatchId: crypto.randomUUID(),
      productContext,
      productMutationFingerprint,
      payload: { productId: '301', categoryId: 123, language: 'en_US', schemaPatchXml: fixture.xml }
    };
    expect(
      await send({ ...envelope, productContext: { ...productContext, gateway: 'c'.repeat(64) } })
    ).toMatchObject({ ok: false, error: { code: 'PRODUCT_CONTEXT_CHANGED' } });
    expect(writes).toBe(0);
    const result = await send(envelope);
    expect(result).toMatchObject({
      ok: true,
      data: { job: { batchId: envelope.productBatchId, productContext, status: 'auditing' } }
    });
    expect(writes).toBe(1);
    await page.reload();
    expect(await send(envelope)).toMatchObject({
      ok: false,
      error: { code: 'PRODUCT_MUTATION_ALREADY_IN_PROGRESS' }
    });
    expect(writes).toBe(1);
    const jobs = await send({
      kind: 'product-mutation-job-request',
      operation: 'list',
      payload: { page: 1, pageSize: 100 }
    });
    expect(jobs).toMatchObject({
      ok: true,
      data: { items: [{ batchId: envelope.productBatchId, productContext, status: 'auditing' }] }
    });
    uncertain = true;
    const second = { ...envelope, payload: { ...envelope.payload, productId: '302' } };
    expect(await send(second)).toMatchObject({ ok: false, error: { code: 'ALIBABA_PRODUCT_ID_MISSING' } });
    expect(await send(second)).toMatchObject({
      ok: false,
      error: { code: 'PRODUCT_MUTATION_ALREADY_IN_PROGRESS' }
    });
    expect(writes).toBe(2);
    const unknown = await send({
      kind: 'product-mutation-job-request',
      operation: 'list',
      payload: { page: 1, pageSize: 100, productId: '302' }
    });
    expect(unknown).toMatchObject({
      ok: true,
      data: { items: [{ status: 'recovery-required', productContext, batchId: envelope.productBatchId }] }
    });
  } finally {
    await context.close();
  }
});
