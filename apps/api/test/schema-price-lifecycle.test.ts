// @vitest-environment jsdom

import { assert, describe, expect, it, vi } from 'vitest';
import { DOMParser as ServerDomParser } from 'linkedom';
import {
  createEntityAuditFields,
  type ProductMutationJob,
  type ProductSchema,
  type ProductSchemaXmlParser
} from '@one-vegetable/core';
import { opaqueGalleryId } from '@one-vegetable/core/gallery-transfer-context';
import { prepareProductSchemaPrice } from '@one-vegetable/core/product-schema-price';
import type { ProductReference } from '@one-vegetable/core/product-reference';
import fixture from '../../../mock/data/product-schema-price.json';
import integrityFixture from '../../../mock/data/product-maintenance-integrity.json';
import {
  ProductMutationAlreadyInProgressError,
  ProductMutationLifecycleService,
  type ProductMutationGateway
} from '../src/product-mutations/service';
import type { ProductMutationJobRepository } from '../src/product-mutations/repository';

const actor = { actorId: 'schema-price-admin', username: 'admin', role: 'admin', source: 'bff' } as const;
const parser: ProductSchemaXmlParser = {
  parseFromString: (xml) => new ServerDomParser().parseFromString(xml, 'text/xml') as unknown as XMLDocument
};
const reference = (): ProductReference => structuredClone(integrityFixture.snapshot);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function setup() {
  let saved: ProductMutationJob | null = null;
  const repository = {
    get: vi.fn<ProductMutationJobRepository['get']>(() => Promise.resolve(clone(saved))),
    findBlocking: vi.fn<ProductMutationJobRepository['findBlocking']>(() =>
      Promise.resolve(
        saved && !['verified', 'failed', 'recovered'].includes(saved.status) ? clone(saved) : null
      )
    ),
    findBlockingCreation: vi.fn<ProductMutationJobRepository['findBlockingCreation']>(),
    list: vi.fn<ProductMutationJobRepository['list']>(),
    createCreation: vi.fn<ProductMutationJobRepository['createCreation']>(),
    createDisplay: vi.fn<ProductMutationJobRepository['createDisplay']>(),
    create: vi.fn<ProductMutationJobRepository['create']>((input) => {
      saved = clone({
        ...createEntityAuditFields(actor.actorId, 1_000),
        ...input,
        id: crypto.randomUUID(),
        operation: 'updateProduct',
        status: 'submitted',
        encryptedProductId: null,
        targetDisplay: null,
        originalDisplay: null,
        traceId: null,
        reasonCode: null,
        message: null,
        submittedTimeUtc: 1_000,
        lastCheckedTimeUtc: null,
        completedTimeUtc: null
      });
      return Promise.resolve(clone(saved));
    }),
    transition: vi.fn<ProductMutationJobRepository['transition']>((input) => {
      assert(saved);
      saved = clone({
        ...saved,
        status: input.status,
        traceId: input.traceId ?? saved.traceId,
        reasonCode: input.reasonCode ?? null,
        message: input.message ?? null,
        revision: saved.revision + 1,
        lastCheckedTimeUtc: input.checked ? 1_001 : saved.lastCheckedTimeUtc
      });
      return Promise.resolve(clone(saved));
    })
  };
  const preview = await prepareProductSchemaPrice(fixture.multiXml, fixture.draft, reference(), parser);
  const request = {
    productId: fixture.draft.productId,
    categoryId: 12345,
    language: 'en_US' as const,
    schemaPatchXml: preview.patchXml,
    priceGuard: preview.guard
  };
  const options = {
    productContext: { identity: await opaqueGalleryId(actor.actorId), gateway: 'b'.repeat(64) }
  };
  const schema = (xml: string): ProductSchema => ({
    xml,
    categoryId: 12345,
    language: 'en_US',
    market: 'wholesale'
  });
  const gateway = {
    publish: vi.fn<ProductMutationGateway['publish']>(),
    saveDraft: vi.fn<ProductMutationGateway['saveDraft']>(),
    update: vi.fn<ProductMutationGateway['update']>().mockResolvedValue({
      productId: request.productId,
      traceId: 'synthetic-accepted',
      success: true
    }),
    get: vi.fn<ProductMutationGateway['get']>(),
    render: vi.fn<ProductMutationGateway['render']>().mockResolvedValue(schema(fixture.multiXml)),
    readReference: vi
      .fn<NonNullable<ProductMutationGateway['readReference']>>()
      .mockResolvedValue(reference()),
    updateDisplay: vi.fn<ProductMutationGateway['updateDisplay']>(),
    list: vi.fn<ProductMutationGateway['list']>()
  };
  const service = new ProductMutationLifecycleService(repository, gateway);
  const submit = () => service.submitUpdate({ actor, requestId: crypto.randomUUID(), request, options });
  const refresh = (job: ProductMutationJob, target = service) =>
    target.refresh({
      actor,
      requestId: crypto.randomUUID(),
      id: job.id,
      expectedRevision: job.revision
    });
  const desired = reference();
  desired.price.tiers = structuredClone(fixture.draft.tiers);
  return { service, repository, gateway, request, options, schema, submit, refresh, desired };
}

describe('Node Schema price lifecycle', () => {
  it('preflights before persistence and persists both roots with a price-only guard and IOP context', async () => {
    const test = await setup();
    test.gateway.update.mockImplementationOnce(async () => {
      expect(test.repository.create).toHaveBeenCalledOnce();
      const stored = await test.repository.get('unused');
      expect(stored).toMatchObject({
        status: 'submitted',
        protocol: 'iop',
        productContext: test.options.productContext
      });
      expect(stored?.fieldExpectations.map((field) => field.fieldId).sort()).toEqual([
        'ladderPrice',
        'modelNumber'
      ]);
      expect(stored?.fieldExpectations.find((field) => field.fieldId === 'ladderPrice')).toMatchObject({
        priceGuard: test.request.priceGuard
      });
      expect(stored?.fieldExpectations.find((field) => field.fieldId === 'modelNumber')).not.toHaveProperty(
        'priceGuard'
      );
      for (const field of stored?.fieldExpectations ?? [])
        expect(field.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
      return { productId: test.request.productId, traceId: 'synthetic-accepted', success: true };
    });
    const { job } = await test.submit();
    expect(job.status).toBe('auditing');
    expect(test.gateway.readReference).toHaveBeenCalledWith(
      test.request.productId,
      job.requestId,
      test.options
    );
    expect(test.gateway.render).toHaveBeenCalledWith(
      expect.objectContaining({ productId: job.productId }),
      job.requestId,
      test.options
    );
    const persistedAt = test.repository.create.mock.invocationCallOrder[0];
    assert(persistedAt !== undefined);
    expect(test.gateway.readReference.mock.invocationCallOrder[0]).toBeLessThan(persistedAt);
    expect(test.gateway.render.mock.invocationCallOrder[0]).toBeLessThan(persistedAt);

    const restarted = new ProductMutationLifecycleService(test.repository, test.gateway);
    test.gateway.render.mockResolvedValue(test.schema(test.request.schemaPatchXml));
    test.gateway.readReference.mockResolvedValue(test.desired);
    expect(await test.refresh(job, restarted)).toMatchObject({ status: 'verified', protocol: 'iop' });
    expect(test.gateway.readReference).toHaveBeenLastCalledWith(
      job.productId,
      expect.any(String),
      test.options
    );
    expect(test.gateway.update).toHaveBeenCalledOnce();
  });

  it('never sends when initial persistence fails', async () => {
    const test = await setup();
    test.repository.create.mockRejectedValueOnce(new Error('synthetic persistence failure'));
    await expect(test.submit()).rejects.toThrow('synthetic persistence failure');
    expect(test.gateway.readReference).toHaveBeenCalledOnce();
    expect(test.gateway.update).not.toHaveBeenCalled();
    expect(test.repository.transition).not.toHaveBeenCalled();
  });

  it.each([
    'reference failure',
    'render failure',
    'model changed',
    'model missing',
    'schema changed'
  ] as const)('rejects %s before creating or sending a job', async (condition) => {
    const test = await setup();
    if (condition === 'reference failure') test.gateway.readReference.mockRejectedValue(new Error(condition));
    if (condition === 'render failure') test.gateway.render.mockRejectedValue(new Error(condition));
    if (condition === 'model changed' || condition === 'model missing') {
      const current = reference();
      current.modelNumber = condition === 'model changed' ? 'CHANGED-MODEL' : null;
      test.gateway.readReference.mockResolvedValue(current);
    }
    if (condition === 'schema changed') {
      test.gateway.render.mockResolvedValue(
        test.schema(fixture.multiXml.replace('keep="root"', 'keep="changed"'))
      );
    }
    await expect(test.submit()).rejects.toThrow();
    expect(test.repository.create).not.toHaveBeenCalled();
    expect(test.gateway.update).not.toHaveBeenCalled();
  });

  it('rejects a guarded patch that includes a field outside price and preserved model', async () => {
    const test = await setup();
    test.request.schemaPatchXml = test.request.schemaPatchXml.replace(
      '</itemSchema>',
      '<field id="subject" type="input"><value>Changed title</value></field></itemSchema>'
    );
    await expect(test.submit()).rejects.toThrow();
    expect(test.repository.create).not.toHaveBeenCalled();
    expect(test.gateway.update).not.toHaveBeenCalled();
  });

  it.each([
    'price differs',
    'model changed',
    'model missing',
    'title changed',
    'audit pending',
    'status auditing',
    'wrong product'
  ] as const)('does not false-verify matching Schema when independent readback has %s', async (condition) => {
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
    test.gateway.render.mockResolvedValue(test.schema(test.request.schemaPatchXml));
    test.gateway.readReference.mockResolvedValue(current);
    const unresolved = await test.refresh(job);
    expect(unresolved.status).not.toBe('verified');
    await expect(test.submit()).rejects.toBeInstanceOf(ProductMutationAlreadyInProgressError);
    test.gateway.readReference.mockResolvedValue(test.desired);
    expect(await test.refresh(unresolved)).toMatchObject({ status: 'verified' });
    expect(test.gateway.update).toHaveBeenCalledOnce();
  });

  it.each([true, false])(
    'uses independent model evidence when render omits its value: %s',
    async (present) => {
      const test = await setup();
      const { job } = await test.submit();
      const document = new DOMParser().parseFromString(test.request.schemaPatchXml, 'application/xml');
      const model = document.querySelector('field[id="modelNumber"]');
      assert(model);
      model.replaceChildren();
      test.gateway.render.mockResolvedValue(test.schema(new XMLSerializer().serializeToString(document)));
      test.gateway.readReference.mockResolvedValue({
        ...test.desired,
        modelNumber: present ? test.desired.modelNumber : null
      });
      const refreshed = await test.refresh(job);
      expect(refreshed.status === 'verified').toBe(present);
      expect(test.gateway.update).toHaveBeenCalledOnce();
    }
  );

  it('keeps accepted work unresolved when independent reference readback fails', async () => {
    const test = await setup();
    const { job } = await test.submit();
    test.gateway.render.mockResolvedValue(test.schema(test.request.schemaPatchXml));
    test.gateway.readReference.mockRejectedValue(new Error('synthetic reference unavailable'));
    expect((await test.refresh(job)).status).not.toBe('verified');
    expect(test.gateway.update).toHaveBeenCalledOnce();
  });

  it.each(['missing', 'changed'] as const)(
    'uses independent model evidence only for omissions, not conflicting Schema values: %s',
    async (kind) => {
      const test = await setup();
      const { job } = await test.submit();
      const xml =
        kind === 'missing'
          ? test.request.schemaPatchXml.replace(/<field id="modelNumber"[^>]*>[\s\S]*?<\/field>/u, '')
          : test.request.schemaPatchXml.replace('SYN-INTEGRITY-A', 'CHANGED-MODEL');
      test.gateway.render.mockResolvedValue(test.schema(xml));
      test.gateway.readReference.mockResolvedValue(test.desired);
      expect((await test.refresh(job)).status === 'verified').toBe(kind === 'missing');
      expect(test.gateway.update).toHaveBeenCalledOnce();
    }
  );

  it('leaves legacy non-price updates usable without reference reads or a price guard', async () => {
    const test = await setup();
    const request = {
      productId: test.request.productId,
      categoryId: 12345,
      language: 'en_US' as const,
      schemaPatchXml:
        '<itemSchema><field id="subject" type="input"><value>Updated title</value></field></itemSchema>'
    };
    const gateway: ProductMutationGateway = { ...test.gateway };
    delete gateway.readReference;
    const service = new ProductMutationLifecycleService(test.repository, gateway);
    const { job } = await service.submitUpdate({ actor, requestId: crypto.randomUUID(), request });
    expect(job.fieldExpectations.map((field) => field.fieldId)).toEqual(['subject']);
    expect(job.fieldExpectations[0]?.priceGuard).toBeUndefined();
    expect(job.protocol).toBeUndefined();
    test.gateway.render.mockResolvedValue(test.schema(request.schemaPatchXml));
    expect(await test.refresh(job, service)).toMatchObject({ status: 'verified' });
    expect(test.gateway.readReference).not.toHaveBeenCalled();
    expect(test.gateway.update).toHaveBeenCalledOnce();
  });
});
