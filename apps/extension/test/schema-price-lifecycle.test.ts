// @vitest-environment jsdom

import { assert, describe, expect, it, vi } from 'vitest';
import {
  compareProductMutationFingerprints,
  createProductMutationFingerprints,
  type ProductMutationJob
} from '@one-vegetable/core';
import {
  assertProductSchemaPriceUpdate,
  prepareProductSchemaPrice
} from '@one-vegetable/core/product-schema-price';
import type { ProductReference } from '@one-vegetable/core/product-reference';
import fixture from '../../../mock/data/product-schema-price.json';
import integrityFixture from '../../../mock/data/product-maintenance-integrity.json';
import {
  ExtensionProductDisplayMutationLifecycle,
  type ExtensionProductMutationStorage,
  type ExtensionProductUpdateGateway
} from '../lib/product-display-mutation-lifecycle';
import { EXTENSION_PRODUCT_MUTATION_JOBS_STORAGE_KEY as key } from '../lib/product-display-mutation-storage';

const reference = (): ProductReference => structuredClone(integrityFixture.snapshot);
const options = { productContext: { identity: 'a'.repeat(64), gateway: 'b'.repeat(64) } };

class Storage implements ExtensionProductMutationStorage {
  values: Record<string, unknown> = {};
  fail = false;

  get(name: string) {
    return Promise.resolve({ [name]: structuredClone(this.values[name]) });
  }

  set(value: Record<string, unknown>) {
    if (this.fail) return Promise.reject(new Error('synthetic persistence failure'));
    Object.assign(this.values, structuredClone(value));
    return Promise.resolve();
  }

  job(): ProductMutationJob {
    const job = (this.values[key] as { jobs: ProductMutationJob[] } | undefined)?.jobs[0];
    assert(job);
    return structuredClone(job);
  }
}

async function setup() {
  const preview = await prepareProductSchemaPrice(fixture.multiXml, fixture.draft, reference());
  const request = {
    productId: fixture.draft.productId,
    categoryId: 12345,
    language: 'en_US' as const,
    schemaPatchXml: preview.patchXml,
    priceGuard: preview.guard
  };
  const fingerprints = await createProductMutationFingerprints(request.schemaPatchXml);
  const storage = new Storage();
  const gateway = {
    pricePreflight: vi.fn<NonNullable<ExtensionProductUpdateGateway['pricePreflight']>>(async (input) =>
      assertProductSchemaPriceUpdate(input, fixture.multiXml, reference())
    ),
    update: vi.fn<ExtensionProductUpdateGateway['update']>().mockResolvedValue({
      productId: request.productId,
      traceId: 'synthetic-accepted',
      success: true
    })
  };
  const lifecycle = new ExtensionProductDisplayMutationLifecycle(storage, () => 1_000);
  const submit = () => lifecycle.submitUpdate(gateway, crypto.randomUUID(), request, fingerprints, options);
  const comparison = async (job: ProductMutationJob, xml = request.schemaPatchXml) => ({
    kind: 'comparison' as const,
    comparison: await compareProductMutationFingerprints(xml, job.fieldExpectations)
  });
  const desired = reference();
  desired.price.tiers = structuredClone(fixture.draft.tiers);
  return { lifecycle, storage, gateway, request, fingerprints, submit, comparison, desired };
}

describe('extension Schema price lifecycle', () => {
  it('persists the validated guard and IOP context before sending and blocks duplicate work after restart', async () => {
    const test = await setup();
    test.gateway.update.mockImplementationOnce(() => {
      expect(test.gateway.pricePreflight).toHaveBeenCalledWith(test.request);
      expect(test.storage.job()).toMatchObject({
        status: 'submitted',
        protocol: 'iop',
        productContext: options.productContext
      });
      expect(
        test.storage
          .job()
          .fieldExpectations.map((field) => field.fieldId)
          .sort()
      ).toEqual(['ladderPrice', 'modelNumber']);
      expect(
        test.storage.job().fieldExpectations.find((field) => field.fieldId === 'ladderPrice')
      ).toMatchObject({
        priceGuard: test.request.priceGuard
      });
      expect(
        test.storage.job().fieldExpectations.find((field) => field.fieldId === 'modelNumber')
      ).not.toHaveProperty('priceGuard');
      for (const field of test.storage.job().fieldExpectations)
        expect(field.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
      return Promise.resolve({
        productId: test.request.productId,
        traceId: 'synthetic-accepted',
        success: true
      });
    });
    const { job } = await test.submit();
    expect(job.status).toBe('auditing');
    const restarted = new ExtensionProductDisplayMutationLifecycle(test.storage, () => 1_001);
    expect(await restarted.get(job.id)).toEqual(job);
    await expect(
      restarted.submitUpdate(test.gateway, crypto.randomUUID(), test.request, test.fingerprints, options)
    ).rejects.toMatchObject({ gatewayError: { code: 'PRODUCT_MUTATION_ALREADY_IN_PROGRESS' } });
    expect(test.gateway.pricePreflight).toHaveBeenCalledOnce();
    expect(test.gateway.update).toHaveBeenCalledOnce();

    const readPriceReference = vi.fn(() => Promise.resolve(test.desired));
    expect(
      await restarted.completeUpdateReadback(
        job.id,
        job.revision,
        await test.comparison(job),
        readPriceReference
      )
    ).toMatchObject({ status: 'verified', protocol: 'iop' });
    expect(readPriceReference).toHaveBeenCalledOnce();
    expect(test.gateway.update).toHaveBeenCalledOnce();
  });

  it('never sends when initial persistence fails', async () => {
    const test = await setup();
    test.storage.fail = true;
    await expect(test.submit()).rejects.toThrow('synthetic persistence failure');
    expect(test.gateway.pricePreflight).toHaveBeenCalledOnce();
    expect(test.gateway.update).not.toHaveBeenCalled();
    expect(test.storage.values[key]).toBeUndefined();
  });

  it.each(['missing preflight', 'preflight failure', 'model changed'] as const)(
    'does not persist or send with %s',
    async (condition) => {
      const test = await setup();
      const gateway: ExtensionProductUpdateGateway = { ...test.gateway };
      if (condition === 'missing preflight') delete gateway.pricePreflight;
      if (condition === 'preflight failure')
        test.gateway.pricePreflight.mockRejectedValue(new Error(condition));
      if (condition === 'model changed') {
        const current = reference();
        current.modelNumber = 'CHANGED-MODEL';
        test.gateway.pricePreflight.mockImplementation((input) =>
          assertProductSchemaPriceUpdate(input, fixture.multiXml, current)
        );
      }
      await expect(
        test.lifecycle.submitUpdate(gateway, crypto.randomUUID(), test.request, test.fingerprints, options)
      ).rejects.toThrow();
      expect(test.storage.values[key]).toBeUndefined();
      expect(test.gateway.update).not.toHaveBeenCalled();
    }
  );

  it('rejects fields outside price and preserved model even when fingerprints match', async () => {
    const test = await setup();
    test.request.schemaPatchXml = test.request.schemaPatchXml.replace(
      '</itemSchema>',
      '<field id="subject" type="input"><value>Changed title</value></field></itemSchema>'
    );
    const fingerprints = await createProductMutationFingerprints(test.request.schemaPatchXml);
    await expect(
      test.lifecycle.submitUpdate(test.gateway, crypto.randomUUID(), test.request, fingerprints, options)
    ).rejects.toThrow();
    expect(test.gateway.pricePreflight).not.toHaveBeenCalled();
    expect(test.gateway.update).not.toHaveBeenCalled();
    expect(test.storage.values[key]).toBeUndefined();
  });

  it('does not accept caller-only matched evidence without a trustworthy reference callback', async () => {
    const test = await setup();
    const { job } = await test.submit();
    const result = await test.comparison(job);
    expect(result.comparison.matched).toBe(true);
    await expect(test.lifecycle.completeUpdateReadback(job.id, job.revision, result)).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_SCHEMA_PRICE_READBACK_REQUIRED' }
    });
    expect(test.storage.job()).toMatchObject({ status: 'auditing', revision: job.revision });
    const failedRead = vi
      .fn<() => Promise<ProductReference>>()
      .mockRejectedValue(new Error('synthetic unavailable'));
    await expect(
      test.lifecycle.completeUpdateReadback(job.id, job.revision, await test.comparison(job), failedRead)
    ).rejects.toThrow('synthetic unavailable');
    expect(test.storage.job()).toMatchObject({ status: 'auditing', revision: job.revision });
    expect(failedRead).toHaveBeenCalledOnce();
    expect(test.gateway.update).toHaveBeenCalledOnce();
  });

  it('rejects caller fingerprints that omit the preserved model before preflight or persistence', async () => {
    const test = await setup();
    const fingerprints = {
      ...test.fingerprints,
      fieldExpectations: test.fingerprints.fieldExpectations.filter(
        (field) => field.fieldId !== 'modelNumber'
      )
    };
    await expect(
      test.lifecycle.submitUpdate(test.gateway, crypto.randomUUID(), test.request, fingerprints, options)
    ).rejects.toThrow();
    expect(test.gateway.pricePreflight).not.toHaveBeenCalled();
    expect(test.gateway.update).not.toHaveBeenCalled();
    expect(test.storage.values[key]).toBeUndefined();
  });

  it.each([
    'price differs',
    'model changed',
    'model missing',
    'title changed',
    'audit pending',
    'status auditing',
    'wrong product'
  ] as const)(
    'keeps accepted work unresolved when independent reference has %s despite matching page evidence',
    async (condition) => {
      const test = await setup();
      const { job } = await test.submit();
      const current = structuredClone(test.desired);
      if (condition === 'price differs') current.price.tiers = reference().price.tiers;
      if (condition === 'model changed') current.modelNumber = 'CHANGED-MODEL';
      if (condition === 'model missing') current.modelNumber = null;
      if (condition === 'title changed') current.title = 'Changed title';
      if (condition === 'audit pending') current.auditStatus = 'pending';
      if (condition === 'status auditing') current.status = 'auditing';
      if (condition === 'wrong product') current.productId = '880124';
      const readPriceReference = vi.fn(() => Promise.resolve(current));
      const unresolved = await test.lifecycle.completeUpdateReadback(
        job.id,
        job.revision,
        await test.comparison(job),
        readPriceReference
      );
      expect(unresolved.status).not.toBe('verified');
      expect(readPriceReference).toHaveBeenCalledOnce();
      await expect(test.submit()).rejects.toMatchObject({
        gatewayError: { code: 'PRODUCT_MUTATION_ALREADY_IN_PROGRESS' }
      });
      expect(
        await test.lifecycle.completeUpdateReadback(
          job.id,
          unresolved.revision,
          await test.comparison(unresolved),
          () => Promise.resolve(test.desired)
        )
      ).toMatchObject({ status: 'verified' });
      expect(test.gateway.update).toHaveBeenCalledOnce();
    }
  );

  it.each([true, false])(
    'requires independent model evidence even when render omits the preserved value: %s',
    async (present) => {
      const test = await setup();
      const { job } = await test.submit();
      const document = new DOMParser().parseFromString(test.request.schemaPatchXml, 'application/xml');
      const model = document.querySelector('field[id="modelNumber"]');
      assert(model);
      model.replaceChildren();
      const comparison = await compareProductMutationFingerprints(
        new XMLSerializer().serializeToString(document),
        job.fieldExpectations,
        undefined,
        true
      );
      const result = await test.lifecycle.completeUpdateReadback(
        job.id,
        job.revision,
        { kind: 'comparison', comparison },
        () => Promise.resolve({ ...test.desired, modelNumber: present ? test.desired.modelNumber : null })
      );
      expect(result.status === 'verified').toBe(present);
      expect(test.gateway.update).toHaveBeenCalledOnce();
    }
  );

  it('requires matching page fields as well as a correct independent reference', async () => {
    const test = await setup();
    const { job } = await test.submit();
    const unresolved = await test.lifecycle.completeUpdateReadback(
      job.id,
      job.revision,
      await test.comparison(job, fixture.multiXml),
      () => Promise.resolve(test.desired)
    );
    expect(unresolved.status).not.toBe('verified');
    expect(test.gateway.update).toHaveBeenCalledOnce();
  });

  it.each(['missing', 'changed'] as const)(
    'does not verify price-only page evidence with %s model',
    async (kind) => {
      const test = await setup();
      const { job } = await test.submit();
      const xml =
        kind === 'missing'
          ? test.request.schemaPatchXml.replace(/<field id="modelNumber"[^>]*>[\s\S]*?<\/field>/u, '')
          : test.request.schemaPatchXml.replace('SYN-INTEGRITY-A', 'CHANGED-MODEL');
      const unresolved = await test.lifecycle.completeUpdateReadback(
        job.id,
        job.revision,
        await test.comparison(job, xml),
        () => Promise.resolve(test.desired)
      );
      expect(unresolved.status).not.toBe('verified');
      expect(test.gateway.update).toHaveBeenCalledOnce();
    }
  );

  it('keeps legacy non-price updates working without preflight or a reference callback', async () => {
    const test = await setup();
    const request = {
      productId: test.request.productId,
      categoryId: 12345,
      language: 'en_US' as const,
      schemaPatchXml:
        '<itemSchema><field id="subject" type="input"><value>Updated title</value></field></itemSchema>'
    };
    const { job } = await test.lifecycle.submitUpdate(
      { update: test.gateway.update },
      crypto.randomUUID(),
      request,
      await createProductMutationFingerprints(request.schemaPatchXml)
    );
    expect(job.protocol).toBeUndefined();
    expect(job.fieldExpectations.map((field) => field.fieldId)).toEqual(['subject']);
    expect(job.fieldExpectations[0]?.priceGuard).toBeUndefined();
    expect(
      await test.lifecycle.completeUpdateReadback(
        job.id,
        job.revision,
        await test.comparison(job, request.schemaPatchXml)
      )
    ).toMatchObject({ status: 'verified' });
    expect(test.gateway.pricePreflight).not.toHaveBeenCalled();
    expect(test.gateway.update).toHaveBeenCalledOnce();
  });
});
