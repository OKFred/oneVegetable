import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeBase64 } from '@one-vegetable/core';
import { templateError, parseTemplateBundle } from '@one-vegetable/core/template-library';
import {
  parseTemplateMaterialDocument,
  type TemplateMaterialPackage
} from '@one-vegetable/core/template-materials';
import {
  sameGalleryTransferContext,
  type GalleryTransferContext
} from '@one-vegetable/core/gallery-transfer-task';
import type {
  S3ObjectContent,
  S3StorageConfigurationSummary,
  S3StorageControl
} from '@one-vegetable/core/s3-storage';
import imageFixture from '../../../mock/data/gallery-task-assets.json';
import configurationFixture from '../../../mock/data/template-library-s3.json';
import legacyFixture from '../../../mock/data/template-library.json';
import photoFixture from '../../../mock/data/photos.json';
import { galleryAssetSha256 } from '../src/lib/gallery-transfer-archive';
import {
  executeTemplateMaterialBackup,
  prepareTemplateMaterialBackup,
  readTemplateMaterialBackup,
  verifyTemplateMaterialBackup
} from '../src/lib/template-material-s3';

afterEach(() => {
  vi.restoreAllMocks();
});
const unused = () => Promise.reject(new Error('Unused offline S3 method'));

function storage() {
  const configuration: S3StorageConfigurationSummary = structuredClone(configurationFixture);
  const objects = new Map<string, S3ObjectContent>();
  const events: string[] = [];
  const put = vi.fn<S3StorageControl['putS3Object']>((input) => {
    events.push(`PUT ${input.key}`);
    objects.set(input.key, { ...input, bytes: Uint8Array.from(input.bytes), etag: 'offline-written' });
    return Promise.resolve({ key: input.key, etag: 'offline-written' });
  });
  const get = vi.fn<S3StorageControl['getS3Object']>((key) => {
    events.push(`GET ${key}`);
    const object = objects.get(key);
    if (!object) return Promise.reject(new Error('Missing offline S3 object'));
    return Promise.resolve({ ...object, bytes: Uint8Array.from(object.bytes) });
  });
  const readConfiguration = vi.fn(() => Promise.resolve(structuredClone(configuration)));
  const control: S3StorageControl = {
    s3StorageConfiguration: readConfiguration,
    updateS3StorageConfiguration: unused,
    clearS3StorageConfiguration: unused,
    testS3StorageConnection: unused,
    listS3Objects: unused,
    getS3Object: get,
    putS3Object: put
  };
  return { control, configuration, objects, events, put, get, readConfiguration };
}

async function exportPlan(withImage = true) {
  const bytes = decodeBase64(imageFixture.base64);
  const sha256 = await galleryAssetSha256(bytes);
  const path = `assets/${sha256}.png`;
  const document = parseTemplateMaterialDocument(
    new TextEncoder().encode(
      JSON.stringify({
        kind: 'oneVegetable.product-description-template-assets',
        schemaVersion: 1,
        exportedAtUtc: 1_788_793_200_000,
        templates: [
          {
            name: 'Offline S3 material',
            category: 'custom',
            language: 'en_US',
            remark: null,
            html: `<p>Offline S3</p>${withImage ? `<img src="${path}">` : ''}`
          }
        ],
        assets: withImage
          ? [
              {
                path,
                fileName: imageFixture.fileName,
                contentType: imageFixture.contentType,
                byteLength: bytes.byteLength,
                sha256
              }
            ]
          : []
      })
    )
  );
  const pack: TemplateMaterialPackage = { document, assets: withImage ? [{ path, bytes }] : [] };
  return { package: pack, context: withImage ? structuredClone(photoFixture.transferContext) : null };
}

describe('offline S3 template material packages', () => {
  it('prepares unique relative keys without writes, writes the manifest last and reads back every object', async () => {
    const s = storage();
    const exported = await exportPlan();
    const plan = await prepareTemplateMaterialBackup(s.control, exported, 'templates', () => true);
    const second = await prepareTemplateMaterialBackup(s.control, exported, 'templates', () => true);
    expect(plan.key).toMatch(/^templates\/[a-f0-9-]{36}\/templates\.json$/u);
    expect(second.key).not.toBe(plan.key);
    expect(plan.started).toBe(false);
    expect(s.put).not.toHaveBeenCalled();
    expect(s.get).not.toHaveBeenCalled();
    const image = required(plan.entries[0]);
    const manifest = required(plan.entries.at(-1));
    expect(manifest.key).toBe(plan.key);
    expect(manifest.contentType).toBe('application/json');
    expect(image.contentType).toBe('image/png');
    const progress = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await executeTemplateMaterialBackup(s.control, plan, () => true, progress);
    expect(plan.started).toBe(true);
    expect(s.events).toEqual([
      `PUT ${image.key}`,
      `GET ${image.key}`,
      `PUT ${manifest.key}`,
      `GET ${manifest.key}`
    ]);
    expect(progress.mock.calls.map(([value]) => (value as { current: number }).current)).toEqual([1, 2]);
    expect(parseTemplateMaterialDocument(required(s.objects.get(plan.key)).bytes)).toEqual(
      exported.package.document
    );
    for (const [, options] of s.put.mock.calls) expect(options?.galleryContext).toEqual(exported.context);
    for (const [, options] of s.get.mock.calls) expect(options?.galleryContext).toEqual(exported.context);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('recovers an uncertain manifest PUT by read-only verification and never resends the plan', async () => {
    const s = storage();
    const plan = await prepareTemplateMaterialBackup(s.control, await exportPlan(), 'templates', () => true);
    const original = s.put.getMockImplementation();
    if (!original) throw new Error('Missing offline PUT');
    s.put.mockImplementation(async (entry, options) => {
      const written = await original(entry, options);
      if (entry.key === plan.key) throw new Error('Offline timeout after manifest commit');
      return written;
    });
    await expect(executeTemplateMaterialBackup(s.control, plan, () => true)).rejects.toThrow(
      'Offline timeout'
    );
    expect(plan.started).toBe(true);
    expect(s.put).toHaveBeenCalledTimes(plan.entries.length);
    await expect(executeTemplateMaterialBackup(s.control, plan, () => true)).rejects.toThrow(
      'TEMPLATE_MATERIAL_UNCONFIRMED'
    );
    await verifyTemplateMaterialBackup(s.control, plan, () => true);
    expect(s.put).toHaveBeenCalledTimes(plan.entries.length);
    expect(s.get.mock.calls.slice(-plan.entries.length).map(([key]) => key)).toEqual(
      plan.entries.map((entry) => entry.key)
    );
  });

  it('does not publish a manifest or resend when an image PUT has an unknown result', async () => {
    const s = storage();
    const plan = await prepareTemplateMaterialBackup(s.control, await exportPlan(), 'templates', () => true);
    const original = s.put.getMockImplementation();
    if (!original) throw new Error('Missing offline PUT');
    s.put.mockImplementationOnce(async (entry, options) => {
      await original(entry, options);
      throw new Error('Offline timeout after image commit');
    });
    await expect(executeTemplateMaterialBackup(s.control, plan, () => true)).rejects.toThrow(
      'Offline timeout'
    );
    expect(s.objects.has(plan.key)).toBe(false);
    await expect(executeTemplateMaterialBackup(s.control, plan, () => true)).rejects.toThrow(
      'TEMPLATE_MATERIAL_UNCONFIRMED'
    );
    await expect(verifyTemplateMaterialBackup(s.control, plan, () => true)).rejects.toThrow(
      'Missing offline S3 object'
    );
    expect(s.put).toHaveBeenCalledOnce();
  });

  it('stops on mismatched image readback before writing the manifest and refuses automatic resend', async () => {
    const s = storage();
    const plan = await prepareTemplateMaterialBackup(s.control, await exportPlan(), 'templates', () => true);
    const original = s.get.getMockImplementation();
    if (!original) throw new Error('Missing offline GET');
    s.get.mockImplementationOnce(async (key, options) => ({
      ...(await original(key, options)),
      bytes: new Uint8Array([0])
    }));
    await expect(executeTemplateMaterialBackup(s.control, plan, () => true)).rejects.toThrow(
      'TEMPLATE_MATERIAL_UNCONFIRMED'
    );
    expect(s.objects.has(plan.key)).toBe(false);
    await expect(executeTemplateMaterialBackup(s.control, plan, () => true)).rejects.toThrow(
      'TEMPLATE_MATERIAL_UNCONFIRMED'
    );
    expect(s.put).toHaveBeenCalledOnce();
  });

  it('restores the exact manifest-relative assets without uploads or listing the bucket', async () => {
    const s = storage();
    const exported = await exportPlan();
    const plan = await prepareTemplateMaterialBackup(s.control, exported, 'templates', () => true);
    await executeTemplateMaterialBackup(s.control, plan, () => true);
    s.get.mockClear();
    s.put.mockClear();
    const restored = await readTemplateMaterialBackup(s.control, plan.key, () => true);
    expect(restored).toEqual(exported.package);
    expect(s.get.mock.calls.map(([key]) => key)).toEqual([plan.key, required(plan.entries[0]).key]);
    expect(s.put).not.toHaveBeenCalled();
  });

  it('rejects missing and corrupt S3 image bytes without fetching any original URL or retrying writes', async () => {
    const s = storage();
    const plan = await prepareTemplateMaterialBackup(s.control, await exportPlan(), 'templates', () => true);
    await executeTemplateMaterialBackup(s.control, plan, () => true);
    const imageKey = required(plan.entries[0]).key;
    const image = required(s.objects.get(imageKey));
    s.objects.delete(imageKey);
    s.put.mockClear();
    await expect(readTemplateMaterialBackup(s.control, plan.key, () => true)).rejects.toThrow(
      'Missing offline S3 object'
    );
    s.objects.set(imageKey, { ...image, bytes: Uint8Array.from(image.bytes, () => 0) });
    await expect(readTemplateMaterialBackup(s.control, plan.key, () => true)).rejects.toThrow(
      'TEMPLATE_MATERIAL_INVALID_IMAGE'
    );
    expect(s.put).not.toHaveBeenCalled();
  });

  it.each(['revision', 'endpoint', 'bucket', 'rootPrefix', 'configured'] as const)(
    'rejects changed S3 %s before any object I/O',
    async (changed) => {
      const s = storage();
      const plan = await prepareTemplateMaterialBackup(
        s.control,
        await exportPlan(),
        'templates',
        () => true
      );
      if (changed === 'revision') s.configuration.revision = 2;
      else if (changed === 'configured') s.configuration.configured = false;
      else s.configuration[changed] = `changed-${changed}`;
      await expect(executeTemplateMaterialBackup(s.control, plan, () => true)).rejects.toThrow(
        'TEMPLATE_CONTEXT_CHANGED'
      );
      expect(plan.started).toBe(false);
      expect(s.put).not.toHaveBeenCalled();
      expect(s.get).not.toHaveBeenCalled();
    }
  );

  it('stops before readback or the next PUT if configuration changes during the first PUT', async () => {
    const s = storage();
    const plan = await prepareTemplateMaterialBackup(s.control, await exportPlan(), 'templates', () => true);
    const original = s.put.getMockImplementation();
    if (!original) throw new Error('Missing offline PUT');
    s.put.mockImplementationOnce(async (entry, options) => {
      const written = await original(entry, options);
      s.configuration.revision = 2;
      return written;
    });
    await expect(executeTemplateMaterialBackup(s.control, plan, () => true)).rejects.toThrow(
      'TEMPLATE_CONTEXT_CHANGED'
    );
    expect(s.put).toHaveBeenCalledOnce();
    expect(s.get).not.toHaveBeenCalled();
    expect(s.objects.has(plan.key)).toBe(false);
  });

  it('stops asset reads if S3 configuration changes after loading the manifest', async () => {
    const s = storage();
    const plan = await prepareTemplateMaterialBackup(s.control, await exportPlan(), 'templates', () => true);
    await executeTemplateMaterialBackup(s.control, plan, () => true);
    const original = s.get.getMockImplementation();
    if (!original) throw new Error('Missing offline GET');
    s.get.mockClear();
    s.put.mockClear();
    s.get.mockImplementationOnce(async (key, options) => {
      const object = await original(key, options);
      s.configuration.bucket = 'changed-after-manifest';
      return object;
    });
    await expect(readTemplateMaterialBackup(s.control, plan.key, () => true)).rejects.toThrow(
      'TEMPLATE_CONTEXT_CHANGED'
    );
    expect(s.get).toHaveBeenCalledOnce();
    expect(s.put).not.toHaveBeenCalled();
  });

  it('keeps the frozen source context in PUT/GET options and respects backend source-context denial', async () => {
    const s = storage();
    const exported = await exportPlan();
    const plan = await prepareTemplateMaterialBackup(s.control, exported, 'templates', () => true);
    const current: GalleryTransferContext = {
      ...photoFixture.transferContext,
      identity: 'changed-source-after-plan'
    };
    s.put.mockImplementation((_entry, options) => {
      expect(options?.galleryContext).toEqual(exported.context);
      if (!options?.galleryContext || !sameGalleryTransferContext(options.galleryContext, current))
        return Promise.reject(templateError('GALLERY_CONTEXT_CHANGED'));
      return Promise.reject(new Error('Stale source must not reach offline provider'));
    });
    await expect(executeTemplateMaterialBackup(s.control, plan, () => true)).rejects.toThrow(
      'GALLERY_CONTEXT_CHANGED'
    );
    expect(s.objects.size).toBe(0);
    expect(s.get).not.toHaveBeenCalled();
    await expect(executeTemplateMaterialBackup(s.control, plan, () => true)).rejects.toThrow(
      'TEMPLATE_MATERIAL_UNCONFIRMED'
    );
    expect(s.put).toHaveBeenCalledOnce();
    s.get.mockImplementation((_key, options) => {
      expect(options?.galleryContext).toEqual(exported.context);
      return Promise.reject(templateError('GALLERY_CONTEXT_CHANGED'));
    });
    await expect(verifyTemplateMaterialBackup(s.control, plan, () => true)).rejects.toThrow(
      'GALLERY_CONTEXT_CHANGED'
    );
    expect(s.put).toHaveBeenCalledOnce();
  });

  it('makes no metadata/object call for an already stale caller', async () => {
    const s = storage();
    const exported = await exportPlan();
    await expect(
      prepareTemplateMaterialBackup(s.control, exported, 'templates', () => false)
    ).rejects.toThrow('TEMPLATE_CONTEXT_CHANGED');
    await expect(
      readTemplateMaterialBackup(s.control, 'templates/legacy/templates.json', () => false)
    ).rejects.toThrow('TEMPLATE_CONTEXT_CHANGED');
    expect(s.readConfiguration).not.toHaveBeenCalled();
    expect(s.get).not.toHaveBeenCalled();
    expect(s.put).not.toHaveBeenCalled();
  });

  it('stops before reading S3 configuration when the caller becomes stale during asynchronous package verification', async () => {
    const s = storage();
    const exported = await exportPlan();
    let current = true;
    const preparing = prepareTemplateMaterialBackup(s.control, exported, 'templates', () => current);
    current = false;
    await expect(preparing).rejects.toThrow('TEMPLATE_CONTEXT_CHANGED');
    expect(s.readConfiguration).not.toHaveBeenCalled();
    expect(s.put).not.toHaveBeenCalled();
    expect(s.get).not.toHaveBeenCalled();
  });

  it.each(['../templates', '/templates', 'templates\\bad', 'templates?token=fixture', 'templates//bad'])(
    'rejects unsafe backup prefix %s before object I/O',
    async (prefix) => {
      const s = storage();
      await expect(
        prepareTemplateMaterialBackup(s.control, await exportPlan(), prefix, () => true)
      ).rejects.toThrow('TEMPLATE_PREFIX_INVALID');
      expect(s.readConfiguration).not.toHaveBeenCalled();
      expect(s.put).not.toHaveBeenCalled();
      expect(s.get).not.toHaveBeenCalled();
    }
  );

  it('preserves legacy JSON routing and never treats it as an image package', async () => {
    const s = storage();
    const key = 'templates/legacy/templates.json';
    const bytes = new TextEncoder().encode(JSON.stringify(legacyFixture));
    s.objects.set(key, { key, bytes, contentType: 'application/json', etag: 'offline-legacy' });
    expect(await readTemplateMaterialBackup(s.control, key, () => true)).toBeNull();
    expect(parseTemplateBundle(bytes)).toEqual(legacyFixture);
    expect(s.get.mock.calls.map(([requested]) => requested)).toEqual([key]);
    expect(s.put).not.toHaveBeenCalled();
  });

  it('backs up and restores image-free materials with only the manifest and no source context', async () => {
    const s = storage();
    const exported = await exportPlan(false);
    const plan = await prepareTemplateMaterialBackup(s.control, exported, 'templates', () => true);
    expect(plan.context).toBeNull();
    expect(plan.entries).toHaveLength(1);
    await executeTemplateMaterialBackup(s.control, plan, () => true);
    expect(s.put).toHaveBeenCalledOnce();
    expect(s.put.mock.calls[0]?.[1]).toBeUndefined();
    expect(await readTemplateMaterialBackup(s.control, plan.key, () => true)).toEqual(exported.package);
    expect([...s.objects.keys()]).toEqual([plan.key]);
  });
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing offline S3 fixture value');
  return value;
}
