import { afterEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import type { GatewayClient, Photo } from '@one-vegetable/core';
import type { GalleryTransferContext } from '@one-vegetable/core/gallery-transfer-task';
import photoFixture from '../../../mock/data/photos.json';
import handoffFixture from '../../../mock/data/assets-to-product.json';
import { ProductPhotoHandoffService } from '../src/lib/product-photo-handoff';

const productOperations = ['getProductSchema', 'saveProductDraft', 'publishProduct'] as const;
const sourceContext: GalleryTransferContext = { ...handoffFixture.sourceContext };
const productContext: GalleryTransferContext = { ...handoffFixture.productContext };

function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing fixture or handoff');
  return value;
}

function setup(mode = 'bff') {
  let scope = 'actor-a:epoch-1';
  let now = 1_800_000;
  const context = vi.fn<NonNullable<GatewayClient['galleryTransferContext']>>((operation) =>
    Promise.resolve(structuredClone(operation === 'listPhotos' ? sourceContext : productContext))
  );
  const request = vi.fn<GatewayClient['request']>();
  const gateway: GatewayClient = { galleryTransferContext: context, request };
  const service = new ProductPhotoHandoffService(
    gateway,
    mode,
    () => scope,
    () => now
  );
  const photos = structuredClone(photoFixture.responses.listPhotos.items.slice(0, 2));
  const source = structuredClone(handoffFixture.listedMetadata.source);
  const listedContext = structuredClone(handoffFixture.listedMetadata.context);
  return {
    service,
    gateway,
    context,
    request,
    photos,
    source,
    listedContext,
    create: (
      selection: readonly Photo[] = photos,
      listedSource: Readonly<Record<string, unknown>> = source
    ) => service.create(selection, listedSource, listedContext),
    changeScope: () => {
      scope = 'actor-b:epoch-2';
    },
    advance: (milliseconds: number) => {
      now += milliseconds;
    }
  };
}

function deferredContext() {
  let resolve!: (value: GalleryTransferContext) => void;
  const promise = new Promise<GalleryTransferContext>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('in-memory product photo handoff', () => {
  it('accepts Vue reactive photo selections and detaches their plain DTOs', async () => {
    const s = setup();
    const photos = reactive(s.photos);
    const expected = structuredClone(s.photos);
    const token = await s.create(photos, s.source);
    present(photos[0]).name = 'changed-after-selection.jpg';
    photos.reverse();
    const handoff = present(s.service.take(token));
    expect(handoff.photos).toEqual(expected);
    expect(() => structuredClone(handoff.photos)).not.toThrow();
    expect(s.request).not.toHaveBeenCalled();
  });

  it('revalidates a reactive handoff through a structured-clone context boundary', async () => {
    const s = setup();
    const token = await s.create(s.photos, Object.freeze({ ...s.source }));
    const handoff = reactive(present(s.service.take(token)));
    // Ensure this exercises an actual Vue proxy, not an already plain source.
    expect(() => structuredClone(handoff.source)).toThrow();
    s.context.mockClear().mockImplementation((operation, payload) => {
      const cloned = structuredClone(payload);
      expect(cloned).toEqual(operation === 'listPhotos' ? s.source : {});
      if (operation === 'listPhotos') expect(payload).not.toBe(handoff.source);
      return Promise.resolve(structuredClone(operation === 'listPhotos' ? sourceContext : productContext));
    });
    await expect(s.service.assertCurrent(handoff)).resolves.toBeUndefined();
    expect(s.context.mock.calls).toEqual([
      ['listPhotos', s.source],
      ...productOperations.map((operation) => [operation, {}])
    ]);
    expect(handoff.source).toEqual(s.source);
    expect(s.request).not.toHaveBeenCalled();
  });

  it.each(productOperations)(
    'routes actual sourcing %s payload to frozen TOP without repinning IOP baselines',
    async (operation) => {
      const s = setup();
      const handoff = reactive(present(s.service.take(await s.create(s.photos, s.source))));
      const payload = reactive({
        categoryId: 100009999,
        language: 'en_US',
        market: 'sourcing',
        ...(operation === 'getProductSchema' ? {} : { schemaXml: '<itemSchema/>' })
      });
      s.context.mockClear().mockImplementation((selectedOperation, request) => {
        // Actual request payloads must cross the same plain message boundary.
        const cloned = structuredClone(request);
        const selected =
          selectedOperation === 'listPhotos' || cloned?.market === 'sourcing'
            ? sourceContext
            : productContext;
        return Promise.resolve(structuredClone(selected));
      });
      const selected = await s.service.productContext(handoff, operation, payload);
      expect(selected).toEqual(sourceContext);
      expect(() => structuredClone(selected)).not.toThrow();
      expect(s.context.mock.calls).toEqual([[operation, payload]]);
      expect(s.context.mock.calls[0]?.[1]).not.toBe(payload);
      expect(handoff.productContexts[operation]).toEqual(productContext);
      await expect(s.service.assertCurrent(handoff)).resolves.toBeUndefined();
      // The empty-payload IOP fences are revalidated, not compared against TOP.
      expect(s.context.mock.calls.slice(1)).toEqual([
        ['listPhotos', s.source],
        ...productOperations.map((target) => [target, {}])
      ]);
      expect(handoff.productContexts[operation]).toEqual(productContext);
      expect(s.request).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['a foreign gateway', { ...productContext, gateway: 'foreign-route' }],
    ['a foreign identity on the frozen TOP route', { ...sourceContext, identity: 'foreign-account' }]
  ] as const)('rejects actual payload routing through %s', async (_label, foreignContext) => {
    const s = setup();
    const handoff = present(s.service.take(await s.create(s.photos, s.source)));
    s.context.mockClear().mockResolvedValue(foreignContext);
    const payload = { categoryId: 100009999, language: 'en_US', market: 'sourcing' };
    await expect(s.service.productContext(handoff, 'getProductSchema', payload)).rejects.toThrow(
      'GALLERY_CONTEXT_CHANGED'
    );
    expect(s.context.mock.calls).toEqual([['getProductSchema', payload]]);
    expect(s.request).not.toHaveBeenCalled();
  });

  it('rejects a scope change during actual-payload context lookup and before another lookup', async () => {
    const s = setup();
    const handoff = present(s.service.take(await s.create(s.photos, s.source)));
    const pending = deferredContext();
    s.context.mockClear().mockImplementationOnce(() => pending.promise);
    const payload = { categoryId: 100009999, market: 'sourcing' };
    const checking = s.service.productContext(handoff, 'getProductSchema', payload);
    s.changeScope();
    pending.resolve(sourceContext);
    await expect(checking).rejects.toThrow('GALLERY_CONTEXT_CHANGED');
    s.context.mockClear();
    await expect(s.service.productContext(handoff, 'saveProductDraft', payload)).rejects.toThrow(
      'GALLERY_CONTEXT_CHANGED'
    );
    expect(s.context).not.toHaveBeenCalled();
    expect(s.request).not.toHaveBeenCalled();
  });

  it('pins listPhotos to the exact detached source payload and queries product operations separately', async () => {
    const s = setup();
    const frozenSource = Object.freeze({ ...s.source });
    const token = await s.create(Object.freeze(s.photos), frozenSource);
    expect(token).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
    expect(token).not.toContain(present(s.photos[0]).id);
    expect(s.context.mock.calls).toEqual([
      ['listPhotos', s.source],
      ...productOperations.map((operation) => [operation, {}])
    ]);
    expect(s.context.mock.calls[0]?.[1]).not.toBe(frozenSource);
    const handoff = present(s.service.take(token));
    expect(handoff.context).toEqual({ identity: sourceContext.identity, gateway: sourceContext.gateway });
    for (const operation of productOperations)
      expect(handoff.productContexts[operation]).toEqual(productContext);
    await expect(s.service.assertCurrent(handoff)).resolves.toBeUndefined();
    expect(s.context.mock.calls.slice(4)).toEqual(s.context.mock.calls.slice(0, 4));
    expect(s.request).not.toHaveBeenCalled();
  });
  it('snapshots photos and nested source before asynchronous context lookup', async () => {
    const s = setup();
    const pending = deferredContext();
    s.context.mockImplementationOnce(() => pending.promise);
    const source = { ...s.source, filter: { keyword: 'original' } };
    const expectedPhotos = structuredClone(s.photos);
    const expectedSource = structuredClone(source);
    const creating = s.create(s.photos, source);
    present(s.photos[0]).url = 'https://sc04.alicdn.com/kf/changed.jpg';
    s.photos.reverse();
    source.filter.keyword = 'changed';
    source.groupId = '2002';
    pending.resolve(sourceContext);
    const handoff = present(s.service.take(await creating));
    expect(handoff.photos).toEqual(expectedPhotos);
    expect(handoff.source).toEqual(expectedSource);
    expect(s.context.mock.calls[0]?.[1]).toEqual(expectedSource);
    expect(handoff.photos).not.toBe(s.photos);
  });

  it('consumes the opaque token once and never restores it in another service instance', async () => {
    const s = setup();
    const token = await s.create(s.photos, s.source);
    const other = new ProductPhotoHandoffService(s.gateway, 'bff', () => 'actor-a:epoch-1');
    expect(other.take(token)).toBeNull();
    expect(s.service.take(token)?.photos).toEqual(s.photos);
    expect(s.service.take(token)).toBeNull();
  });

  it('invalidates an outstanding selection on a wrong token, replacement, or clear', async () => {
    const s = setup();
    const first = await s.create(s.photos, s.source);
    expect(s.service.take('not-the-token')).toBeNull();
    expect(s.service.take(first)).toBeNull();
    const second = await s.create(s.photos, s.source);
    const third = await s.create(s.photos, s.source);
    expect(second).not.toBe(third);
    expect(s.service.take(third)).not.toBeNull();
    expect(s.service.take(second)).toBeNull();
    const fourth = await s.create(s.photos, s.source);
    s.service.clear();
    expect(s.service.take(fourth)).toBeNull();
  });

  it.each([
    [0, true],
    [30 * 60_000 - 1, true],
    [30 * 60_000, false],
    [30 * 60_000 + 1, false],
    [-1, false]
  ])('enforces the 30-minute token TTL at age %i', async (age, accepted) => {
    const s = setup();
    const token = await s.create(s.photos, s.source);
    s.advance(age);
    expect(s.service.take(token) !== null).toBe(accepted);
    expect(s.service.take(token)).toBeNull();
  });
  it('rejects a token after the actor or credential epoch changes', async () => {
    const s = setup();
    const token = await s.create(s.photos, s.source);
    s.changeScope();
    expect(s.service.take(token)).toBeNull();
  });

  it.each(['listPhotos', ...productOperations])(
    'rejects scope changes while %s context creation is delayed',
    async (delayedOperation) => {
      const s = setup();
      const pending = deferredContext();
      s.context.mockImplementation((operation) =>
        operation === delayedOperation
          ? pending.promise
          : Promise.resolve(operation === 'listPhotos' ? sourceContext : productContext)
      );
      const creating = s.create(s.photos, s.source);
      await vi.waitFor(() => {
        expect(s.context.mock.calls.some(([operation]) => operation === delayedOperation)).toBe(true);
      });
      s.changeScope();
      pending.resolve(delayedOperation === 'listPhotos' ? sourceContext : productContext);
      await expect(creating).rejects.toThrow('GALLERY_CONTEXT_CHANGED');
      expect(s.request).not.toHaveBeenCalled();
    }
  );
  it('revalidates source identity and refuses a scope change before any context lookup', async () => {
    const s = setup();
    const handoff = present(s.service.take(await s.create(s.photos, s.source)));
    s.context.mockResolvedValueOnce({ ...sourceContext, identity: 'another-account' });
    await expect(s.service.assertCurrent(handoff)).rejects.toThrow('GALLERY_CONTEXT_CHANGED');
    s.context.mockClear();
    s.changeScope();
    await expect(s.service.assertCurrent(handoff)).rejects.toThrow('GALLERY_CONTEXT_CHANGED');
    expect(s.context).not.toHaveBeenCalled();
  });

  it.each(['listPhotos', ...productOperations])(
    'rejects scope changes during delayed %s revalidation',
    async (target) => {
      const s = setup();
      const handoff = present(s.service.take(await s.create(s.photos, s.source)));
      const pending = deferredContext();
      s.context
        .mockClear()
        .mockImplementation((operation) =>
          operation === target
            ? pending.promise
            : Promise.resolve(operation === 'listPhotos' ? sourceContext : productContext)
        );
      const checking = s.service.assertCurrent(handoff);
      await vi.waitFor(() => {
        expect(s.context.mock.calls.some(([operation]) => operation === target)).toBe(true);
      });
      s.changeScope();
      pending.resolve(target === 'listPhotos' ? sourceContext : productContext);
      await expect(checking).rejects.toThrow('GALLERY_CONTEXT_CHANGED');
    }
  );

  it('requires context metadata in real mode but allows a metadata-free mock', async () => {
    const s = setup();
    delete s.gateway.galleryTransferContext;
    await expect(s.create(s.photos, s.source)).rejects.toThrow('GALLERY_CONTEXT_CHANGED');
    const mock = new ProductPhotoHandoffService(s.gateway, 'mock', () => 'mock');
    const handoff = present(mock.take(await mock.create(s.photos, s.source)));
    expect(handoff.context).toBeNull();
    expect(handoff.productContexts).toEqual({});
    await expect(mock.assertCurrent(handoff)).resolves.toBeUndefined();
    expect(s.request).not.toHaveBeenCalled();
  });

  it.each([0, 97])('rejects a selection of %i photos before requesting context', async (count) => {
    const s = setup();
    const photos = Array.from({ length: count }, () => present(s.photos[0]));
    await expect(s.create(photos, s.source)).rejects.toThrow('PHOTO_HANDOFF_INVALID');
    expect(s.context).not.toHaveBeenCalled();
    expect(s.request).not.toHaveBeenCalled();
  });
  it('does not read or write persistent browser storage or invoke gateway operations', async () => {
    const storage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn()
    };
    const open = vi.fn();
    const cachesOpen = vi.fn();
    const extensionGet = vi.fn();
    const extensionSet = vi.fn();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    vi.stubGlobal('indexedDB', { open, deleteDatabase: vi.fn() });
    vi.stubGlobal('caches', { open: cachesOpen });
    vi.stubGlobal('chrome', { storage: { local: { get: extensionGet, set: extensionSet } } });
    const s = setup();
    const handoff = present(s.service.take(await s.create(s.photos, s.source)));
    await s.service.assertCurrent(handoff);
    s.service.clear();
    for (const call of [...Object.values(storage), open, cachesOpen, extensionGet, extensionSet])
      expect(call).not.toHaveBeenCalled();
    expect(s.request).not.toHaveBeenCalled();
  });
});

it.each(productOperations)('refuses another account for %s even when routes are valid', async (target) => {
  const s = setup();
  s.context.mockImplementation((operation) =>
    Promise.resolve(
      operation === target
        ? { ...productContext, identity: 'another-account' }
        : operation === 'listPhotos'
          ? sourceContext
          : productContext
    )
  );
  await expect(s.create(s.photos, s.source)).rejects.toThrow('GALLERY_CONTEXT_CHANGED');
  expect(s.request).not.toHaveBeenCalled();
});

it.each(['listPhotos', ...productOperations])(
  'detects a changed same-operation gateway for %s before use',
  async (target) => {
    const s = setup();
    const handoff = present(s.service.take(await s.create(s.photos, s.source)));
    s.context.mockImplementation((operation) =>
      Promise.resolve({
        ...(operation === 'listPhotos' ? sourceContext : productContext),
        ...(operation === target ? { gateway: 'changed-route' } : {})
      })
    );
    await expect(s.service.assertCurrent(handoff)).rejects.toThrow('GALLERY_CONTEXT_CHANGED');
    expect(s.request).not.toHaveBeenCalled();
  }
);

describe('listing-bound selection metadata', () => {
  it('keeps mock listing and product-operation metadata explicit', () => {
    expect(handoffFixture.listedMetadata.operation).toBe('listPhotos');
    expect(handoffFixture.productOperations).toEqual(productOperations);
    expect(handoffFixture.productOperationContext).toEqual({
      identity: productContext.identity,
      gateway: productContext.gateway
    });
    expect(handoffFixture.productOperationContext).not.toHaveProperty('storage');
  });

  it('requires the captured listing context in real mode even when current metadata is available', async () => {
    const s = setup();
    await expect(s.service.create(s.photos, s.source)).rejects.toThrow('GALLERY_CONTEXT_CHANGED');
    expect(s.context.mock.calls).toEqual([['listPhotos', s.source]]);
    expect(s.request).not.toHaveBeenCalled();
  });

  it('allows a mock listing without captured context when current metadata is available', async () => {
    const s = setup('mock');
    const token = await s.service.create(s.photos, s.source);
    expect(s.service.take(token)?.context).toEqual({
      identity: sourceContext.identity,
      gateway: sourceContext.gateway
    });
    expect(s.request).not.toHaveBeenCalled();
  });

  it.each(['identity', 'gateway'] as const)(
    'rejects cached A rows when current %s is B even without a scope epoch change',
    async (key) => {
      const s = setup();
      const listedA = Object.freeze({ ...s.listedContext });
      const currentB = {
        ...sourceContext,
        [key]: key === 'identity' ? handoffFixture.replacementIdentity : handoffFixture.replacementGateway
      };
      s.context.mockResolvedValue(currentB);
      await expect(s.service.create(s.photos, s.source, listedA)).rejects.toThrow('GALLERY_CONTEXT_CHANGED');
      expect(s.context.mock.calls).toEqual([['listPhotos', s.source]]);
      expect(listedA).toEqual(sourceContext);
      expect(s.request).not.toHaveBeenCalled();
    }
  );

  it('rejects a switch to B while the current listing-context lookup is pending', async () => {
    const s = setup();
    const pending = deferredContext();
    s.context.mockImplementationOnce(() => pending.promise);
    const creating = s.create();
    pending.resolve({ ...sourceContext, identity: handoffFixture.replacementIdentity });
    await expect(creating).rejects.toThrow('GALLERY_CONTEXT_CHANGED');
    expect(s.context.mock.calls).toEqual([['listPhotos', s.source]]);
    expect(s.request).not.toHaveBeenCalled();
  });

  it('uses the actual captured listing payload rather than independently changed live controls', async () => {
    const s = setup();
    const listedSource = Object.freeze({ ...s.source });
    s.source.page += 1;
    s.source.groupId = '2002';
    const token = await s.create(s.photos, listedSource);
    const handoff = present(s.service.take(token));
    expect(handoff.source).toEqual(listedSource);
    expect(handoff.source).not.toEqual(s.source);
    expect(s.context.mock.calls[0]).toEqual(['listPhotos', listedSource]);
    expect(s.context.mock.calls[0]?.[1]).not.toBe(listedSource);
    expect(s.request).not.toHaveBeenCalled();
  });

  it.each([null, handoffFixture.replacementStorage])(
    'does not treat unrelated S3 context %j as a product identity or route change',
    async (storage) => {
      const s = setup();
      s.context.mockImplementation((operation) =>
        Promise.resolve({
          ...(operation === 'listPhotos' ? sourceContext : productContext),
          storage
        })
      );
      const handoff = present(s.service.take(await s.create()));
      s.context.mockImplementation((operation) =>
        Promise.resolve({
          ...(operation === 'listPhotos' ? sourceContext : productContext),
          storage: handoffFixture.secondReplacementStorage
        })
      );
      await expect(s.service.assertCurrent(handoff)).resolves.toBeUndefined();
      for (const operation of productOperations) {
        const selected = await s.service.productContext(handoff, operation, {
          categoryId: handoffFixture.freshSchema.categoryId,
          market: 'wholesale'
        });
        expect(selected).toMatchObject({
          identity: productContext.identity,
          gateway: productContext.gateway
        });
      }
      expect(s.request).not.toHaveBeenCalled();
    }
  );
});
