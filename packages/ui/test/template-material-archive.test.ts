import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fflate from 'fflate';

vi.mock('fflate', async (importOriginal) => {
  const actual = await importOriginal<typeof fflate>();
  return { ...actual, unzip: vi.fn(actual.unzip), zip: vi.fn(actual.zip) };
});

import {
  parseTemplateMaterialDocument,
  TEMPLATE_MATERIAL_MAX_ASSETS,
  TEMPLATE_MATERIAL_MAX_MANIFEST_BYTES,
  TEMPLATE_MATERIAL_MAX_UNCOMPRESSED_BYTES,
  TEMPLATE_MATERIAL_MAX_ZIP_BYTES,
  type TemplateMaterialAsset
} from '@one-vegetable/core/template-materials';
import { galleryAssetSha256, readGalleryTransferArchive } from '../src/lib/gallery-transfer-archive';
import {
  createTemplateMaterialArchive,
  readTemplateMaterialArchive,
  templateMaterialGalleryArchive,
  type TemplateMaterialPackage
} from '../src/lib/template-material-archive';

// Synthetic signature-only images: no account IDs, remote URLs, credentials or live services.
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF = new TextEncoder().encode('GIF89a');
const BMP = Uint8Array.from([0x42, 0x4d]);
const FIXED_DATE = new Date(1980, 0, 1);

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe('template material archive', () => {
  it.each([
    [JPEG, 'image/jpeg', 'jpg'],
    [JPEG, 'image/jpeg', 'jpeg'],
    [PNG, 'image/png', 'png'],
    [GIF, 'image/gif', 'gif'],
    [BMP, 'image/bmp', 'bmp']
  ] as const)('round-trips %s as %s/%s without network access', async (bytes, contentType, extension) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const input = await fixture([{ bytes, contentType, extension }]);
    const archive = await createTemplateMaterialArchive(input);
    const result = await readTemplateMaterialArchive(archive);
    expect(result).toEqual(input);
    expect(Object.keys(fflate.unzipSync(archive))).toEqual(['templates.json', input.assets[0]?.path]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('supports a template with no images and a zero-byte assets/ directory', async () => {
    const input = await fixture([]);
    expect(await readTemplateMaterialArchive(rawArchive(input, { 'assets/': new Uint8Array() }))).toEqual(
      input
    );
    expect(await readTemplateMaterialArchive(await createTemplateMaterialArchive(input))).toEqual(input);
  });

  it('reads DEFLATE-compressed images and manifests with chunk backpressure', async () => {
    const image = new Uint8Array(2 * 1024 * 1024);
    image.set(JPEG);
    const input = await fixture([{ bytes: image, contentType: 'image/jpeg', extension: 'jpg' }]);
    const result = await readTemplateMaterialArchive(rawArchive(input, {}, 6));
    expect(result.document).toEqual(input.document);
    const output = required(result.assets[0]).bytes;
    expect(output.byteLength).toBe(image.byteLength);
    expect(output.every((byte, index) => byte === image[index])).toBe(true);
  }, 15_000);

  it('reads multiple compressed chunks without queuing the whole image in a worker', async () => {
    const image = new Uint8Array(64 * 1024);
    let seed = 123456789;
    for (let i = 0; i < image.length; i += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      image[i] = seed & 255;
    }
    image.set(JPEG);
    const input = await fixture([{ bytes: image, contentType: 'image/jpeg', extension: 'jpg' }]);
    expect(await readTemplateMaterialArchive(rawArchive(input, {}, 6))).toEqual(input);
  }, 15_000);

  it('accepts the standard ZIP32 streamed data descriptors', async () => {
    const input = await fixture();
    const chunks: Uint8Array[] = [];
    const writer = new fflate.Zip((error, chunk) => {
      if (error) throw error;
      chunks.push(chunk);
    });
    const files = {
      'templates.json': new TextEncoder().encode(JSON.stringify(input.document)),
      ...Object.fromEntries(input.assets.map((asset) => [asset.path, asset.bytes]))
    };
    for (const [path, bytes] of Object.entries(files)) {
      const entry = new fflate.ZipPassThrough(path);
      entry.mtime = FIXED_DATE;
      writer.add(entry);
      entry.push(bytes, true);
    }
    writer.end();
    const archive = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      archive.set(chunk, offset);
      offset += chunk.byteLength;
    }
    expect(await readTemplateMaterialArchive(archive)).toEqual(input);
  });

  it('makes both ZIPs deterministic across clock changes, reads and input asset order', async () => {
    const input = await fixture([
      { bytes: JPEG, contentType: 'image/jpeg', extension: 'jpg' },
      { bytes: PNG, contentType: 'image/png', extension: 'png' }
    ]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const first = await createTemplateMaterialArchive(input);
    const firstGallery = await templateMaterialGalleryArchive(input);
    vi.setSystemTime(new Date('2030-08-08T18:22:42Z'));
    expect(await createTemplateMaterialArchive({ ...input, assets: input.assets.toReversed() })).toEqual(
      first
    );
    const reselected = await readTemplateMaterialArchive(first);
    const secondGallery = await templateMaterialGalleryArchive(reselected);
    expect(secondGallery).toEqual(firstGallery);
    expect(await galleryAssetSha256(secondGallery)).toBe(await galleryAssetSha256(firstGallery));
    // DOS time/date are fixed for every local and central entry, not just the manifest.
    for (const offset of centralHeaders(firstGallery)) {
      const view = new DataView(firstGallery.buffer);
      expect(view.getUint32(offset + 12, true)).toBe(0x00210000);
      expect(view.getUint32(view.getUint32(offset + 42, true) + 10, true)).toBe(0x00210000);
    }
  });

  it('converts into the existing gallery wire format with only local material identities', async () => {
    const input = await fixture();
    const result = await readGalleryTransferArchive(await templateMaterialGalleryArchive(input));
    const metadata = input.document.assets[0];
    expect(result.document).toEqual({
      schemaVersion: 1,
      kind: 'one-vegetable-gallery-transfer',
      createdTimeUtc: input.document.exportedAtUtc,
      assets: [
        {
          ...metadata,
          sourcePhotoId: `template-material-${metadata?.sha256.slice(0, 32) ?? ''}`,
          groupPath: 'template-assets',
          width: null,
          height: null,
          modifiedTimeUtc: null
        }
      ]
    });
    expect(result.assets).toEqual(input.assets);
    expect(result.document.assets[0]).not.toHaveProperty('fileId');
    expect(result.document.assets[0]).not.toHaveProperty('originalUrl');
  });

  it('snapshots the entire caller package before asynchronous hashing', async () => {
    const input = await fixture([
      { bytes: JPEG, contentType: 'image/jpeg', extension: 'jpg' },
      { bytes: PNG, contentType: 'image/png', extension: 'png' }
    ]);
    const expected = structuredClone(input);
    const pending = createTemplateMaterialArchive(input);
    for (const asset of input.assets) asset.bytes.fill(0);
    input.document.exportedAtUtc = 0;
    expect(await readTemplateMaterialArchive(await pending)).toEqual({
      ...expected,
      assets: expected.assets.toSorted((a, b) => a.path.localeCompare(b.path))
    });
  });

  it.each([
    '../templates.json',
    '/templates.json',
    'C:/templates.json',
    'assets\\image.jpg',
    'assets/../templates.json',
    './templates.json',
    'assets//image.jpg',
    'assets/%2e%2e/image.jpg',
    'assets/%252e%252e/image.jpg',
    'assets/Ａ.jpg',
    'templates.json\0',
    'assets/sub/image.jpg',
    'nested.zip',
    'assets/archive.zip',
    'other/',
    'assets/not-a-hash.jpg'
  ])('refuses noncanonical or unsupported ZIP entry %s', async (path) => {
    await rejectsCode(
      readTemplateMaterialArchive(rawArchive(await fixture([]), { [path]: JPEG })),
      'TEMPLATE_MATERIAL_UNSAFE_PATH'
    );
  });

  it('rejects duplicate central entries and case collisions without silently overwriting', async () => {
    const input = await fixture();
    const path = input.assets[0]?.path ?? '';
    for (const duplicateName of [path, path.toUpperCase()]) {
      const alternate = path.replace(/jpg$/u, 'png');
      const archive = rawArchive(input, { [alternate]: JPEG });
      const headers = centralHeaders(archive);
      renameEntry(archive, headers.at(-1) ?? 0, duplicateName);
      await rejectsCode(readTemplateMaterialArchive(archive), 'TEMPLATE_MATERIAL_DUPLICATE_PATH');
    }
  });

  it('rejects a case-colliding manifest and a directory carrying data', async () => {
    await rejectsCode(
      readTemplateMaterialArchive(rawArchive(await fixture([]), { 'Templates.json': JPEG })),
      'TEMPLATE_MATERIAL_DUPLICATE_PATH'
    );
    await rejectsCode(
      readTemplateMaterialArchive(rawArchive(await fixture([]), { 'assets/': JPEG })),
      'TEMPLATE_MATERIAL_INVALID_ZIP'
    );
  });

  it('rejects compressed directory payloads disguised as an empty directory', async () => {
    const archive = rawArchive(await fixture([]), { 'assets/': JPEG }, 6);
    const central = required(centralHeaders(archive)[1]);
    const view = new DataView(archive.buffer);
    setOriginalSize(archive, central, 0);
    view.setUint32(central + 16, 0, true);
    view.setUint32(view.getUint32(central + 42, true) + 14, 0, true);
    await rejectsCode(readTemplateMaterialArchive(archive), 'TEMPLATE_MATERIAL_INVALID_ZIP');
  });

  it.each([1, 0x7075])('rejects ZIP64 and Unicode path alias extra fields: %s', async (kind) => {
    const input = await fixture();
    const path = required(input.assets[0]).path;
    const files: fflate.Zippable = {
      'templates.json': new TextEncoder().encode(JSON.stringify(input.document)),
      [path]: [JPEG, { extra: { [kind]: new Uint8Array() } }]
    };
    await rejectsCode(readTemplateMaterialArchive(fflate.zipSync(files)), 'TEMPLATE_MATERIAL_INVALID_ZIP');
  });

  it('rejects missing files, undeclared files and manifest assets unreferenced by templates', async () => {
    const input = await fixture();
    await rejectsCode(
      readTemplateMaterialArchive(rawArchive({ ...input, assets: [] })),
      'TEMPLATE_MATERIAL_ASSET_MISSING'
    );
    await rejectsCode(
      createTemplateMaterialArchive({ ...input, assets: [] }),
      'TEMPLATE_MATERIAL_ASSET_MISSING'
    );
    const extraPath = `assets/${'a'.repeat(64)}.jpg`;
    await rejectsCode(
      readTemplateMaterialArchive(rawArchive(input, { [extraPath]: JPEG })),
      'TEMPLATE_MATERIAL_UNREFERENCED_ASSET'
    );
    await rejectsCode(
      createTemplateMaterialArchive({
        ...input,
        assets: [...input.assets, { path: extraPath, bytes: JPEG }]
      }),
      'TEMPLATE_MATERIAL_UNREFERENCED_ASSET'
    );
    required(input.document.templates[0]).html = '<p>Unreferenced fixture</p>';
    await rejectsMaterial(createTemplateMaterialArchive(input));
    await rejectsMaterial(readTemplateMaterialArchive(rawArchive(input)));
  });

  it('rejects duplicate input assets and unsafe write paths', async () => {
    const input = await fixture();
    await rejectsCode(
      createTemplateMaterialArchive({ ...input, assets: [...input.assets, ...input.assets] }),
      'TEMPLATE_MATERIAL_DUPLICATE_PATH'
    );
    await rejectsCode(
      createTemplateMaterialArchive({ ...input, assets: [{ path: '../image.jpg', bytes: JPEG }] }),
      'TEMPLATE_MATERIAL_UNSAFE_PATH'
    );
  });

  it.each(['header', 'type', 'extension', 'fileName', 'size', 'digest'] as const)(
    'checks %s identically on write, read and gallery conversion',
    async (fault) => {
      const input = await fixture();
      const meta = required(input.document.assets[0]);
      const asset = required(input.assets[0]);
      if (fault === 'header') asset.bytes = Uint8Array.from([0, 0, 0, 0]);
      if (fault === 'type') meta.contentType = 'image/png';
      if (fault === 'extension') {
        meta.path = meta.path.replace(/jpg$/u, 'png');
        asset.path = meta.path;
        required(input.document.templates[0]).html = `<p>Portable fixture</p><img src="${meta.path}">`;
      }
      if (fault === 'fileName') meta.fileName = 'fixture.png';
      if (fault === 'size') meta.byteLength += 1;
      if (fault === 'digest') asset.bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0x01]);
      const code =
        fault === 'digest' ? 'TEMPLATE_MATERIAL_DIGEST_MISMATCH' : 'TEMPLATE_MATERIAL_ASSET_INVALID';
      await rejectsCode(createTemplateMaterialArchive(input), code);
      await rejectsCode(readTemplateMaterialArchive(rawArchive(input)), code);
      await rejectsCode(templateMaterialGalleryArchive(input), code);
    }
  );

  it('rejects a ZIP disguised as an image', async () => {
    const bytes = fflate.zipSync({ 'inner.json': new TextEncoder().encode('{}') });
    const input = await fixture([{ bytes, contentType: 'image/jpeg', extension: 'jpg' }]);
    await rejectsCode(readTemplateMaterialArchive(rawArchive(input)), 'TEMPLATE_MATERIAL_ASSET_INVALID');
    await rejectsCode(createTemplateMaterialArchive(input), 'TEMPLATE_MATERIAL_ASSET_INVALID');
  });

  it('delegates strict schema and relative reference validation to core on both paths', async () => {
    for (const field of ['uppercase-type', 'uppercase-hash', 'extra-metadata', 'absolute-reference']) {
      const input = await fixture();
      const meta = required(input.document.assets[0]);
      if (field === 'uppercase-type') Object.assign(meta, { contentType: 'IMAGE/JPEG' });
      if (field === 'uppercase-hash') meta.sha256 = meta.sha256.toUpperCase();
      if (field === 'extra-metadata') Object.assign(meta, { credentials: 'synthetic-forbidden-field' });
      if (field === 'absolute-reference')
        required(input.document.templates[0]).html = '<img src="https://fixture.invalid/image.jpg">';
      await rejectsMaterial(createTemplateMaterialArchive(input));
      await rejectsMaterial(readTemplateMaterialArchive(rawArchive(input)));
    }
  });

  it('keeps the HTML sanitized by core on read and write', async () => {
    const input = await fixture();
    required(input.document.templates[0]).html += '<script>synthetic()</script>';
    const safe = parseTemplateMaterialDocument(new TextEncoder().encode(JSON.stringify(input.document)));
    expect(required(safe.templates[0]).html).not.toContain('<script>');
    expect((await readTemplateMaterialArchive(rawArchive(input))).document).toEqual(safe);
    expect((await readTemplateMaterialArchive(await createTemplateMaterialArchive(input))).document).toEqual(
      safe
    );
  });

  it('rejects malformed/non-UTF8 JSON, absent manifests and truncated/non-ZIP buffers', async () => {
    for (const manifest of [new TextEncoder().encode('{'), Uint8Array.from([0xff, 0xfe])]) {
      await rejectsMaterial(readTemplateMaterialArchive(fflate.zipSync({ 'templates.json': manifest })));
    }
    const input = await fixture();
    await rejectsCode(
      readTemplateMaterialArchive(
        fflate.zipSync(Object.fromEntries(input.assets.map((a) => [a.path, a.bytes])))
      ),
      'TEMPLATE_MATERIAL_INVALID_DOCUMENT'
    );
    for (const bytes of [
      new Uint8Array(),
      Uint8Array.from([0x50, 0x4b]),
      new TextEncoder().encode('{}'),
      rawArchive(input).subarray(0, 32)
    ]) {
      await rejectsCode(readTemplateMaterialArchive(bytes), 'TEMPLATE_MATERIAL_INVALID_ZIP');
    }
  });

  it('checks the ZIP byte limit before inspecting or copying it', async () => {
    await rejectsCode(
      readTemplateMaterialArchive(new Uint8Array(TEMPLATE_MATERIAL_MAX_ZIP_BYTES + 1)),
      'TEMPLATE_MATERIAL_ZIP_TOO_LARGE'
    );
  });

  it('checks manifest and image originalSize limits before starting an inflater', async () => {
    const input = await fixture();
    for (const [index, size, code] of [
      [0, TEMPLATE_MATERIAL_MAX_MANIFEST_BYTES + 1, 'TEMPLATE_MATERIAL_MANIFEST_TOO_LARGE'],
      [1, 5 * 1024 * 1024 + 1, 'TEMPLATE_MATERIAL_ASSET_INVALID']
    ] as const) {
      const archive = rawArchive(input, {}, 6);
      setOriginalSize(archive, centralHeaders(archive)[index] ?? 0, size);
      await rejectsCode(readTemplateMaterialArchive(archive), code);
    }
    expect(fflate.unzip).not.toHaveBeenCalled();
    required(input.document.templates[0]).html = 'x'.repeat(TEMPLATE_MATERIAL_MAX_MANIFEST_BYTES);
    await rejectsCode(createTemplateMaterialArchive(input), 'TEMPLATE_MATERIAL_MANIFEST_TOO_LARGE');
  });

  it('counts total declared uncompressed sizes before any manifest or image extraction', async () => {
    const files: fflate.Zippable = { 'templates.json': new TextEncoder().encode('{}') };
    for (let i = 0; i < 21; i += 1) files[`assets/${i.toString(16).padStart(64, '0')}.jpg`] = JPEG;
    const archive = fflate.zipSync(files, { level: 6, mtime: FIXED_DATE });
    for (const offset of centralHeaders(archive).slice(1)) setOriginalSize(archive, offset, 5 * 1024 * 1024);
    expect(21 * 5 * 1024 * 1024).toBeGreaterThan(TEMPLATE_MATERIAL_MAX_UNCOMPRESSED_BYTES);
    await rejectsCode(readTemplateMaterialArchive(archive), 'TEMPLATE_MATERIAL_UNCOMPRESSED_LIMIT');
  });

  it('counts assets separately from the optional directory and rejects 501 images', async () => {
    const files: fflate.Zippable = { 'templates.json': new TextEncoder().encode('{}') };
    for (let i = 0; i <= TEMPLATE_MATERIAL_MAX_ASSETS; i += 1)
      files[`assets/${i.toString(16).padStart(64, '0')}.jpg`] = JPEG;
    await rejectsCode(readTemplateMaterialArchive(fflate.zipSync(files)), 'TEMPLATE_MATERIAL_ASSET_LIMIT');
    const input = await fixture();
    input.assets = Array.from({ length: TEMPLATE_MATERIAL_MAX_ASSETS + 1 }, () => required(input.assets[0]));
    await rejectsCode(createTemplateMaterialArchive(input), 'TEMPLATE_MATERIAL_ASSET_LIMIT');
  });

  it('rejects dishonest DEFLATE sizes instead of accepting a truncated valid image prefix', async () => {
    const input = await fixture();
    const path = required(input.assets[0]).path;
    const image = new Uint8Array(2 * 1024 * 1024);
    image.set(JPEG);
    const archive = rawArchive(input, { [path]: image }, 6);
    const offset = centralHeaders(archive)[1] ?? 0;
    setOriginalSize(archive, offset, JPEG.byteLength);
    // Even CRC/SHA of the advertised prefix cannot hide extra decoded bytes.
    const view = new DataView(archive.buffer);
    const reference = rawArchive(input);
    const referenceView = new DataView(reference.buffer);
    const referenceHeader = centralHeaders(reference)[1] ?? 0;
    const crc = referenceView.getUint32(referenceHeader + 16, true);
    view.setUint32(offset + 16, crc, true);
    view.setUint32(view.getUint32(offset + 42, true) + 14, crc, true);
    await rejectsCode(readTemplateMaterialArchive(archive), 'TEMPLATE_MATERIAL_INVALID_ZIP');
  });

  it.each([
    'local-name',
    'crc',
    'encryption',
    'symlink',
    'multi-disk',
    'compression',
    'stored-size',
    'trailing-bytes'
  ] as const)('rejects inconsistent or unsupported ZIP structure: %s', async (fault) => {
    const input = await fixture();
    let archive = rawArchive(input);
    const view = new DataView(archive.buffer);
    const central = centralHeaders(archive)[1] ?? 0;
    const local = view.getUint32(central + 42, true);
    if (fault === 'local-name') archive[local + 30] = 0x78;
    if (fault === 'crc') archive[local + 30 + view.getUint16(local + 26, true)] = 0;
    if (fault === 'encryption') view.setUint16(central + 8, 1, true);
    if (fault === 'symlink') view.setUint32(central + 38, 0xa1ff0000, true);
    if (fault === 'multi-disk') view.setUint16(archive.byteLength - 22 + 4, 1, true);
    if (fault === 'compression') view.setUint16(central + 10, 99, true);
    if (fault === 'stored-size') setOriginalSize(archive, central, JPEG.byteLength + 1);
    if (fault === 'trailing-bytes') archive = Uint8Array.from([...archive, 0]);
    await rejectsCode(readTemplateMaterialArchive(archive), 'TEMPLATE_MATERIAL_INVALID_ZIP');
  });

  it('captures errors from a deferred fflate filter without an unhandled callback exception', async () => {
    vi.mocked(fflate.unzip).mockImplementationOnce(
      (
        _bytes: Uint8Array,
        options: fflate.AsyncUnzipOptions | fflate.UnzipCallback,
        callback?: fflate.UnzipCallback
      ) => {
        const cb = typeof options === 'function' ? options : callback;
        queueMicrotask(() => {
          if (typeof options !== 'function') {
            expect(() =>
              options.filter?.({ name: '../secret', size: 1, originalSize: 1, compression: 0 })
            ).not.toThrow();
          }
          cb?.(null, {});
        });
        return () => undefined;
      }
    );
    await rejectsCode(
      readTemplateMaterialArchive(rawArchive(await fixture())),
      'TEMPLATE_MATERIAL_UNSAFE_PATH'
    );
  });

  it('wraps internal codec failures in template errors without exposing their messages', async () => {
    const input = await fixture();
    vi.mocked(fflate.zip).mockImplementationOnce(
      (
        _files: fflate.AsyncZippable,
        options: fflate.AsyncZipOptions | fflate.FlateCallback,
        callback?: fflate.FlateCallback
      ) => {
        const cb = typeof options === 'function' ? options : callback;
        cb?.(
          Object.assign(new Error('synthetic private worker error'), { code: 0 as const }),
          new Uint8Array()
        );
        return () => undefined;
      }
    );
    await rejectsCode(createTemplateMaterialArchive(input), 'TEMPLATE_MATERIAL_INVALID_ZIP');
    vi.mocked(fflate.unzip).mockImplementationOnce(() => {
      throw new Error('synthetic private codec error');
    });
    await rejectsCode(readTemplateMaterialArchive(rawArchive(input)), 'TEMPLATE_MATERIAL_INVALID_ZIP');
  });

  it('checks the encoded ZIP byte limit as well as the input limit', async () => {
    vi.mocked(fflate.zip).mockImplementationOnce(
      (
        _files: fflate.AsyncZippable,
        options: fflate.AsyncZipOptions | fflate.FlateCallback,
        callback?: fflate.FlateCallback
      ) => {
        const cb = typeof options === 'function' ? options : callback;
        cb?.(null, new Uint8Array(TEMPLATE_MATERIAL_MAX_ZIP_BYTES + 1));
        return () => undefined;
      }
    );
    await rejectsCode(createTemplateMaterialArchive(await fixture()), 'TEMPLATE_MATERIAL_ZIP_TOO_LARGE');
  });
});

async function fixture(
  images: { bytes: Uint8Array; contentType: TemplateMaterialAsset['contentType']; extension: string }[] = [
    { bytes: JPEG, contentType: 'image/jpeg', extension: 'jpg' }
  ]
): Promise<TemplateMaterialPackage> {
  const metadata: TemplateMaterialAsset[] = [];
  const assets: TemplateMaterialPackage['assets'] = [];
  for (const [index, image] of images.entries()) {
    const sha256 = await galleryAssetSha256(image.bytes);
    const path = `assets/${sha256}.${image.extension}`;
    metadata.push({
      path,
      sha256,
      fileName: `fixture-${index}.${image.extension}`,
      contentType: image.contentType,
      byteLength: image.bytes.byteLength
    });
    assets.push({ path, bytes: Uint8Array.from(image.bytes) });
  }
  return {
    document: {
      schemaVersion: 1,
      kind: 'oneVegetable.product-description-template-assets',
      exportedAtUtc: 1_788_793_200_000,
      templates: [
        {
          name: 'Portable fixture',
          category: 'custom',
          language: 'en_US',
          remark: null,
          html: `<p>Portable fixture</p>${metadata.map((asset) => `<img src="${asset.path}">`).join('')}`
        }
      ],
      assets: metadata
    },
    assets
  };
}

function rawArchive(
  input: TemplateMaterialPackage,
  extra: Record<string, Uint8Array> = {},
  level: 0 | 6 = 0
): Uint8Array {
  return fflate.zipSync(
    {
      'templates.json': new TextEncoder().encode(JSON.stringify(input.document)),
      ...Object.fromEntries(input.assets.map((asset) => [asset.path, asset.bytes])),
      ...extra
    },
    { level, mtime: FIXED_DATE }
  );
}

function centralHeaders(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.byteLength - 22;
  let offset = view.getUint32(end + 16, true);
  const result: number[] = [];
  for (let i = 0; i < view.getUint16(end + 10, true); i += 1) {
    result.push(offset);
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
  return result;
}

function renameEntry(bytes: Uint8Array, central: number, name: string): void {
  const view = new DataView(bytes.buffer);
  const encoded = new TextEncoder().encode(name);
  expect(encoded.byteLength).toBe(view.getUint16(central + 28, true));
  bytes.set(encoded, central + 46);
  bytes.set(encoded, view.getUint32(central + 42, true) + 30);
}

function setOriginalSize(bytes: Uint8Array, central: number, size: number): void {
  const view = new DataView(bytes.buffer);
  view.setUint32(central + 24, size, true);
  view.setUint32(view.getUint32(central + 42, true) + 22, size, true);
}

async function rejectsCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: 'GatewayException',
    gatewayError: { code, retryable: false }
  });
}

async function rejectsMaterial(promise: Promise<unknown>): Promise<void> {
  const codeMatcher: unknown = expect.stringMatching(/^TEMPLATE_MATERIAL_/u);
  await expect(promise).rejects.toMatchObject({
    name: 'GatewayException',
    gatewayError: { code: codeMatcher, retryable: false }
  });
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing synthetic fixture value');
  return value;
}
